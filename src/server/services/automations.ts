/**
 * Automações periódicas, disparadas por `/api/jobs/tick`
 * (cron externo, Vercel Cron ou chamada manual do administrador).
 *
 * Cada rotina é idempotente e limitada em lote, para nunca travar o processo.
 */
import { and, eq, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  conversations,
  organizations,
  users,
  whatsappConnections,
} from "@/db/schema";
import { recordConversationEvent } from "@/lib/audit";
import { publish } from "@/lib/realtime/bus";
import { processCalendarReminders, processDueFollowups } from "./agenda";
import { autoAssign } from "./assignment-service";
import { notify } from "./notifications";
import { prunePresence } from "./presence";
import { pruneNotifications } from "./notifications";

export type TickResult = Record<string, number>;

export async function runScheduledJobs(): Promise<TickResult> {
  const [
    staleAlerts,
    reassigned,
    escalated,
    offlineReleased,
    followups,
    reminders,
    integrationAlerts,
  ] = await Promise.all([
    alertStaleConversations(),
    reassignUnansweredConversations(),
    escalateOverdueToSupervisors(),
    releaseOfflineSellerQueue(),
    processDueFollowups(),
    processCalendarReminders(),
    alertDownIntegrations(),
  ]);

  await Promise.all([prunePresence(), pruneNotifications()]);

  return {
    alertasConversasParadas: staleAlerts,
    reatribuidas: reassigned,
    escalonadas: escalated,
    liberadasDeVendedorOffline: offlineReleased,
    retornosVencidos: followups,
    lembretesAgenda: reminders,
    alertasIntegracao: integrationAlerts,
  };
}

/** Avisa o responsável quando o cliente está esperando além do SLA. */
export async function alertStaleConversations(): Promise<number> {
  const db = await getDb();
  const orgs = await db
    .select({ id: organizations.id, settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.status, "active"));

  let total = 0;
  for (const org of [...orgs, ...(await trialOrganizations())]) {
    const minutes = org.settings?.slaStaleConversationMinutes ?? 30;
    const cutoff = new Date(Date.now() - minutes * 60_000);

    const stale = await db
      .select({
        id: conversations.id,
        assignedUserId: conversations.assignedUserId,
        lastInboundAt: conversations.lastInboundAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.organizationId, org.id),
          sql`${conversations.status} <> 'closed'`,
          isNotNull(conversations.assignedUserId),
          isNotNull(conversations.lastInboundAt),
          lte(conversations.lastInboundAt, cutoff),
          sql`(${conversations.lastOutboundAt} is null or ${conversations.lastOutboundAt} < ${conversations.lastInboundAt})`,
          // Evita repetir o alerta a cada tick.
          sql`not exists (
            select 1 from conversation_events ce
            where ce.conversation_id = ${conversations.id}
              and ce.event_type = 'escalated'
              and ce.created_at > now() - interval '1 hour'
          )`,
        ),
      )
      .limit(100);

    for (const conversation of stale) {
      const waited = conversation.lastInboundAt
        ? Math.floor((Date.now() - conversation.lastInboundAt.getTime()) / 60_000)
        : minutes;

      await notify({
        organizationId: org.id,
        userId: conversation.assignedUserId!,
        type: "conversation_stalled",
        title: "Cliente aguardando resposta",
        body: `O cliente aguarda há ${waited} minutos.`,
        conversationId: conversation.id,
      });

      await recordConversationEvent({
        organizationId: org.id,
        conversationId: conversation.id,
        eventType: "escalated",
        metadata: { motivo: "SLA de resposta ultrapassado", minutos: waited },
      });
      total += 1;
    }
  }
  return total;
}

async function trialOrganizations() {
  const db = await getDb();
  return db
    .select({ id: organizations.id, settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.status, "trial"));
}

/**
 * Conversas sem resposta e sem responsável ativo voltam à distribuição.
 * Só toca em conversas atribuídas há mais de 15 minutos sem primeira resposta.
 */
