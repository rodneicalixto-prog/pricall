/**
 * Aplicação das regras de distribuição sobre o banco.
 * A decisão em si é da função pura `pickAssignee` (src/lib/assignment.ts).
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  assignmentCursors,
  assignmentRules,
  conversations,
  teamMembers,
  users,
} from "@/db/schema";
import {
  pickAssignee,
  selectRule,
  type Candidate,
  type RuleLike,
} from "@/lib/assignment";
import { recordConversationEvent } from "@/lib/audit";
import { publish } from "@/lib/realtime/bus";
import { notify } from "./notifications";

export type AutoAssignInput = {
  organizationId: string;
  conversationId: string;
  messageText?: string | null;
  connectionId?: string | null;
  /** Setor sugerido pelo número que recebeu a mensagem. */
  preferredTeamId?: string | null;
};

export async function autoAssign(input: AutoAssignInput) {
  const db = await getDb();

  const rules = (await db
    .select({
      id: assignmentRules.id,
      strategy: assignmentRules.strategy,
      teamId: assignmentRules.teamId,
      priority: assignmentRules.priority,
      isActive: assignmentRules.isActive,
      configuration: assignmentRules.configuration,
    })
    .from(assignmentRules)
    .where(eq(assignmentRules.organizationId, input.organizationId))) as RuleLike[];

  const rule = selectRule(rules, {
    messageText: input.messageText,
    connectionId: input.connectionId,
  });

  if (!rule) {
    return { assignedUserId: null, reason: "Nenhuma regra ativa; fila manual." };
  }

  const teamId = rule.teamId ?? input.preferredTeamId ?? null;
  const candidates = await loadCandidates(input.organizationId, teamId);

  const scopeKey = `${rule.id}:${teamId ?? "geral"}`;
  const [cursor] = await db
    .select()
    .from(assignmentCursors)
    .where(
      and(
        eq(assignmentCursors.organizationId, input.organizationId),
        eq(assignmentCursors.scopeKey, scopeKey),
      ),
    )
    .limit(1);

  const decision = pickAssignee(candidates, {
    strategy: rule.strategy,
    configuration: rule.configuration,
    teamId,
    lastAssignedUserId: cursor?.lastUserId ?? null,
    messageText: input.messageText,
  });

  // Sempre grava a equipe sugerida, mesmo sem responsável definido.
  if (decision.teamId) {
    await db
      .update(conversations)
      .set({ assignedTeamId: decision.teamId, updatedAt: new Date() })
      .where(eq(conversations.id, input.conversationId));
  }

  if (decision.userId) {
    // Atribuição condicional: se alguém já assumiu, respeita.
    const updated = await db
      .update(conversations)
      .set({
        assignedUserId: decision.userId,
        assignedTeamId: decision.teamId,
        status: "in_progress",
        assignedAt: new Date(),
        updatedAt: new Date(),
        version: sql`${conversations.version} + 1`,
      })
      .where(
        and(
          eq(conversations.id, input.conversationId),
          sql`${conversations.assignedUserId} is null`,
        ),
      )
      .returning({ id: conversations.id });

    if (updated.length > 0) {
      await db
        .insert(assignmentCursors)
        .values({
          organizationId: input.organizationId,
          scopeKey,
          lastUserId: decision.userId,
        })
        .onConflictDoUpdate({
          target: [assignmentCursors.organizationId, assignmentCursors.scopeKey],
          set: { lastUserId: decision.userId, updatedAt: new Date() },
        });

      await recordConversationEvent({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        eventType: "assigned",
        actorUserId: null,
        newValue: { assignedUserId: decision.userId, status: "in_progress" },
        metadata: { origem: "distribuição automática", regra: decision.reason },
      });

      await notify({
        organizationId: input.organizationId,
        userId: decision.userId,
        type: "conversation_assigned",
        title: "Novo atendimento atribuído a você",
        body: "Uma nova conversa entrou na sua fila.",
        conversationId: input.conversationId,
      });

      await publish(input.organizationId, {
        type: "conversation.assigned",
        conversationId: input.conversationId,
        userId: decision.userId,
      });

      await warnIfOverloaded(input.organizationId, decision.userId);
    }
  } else if (decision.notifyCandidates.length > 0) {
    // Estratégia "primeiro disponível": avisa todos e espera alguém assumir.
    for (const userId of decision.notifyCandidates) {
      await notify({
        organizationId: input.organizationId,
        userId,
        type: "conversation_assigned",
        title: "Nova conversa disponível",
        body: "Um cliente está aguardando. O atendimento é de quem assumir primeiro.",
        conversationId: input.conversationId,
      });
    }
  }

  return { assignedUserId: decision.userId, reason: decision.reason };
}

/** Carrega os vendedores elegíveis com a carga atual de cada um. */
export async function loadCandidates(
  organizationId: string,
  teamId: string | null,
): Promise<Candidate[]> {
  const db = await getDb();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      isActive: users.isActive,
      availabilityStatus: users.availabilityStatus,
      maxConcurrentConversations: users.maxConcurrentConversations,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.isActive, true),
        // Administradores participam da fila apenas se estiverem em uma equipe.
        ne(users.role, "admin"),
      ),
    );

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const memberships = await db
    .select({ userId: teamMembers.userId, teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(inArray(teamMembers.userId, ids));

  const teamsByUser = new Map<string, string[]>();
  for (const m of memberships) {
    const list = teamsByUser.get(m.userId) ?? [];
    list.push(m.teamId);
    teamsByUser.set(m.userId, list);
  }

  const loads = await db
    .select({
      userId: conversations.assignedUserId,
      total: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        inArray(conversations.status, ["in_progress", "waiting", "waiting_customer"]),
        inArray(conversations.assignedUserId, ids),
      ),
    )
    .groupBy(conversations.assignedUserId);

  const loadByUser = new Map<string, number>();
  for (const l of loads) {
    if (l.userId) loadByUser.set(l.userId, Number(l.total));
  }

  const candidates: Candidate[] = rows.map((row) => ({
    userId: row.id,
    name: row.name,
    isActive: row.isActive,
    availabilityStatus: row.availabilityStatus,
    activeConversations: loadByUser.get(row.id) ?? 0,
    maxConcurrentConversations: row.maxConcurrentConversations,
    teamIds: teamsByUser.get(row.id) ?? [],
    createdAtMs: row.createdAt.getTime(),
  }));

  if (teamId) return candidates.filter((c) => c.teamIds.includes(teamId));
  return candidates;
}

/** Avisa supervisores quando um vendedor passa de 80% do limite. */
async function warnIfOverloaded(organizationId: string, userId: string) {
  const db = await getDb();
  const [user] = await db
    .select({
      name: users.name,
      max: users.maxConcurrentConversations,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.max <= 0) return;

  const active = Number(
    await db.$count(
      conversations,
      and(
        eq(conversations.assignedUserId, userId),
        inArray(conversations.status, ["in_progress", "waiting", "waiting_customer"]),
      ),
    ),
  );

  if (active < Math.ceil(user.max * 0.8)) return;

  const supervisors = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        inArray(users.role, ["admin", "supervisor"]),
        eq(users.isActive, true),
      ),
    );

  for (const supervisor of supervisors) {
    await notify({
      organizationId,
      userId: supervisor.id,
      type: "seller_overloaded",
      title: "Vendedor próximo do limite",
      body: `${user.name} está com ${active} de ${user.max} atendimentos simultâneos.`,
    });
  }
}