export async function reassignUnansweredConversations(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 15 * 60_000);

  const candidates = await db
    .select({
      id: conversations.id,
      organizationId: conversations.organizationId,
      assignedTeamId: conversations.assignedTeamId,
      whatsappConnectionId: conversations.whatsappConnectionId,
      assignedUserId: conversations.assignedUserId,
    })
    .from(conversations)
    .innerJoin(users, eq(users.id, conversations.assignedUserId))
    .where(
      and(
        sql`${conversations.status} <> 'closed'`,
        sql`${conversations.firstResponseAt} is null`,
        lte(conversations.assignedAt, cutoff),
        // Responsável desativado ou offline há mais de 15 minutos.
        sql`(${users.isActive} = false or (${users.availabilityStatus} = 'offline' and (${users.lastActivityAt} is null or ${users.lastActivityAt} < ${cutoff})))`,
      ),
    )
    .limit(50);

  let total = 0;
  for (const conversation of candidates) {
    const [released] = await db
      .update(conversations)
      .set({
        assignedUserId: null,
        status: "unassigned",
        assignedAt: null,
        updatedAt: new Date(),
        version: sql`${conversations.version} + 1`,
      })
      .where(eq(conversations.id, conversation.id))
      .returning({ id: conversations.id });
    if (!released) continue;

    await recordConversationEvent({
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      eventType: "unassigned",
      previousValue: { assignedUserId: conversation.assignedUserId },
      metadata: { motivo: "responsável indisponível e sem primeira resposta" },
    });

    await autoAssign({
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      connectionId: conversation.whatsappConnectionId,
      preferredTeamId: conversation.assignedTeamId,
    });

    await publish(conversation.organizationId, {
      type: "conversation.updated",
      conversationId: conversation.id,
    });
    total += 1;
  }
  return total;
}

/** Avisa supervisores sobre conversas urgentes paradas há muito tempo. */
export async function escalateOverdueToSupervisors(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 60 * 60_000);

  const overdue = await db
    .select({
      id: conversations.id,
      organizationId: conversations.organizationId,
      priority: conversations.priority,
    })
    .from(conversations)
    .where(
      and(
        sql`${conversations.status} <> 'closed'`,
        inArray(conversations.priority, ["high", "urgent"]),
        isNotNull(conversations.lastInboundAt),
        lte(conversations.lastInboundAt, cutoff),
        sql`(${conversations.lastOutboundAt} is null or ${conversations.lastOutboundAt} < ${conversations.lastInboundAt})`,
        sql`not exists (
          select 1 from conversation_events ce
          where ce.conversation_id = ${conversations.id}
            and ce.event_type = 'escalated'
            and ce.metadata->>'destino' = 'supervisao'
            and ce.created_at > now() - interval '6 hours'
        )`,
      ),
    )
    .limit(50);

  let total = 0;
  for (const conversation of overdue) {
    const supervisors = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, conversation.organizationId),
          inArray(users.role, ["admin", "supervisor"]),
          eq(users.isActive, true),
        ),
      );

    for (const supervisor of supervisors) {
      await notify({
        organizationId: conversation.organizationId,
        userId: supervisor.id,
        type: "conversation_stalled",
        title: "Atendimento prioritário sem resposta",
        body: "Um atendimento de prioridade alta está há mais de uma hora sem resposta.",
        conversationId: conversation.id,
      });
    }

    await recordConversationEvent({
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      eventType: "escalated",
      metadata: { destino: "supervisao", prioridade: conversation.priority },
    });
    total += 1;
  }
  return total;
}

/** Marca como ausente/offline quem não dá sinal de vida há um tempo. */
export async function releaseOfflineSellerQueue(): Promise<number> {
  const db = await getDb();
  const awayCutoff = new Date(Date.now() - 10 * 60_000);
  const offlineCutoff = new Date(Date.now() - 30 * 60_000);

  await db
    .update(users)
    .set({ availabilityStatus: "away" })
    .where(
      and(
        eq(users.availabilityStatus, "online"),
        isNotNull(users.lastActivityAt),
        lt(users.lastActivityAt, awayCutoff),
        gte(users.lastActivityAt, offlineCutoff),
      ),
    );

  const offline = await db
    .update(users)
    .set({ availabilityStatus: "offline" })
    .where(
      and(
        inArray(users.availabilityStatus, ["online", "away"]),
        isNotNull(users.lastActivityAt),
        lt(users.lastActivityAt, offlineCutoff),
      ),
    )
    .returning({ id: users.id });

  return offline.length;
}

/** Avisa administradores quando uma conexão para de receber webhooks. */
export async function alertDownIntegrations(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 2 * 60 * 60_000);

  const suspect = await db
    .select({
      id: whatsappConnections.id,
      organizationId: whatsappConnections.organizationId,
      label: whatsappConnections.label,
    })
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.status, "error"),
        sql`${whatsappConnections.provider} <> 'mock'`,
        sql`(${whatsappConnections.lastErrorAt} is not null and ${whatsappConnections.lastErrorAt} > ${cutoff})`,
      ),
    )
    .limit(20);

  let total = 0;
  for (const connection of suspect) {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, connection.organizationId),
          eq(users.role, "admin"),
          eq(users.isActive, true),
        ),
      );

    for (const admin of admins) {
      await notify({
        organizationId: connection.organizationId,
        userId: admin.id,
        type: "integration_down",
        title: "Conexão do WhatsApp com problema",
        body: `A conexão "${connection.label}" precisa ser revisada.`,
      });
    }
    total += 1;
  }
  return total;
}
