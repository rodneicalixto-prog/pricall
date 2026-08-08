/**
 * Fluxo 1 do escopo: processamento de eventos recebidos do WhatsApp.
 *
 * Propriedades garantidas aqui:
 *  - Idempotência: `integration_events` tem índice único por
 *    (provider, external_event_id). Um webhook repetido é ignorado.
 *  - Tolerância a fora de ordem: atualizações de status só avançam
 *    (sent → delivered → read); nunca retrocedem.
 *  - Resposta rápida: o endpoint apenas registra o evento e dispara o
 *    processamento; nada de trabalho pesado antes de responder.
 */
import { createHash } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contacts,
  conversations,
  integrationEvents,
  messages,
  users,
  whatsappConnections,
  type WhatsappConnection,
} from "@/db/schema";
import { describeError, recordConversationEvent, sanitizeMetadata } from "@/lib/audit";
import { isWithinBusinessHours } from "@/lib/business-hours";
import { normalizePhone } from "@/lib/phone";
import { publish } from "@/lib/realtime/bus";
import type {
  NormalizedEvent,
  NormalizedInboundMessage,
  NormalizedStatusUpdate,
} from "@/modules/whatsapp";
import { autoAssign } from "./assignment-service";
import { notify } from "./notifications";
import { getOrganization } from "./organization";

/** Ordem de progressão dos status; impede retrocesso por evento atrasado. */
const STATUS_RANK: Record<string, number> = {
  queued: 0,
  received: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload) ?? "").digest("hex");
}

export type IngestResult = {
  accepted: number;
  duplicated: number;
  failed: number;
};

/**
 * Registra os eventos e processa cada um com idempotência.
 * Erros de um evento não interrompem os demais.
 */
export async function ingestEvents(
  provider: string,
  events: NormalizedEvent[],
  rawPayload: unknown,
): Promise<IngestResult> {
  const result: IngestResult = { accepted: 0, duplicated: 0, failed: 0 };
  const db = await getDb();
  const hash = payloadHash(rawPayload);

  for (const event of events) {
    // 1) Reserva o evento. O índice único faz o trabalho de deduplicação.
    const inserted = await db
      .insert(integrationEvents)
      .values({
        provider,
        externalEventId: event.externalEventId,
        eventType: event.kind === "message" ? "message.received" : "message.status",
        payloadHash: hash,
        processingStatus: "processing",
        attemptCount: 1,
        payload: sanitizeMetadata(event) as Record<string, unknown>,
      })
      .onConflictDoNothing({
        target: [integrationEvents.provider, integrationEvents.externalEventId],
        // O índice único é parcial; o predicado precisa ser repetido aqui,
        // senão o Postgres não consegue inferir o índice do ON CONFLICT.
        where: sql`${integrationEvents.externalEventId} is not null`,
      })
      .returning({ id: integrationEvents.id });

    if (inserted.length === 0) {
      result.duplicated += 1;
      continue;
    }

    const eventRowId = inserted[0].id;

    try {
      const organizationId =
        event.kind === "message"
          ? await processInboundMessage(event)
          : await processStatusUpdate(event);

      await db
        .update(integrationEvents)
        .set({
          processingStatus: organizationId ? "processed" : "ignored",
          organizationId: organizationId ?? null,
          processedAt: new Date(),
        })
        .where(eq(integrationEvents.id, eventRowId));

      result.accepted += 1;
    } catch (error) {
      const message = describeError(error);
      await db
        .update(integrationEvents)
        .set({
          processingStatus: "failed",
          errorMessage: message.slice(0, 500),
          // Backoff progressivo: 1ª repetição em 30 s.
          nextRetryAt: new Date(Date.now() + 30_000),
        })
        .where(eq(integrationEvents.id, eventRowId));
      console.error("[pricall] falha ao processar evento de integração:", message);
      result.failed += 1;
    }
  }

  return result;
}

/* ------------------------------------------------------------------ *
 * Mensagem recebida
 * ------------------------------------------------------------------ */

async function processInboundMessage(
  event: NormalizedInboundMessage,
): Promise<string | null> {
  const db = await getDb();

  // 5) Localiza a conexão e, por ela, a empresa.
  const connection = await findConnection(event.channelKey);
  if (!connection) return null;

  const organizationId = connection.organizationId;
  const organization = await getOrganization(organizationId);
  const phone = normalizePhone(event.from);

  // 6) Localiza ou cria o contato.
  const contact = await upsertContact({
    organizationId,
    whatsappId: event.from,
    phone,
    name: event.contactName?.trim() || phone,
    profilePictureUrl: event.profilePictureUrl,
    isDemo: connection.isDemo,
    at: event.timestamp,
  });

  if (contact.isBlocked) {
    // Contato bloqueado: registra o evento, mas não cria conversa nem notifica.
    return organizationId;
  }

  // 7) Localiza uma conversa aberta ou cria uma nova.
  const { conversation, created, reopened } = await findOrCreateConversation({
    organizationId,
    contactId: contact.id,
    connection,
    at: event.timestamp,
    timezone: organization.timezone,
    businessHours: organization.businessHours,
  });

  /**
   * Mensagem que saiu do próprio número — alguém respondeu pelo aplicativo do
   * celular, fora da central. Precisa entrar no histórico como saída: sem
   * isso o painel mostra a pergunta do cliente e não a resposta que ele
   * recebeu, e o próximo vendedor responde de novo o que já foi respondido.
   *
   * A idempotência por `whatsapp_message_id` cuida do eco: quando a própria
   * central envia, a Evolution devolve a mesma mensagem por webhook, e ela é
   * descartada por já existir.
   */
  const respostaPropria = event.fromMe === true;

  // 8) Salva a mensagem (idempotente pelo whatsapp_message_id).
  const inserted = await db
    .insert(messages)
    .values({
      organizationId,
      conversationId: conversation.id,
      whatsappMessageId: event.whatsappMessageId,
      // Sem `senderUserId`: não há como saber quem digitou no celular.
      senderType: respostaPropria ? "seller" : "contact",
      messageType: event.messageType,
      content: event.text ?? null,
      mediaUrl: event.mediaUrl ?? null,
      mediaMimeType: event.mediaMimeType ?? null,
      mediaFileName: event.mediaFileName ?? null,
      replyToMessageId: await resolveReplyTarget(
        conversation.id,
        event.replyToWhatsappId,
      ),
      direction: respostaPropria ? "outbound" : "inbound",
      status: respostaPropria ? "sent" : "received",
      sentAt: event.timestamp,
      createdAt: event.timestamp,
    })
    .onConflictDoNothing({
      target: messages.whatsappMessageId,
      where: sql`${messages.whatsappMessageId} is not null`,
    })
    .returning({ id: messages.id });

  if (inserted.length === 0) {
    // A mensagem já existia (webhook duplicado com id externo diferente).
    return organizationId;
  }

  // 9) Atualiza atividade e contador de não lidas.
  await db
    .update(conversations)
    .set({
      lastMessageAt: event.timestamp,
      updatedAt: new Date(),
      version: sql`${conversations.version} + 1`,
      /**
       * Resposta própria não é mensagem para ler nem reinicia a janela de
       * atendimento — ao contrário, indica que o cliente está aguardando
       * retorno. Contá-la como não lida colocaria um selo vermelho na conversa
       * por causa do que a própria equipe escreveu.
       */
      ...(respostaPropria
        ? {
            // Quem respondeu passou a bola ao cliente; a conversa fica
            // aguardando retorno em vez de continuar como pendente na fila.
            ...(conversation.status === "in_progress" ||
            conversation.status === "waiting" ||
            conversation.status === "unassigned"
              ? { status: "waiting_customer" as const }
              : {}),
          }
        : {
            lastInboundAt: event.timestamp,
            unreadCount: sql`${conversations.unreadCount} + 1`,
            ...(conversation.status === "waiting_customer"
              ? { status: "in_progress" as const }
              : {}),
          }),
    })
    .where(eq(conversations.id, conversation.id));

  await db
    .update(contacts)
    .set({ lastContactAt: event.timestamp })
    .where(eq(contacts.id, contact.id));

  await db
    .update(whatsappConnections)
    .set({ lastWebhookAt: new Date(), status: "connected" })
    .where(eq(whatsappConnections.id, connection.id));

  await publish(organizationId, {
    type: "message.created",
    conversationId: conversation.id,
    messageId: inserted[0].id,
    direction: respostaPropria ? "outbound" : "inbound",
  });

  if (created) {
    await recordConversationEvent({
      organizationId,
      conversationId: conversation.id,
      eventType: "created",
      newValue: { origem: "mensagem recebida", conexao: connection.label },
    });
    await publish(organizationId, {
      type: "conversation.created",
      conversationId: conversation.id,
    });
  }
  if (reopened) {
    await recordConversationEvent({
      organizationId,
      conversationId: conversation.id,
      eventType: "reopened",
      newValue: { status: "in_progress" },
      metadata: { motivo: "nova mensagem do cliente" },
    });
  }

  // 10/11) Distribuição automática e notificação.
  //
  // Resposta própria não distribui nem notifica: ninguém precisa ser avisado
  // do que a própria equipe acabou de escrever, e a conversa já está sendo
  // atendida por quem respondeu pelo celular.
  if (!respostaPropria && !conversation.assignedUserId) {
    const outsideHours =
      conversation.outsideBusinessHours &&
      organization.settings?.assignOutsideBusinessHours === false;

    if (!outsideHours) {
      await autoAssign({
        organizationId,
        conversationId: conversation.id,
        messageText: event.text,
        connectionId: connection.id,
        preferredTeamId: connection.teamId ?? null,
      });
    }
  } else if (!respostaPropria && conversation.assignedUserId) {
    await notify({
      organizationId,
      userId: conversation.assignedUserId,
      type: "customer_replied",
      title: `${contact.name} respondeu`,
      body: (event.text ?? "Nova mensagem recebida.").slice(0, 140),
      conversationId: conversation.id,
    });
  }

  await publish(organizationId, {
    type: "conversation.updated",
    conversationId: conversation.id,
  });

  return organizationId;
}

/* ------------------------------------------------------------------ *
 * Atualização de status
 * ------------------------------------------------------------------ */

async function processStatusUpdate(
  event: NormalizedStatusUpdate,
): Promise<string | null> {
  const db = await getDb();

  const [message] = await db
    .select({
      id: messages.id,
      organizationId: messages.organizationId,
      conversationId: messages.conversationId,
      status: messages.status,
      senderUserId: messages.senderUserId,
    })
    .from(messages)
    .where(eq(messages.whatsappMessageId, event.whatsappMessageId))
    .limit(1);

  if (!message) return null;

  // Descarta eventos fora de ordem (ex.: `sent` chegando depois de `read`).
  const currentRank = STATUS_RANK[message.status] ?? 0;
  const incomingRank = STATUS_RANK[event.status] ?? 0;
  if (incomingRank <= currentRank && event.status !== "failed") {
    return message.organizationId;
  }

  await db
    .update(messages)
    .set({
      status: event.status,
      failureReason: event.failureReason ?? null,
      ...(event.status === "sent" ? { sentAt: event.timestamp } : {}),
      ...(event.status === "delivered" ? { deliveredAt: event.timestamp } : {}),
      ...(event.status === "read" ? { readAt: event.timestamp } : {}),
    })
    .where(eq(messages.id, message.id));

  if (event.status === "failed" && message.senderUserId) {
    await notify({
      organizationId: message.organizationId,
      userId: message.senderUserId,
      type: "message_failed",
      title: "Falha na entrega da mensagem",
      body: event.failureReason ?? "O WhatsApp não conseguiu entregar a mensagem.",
      conversationId: message.conversationId,
    });
  }

  await publish(message.organizationId, {
    type: "message.status",
    conversationId: message.conversationId,
    messageId: message.id,
    status: event.status,
  });

  return message.organizationId;
}

/* ------------------------------------------------------------------ *
 * Auxiliares
 * ------------------------------------------------------------------ */

/** Resolve a conexão pelo phone_number_id (Cloud API) ou instância (Evolution). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findConnection(
  channelKey: string,
): Promise<WhatsappConnection | null> {
  const db = await getDb();

  const clauses = [
    eq(whatsappConnections.phoneNumberId, channelKey),
    eq(whatsappConnections.instanceName, channelKey),
  ];
  // A coluna `id` é uuid: comparar com texto arbitrário aborta a consulta
  // inteira no Postgres, então só entra quando o formato bate.
  if (UUID_PATTERN.test(channelKey)) {
    clauses.push(eq(whatsappConnections.id, channelKey));
  }

  const [row] = await db
    .select()
    .from(whatsappConnections)
    .where(or(...clauses))
    .limit(1);
  return row ?? null;
}

async function upsertContact(input: {
  organizationId: string;
  whatsappId: string;
  phone: string;
  name: string;
  profilePictureUrl?: string;
  isDemo: boolean;
  at: Date;
}) {
  const db = await getDb();

  const [row] = await db
    .insert(contacts)
    .values({
      organizationId: input.organizationId,
      whatsappId: input.whatsappId,
      phone: input.phone,
      name: input.name,
      profilePictureUrl: input.profilePictureUrl ?? null,
      source: "whatsapp",
      isDemo: input.isDemo,
      firstContactAt: input.at,
      lastContactAt: input.at,
    })
    .onConflictDoUpdate({
      target: [contacts.organizationId, contacts.whatsappId],
      set: { lastContactAt: input.at, updatedAt: new Date() },
    })
    .returning();

  return row;
}

async function findOrCreateConversation(input: {
  organizationId: string;
  contactId: string;
  connection: WhatsappConnection;
  at: Date;
  timezone: string;
  businessHours: Parameters<typeof isWithinBusinessHours>[0];
}) {
  const db = await getDb();

  const [open] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, input.organizationId),
        eq(conversations.contactId, input.contactId),
        sql`${conversations.status} <> 'closed'`,
      ),
    )
    .orderBy(sql`${conversations.lastMessageAt} desc`)
    .limit(1);

  if (open) return { conversation: open, created: false, reopened: false };

  // Uma conversa encerrada recentemente é reaberta em vez de duplicada.
  const [recentlyClosed] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, input.organizationId),
        eq(conversations.contactId, input.contactId),
        eq(conversations.status, "closed"),
        sql`${conversations.closedAt} > now() - interval '24 hours'`,
      ),
    )
    .orderBy(sql`${conversations.closedAt} desc`)
    .limit(1);

  if (recentlyClosed) {
    const [reopened] = await db
      .update(conversations)
      .set({
        status: recentlyClosed.assignedUserId ? "in_progress" : "unassigned",
        closedAt: null,
        closedBy: null,
        updatedAt: new Date(),
        version: sql`${conversations.version} + 1`,
      })
      .where(eq(conversations.id, recentlyClosed.id))
      .returning();
    return { conversation: reopened, created: false, reopened: true };
  }

  const withinHours = isWithinBusinessHours(
    input.businessHours,
    input.timezone,
    input.at,
  );

  const [created] = await db
    .insert(conversations)
    .values({
      organizationId: input.organizationId,
      contactId: input.contactId,
      whatsappConnectionId: input.connection.id,
      assignedTeamId: input.connection.teamId ?? null,
      // Número individual de vendedor já nasce com responsável.
      assignedUserId: input.connection.ownerUserId ?? null,
      status: input.connection.ownerUserId ? "in_progress" : "unassigned",
      assignedAt: input.connection.ownerUserId ? input.at : null,
      priority: "normal",
      unreadCount: 0,
      outsideBusinessHours: !withinHours,
      isDemo: input.connection.isDemo,
      lastMessageAt: input.at,
    })
    .returning();

  return { conversation: created, created: true, reopened: false };
}

async function resolveReplyTarget(
  conversationId: string,
  whatsappMessageId?: string,
): Promise<string | null> {
  if (!whatsappMessageId) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.whatsappMessageId, whatsappMessageId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/* ------------------------------------------------------------------ *
 * Reprocessamento de eventos com falha
 * ------------------------------------------------------------------ */

/** Reprocessa um evento que falhou (ação de administrador no painel). */
export async function retryIntegrationEvent(
  organizationId: string,
  eventId: string,
): Promise<{ ok: boolean; detail: string }> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.id, eventId),
        or(
          eq(integrationEvents.organizationId, organizationId),
          isNull(integrationEvents.organizationId),
        ),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, detail: "Evento não encontrado." };
  if (row.processingStatus === "processed") {
    return { ok: false, detail: "Este evento já foi processado." };
  }
  if (!row.payload) {
    return { ok: false, detail: "Evento sem payload armazenado." };
  }

  try {
    const event = row.payload as unknown as NormalizedEvent;
    // O payload salvo já está normalizado; datas voltam como string.
    const revived = {
      ...event,
      timestamp: new Date((event as { timestamp: string | Date }).timestamp),
    } as NormalizedEvent;

    const resolvedOrg =
      revived.kind === "message"
        ? await processInboundMessage(revived)
        : await processStatusUpdate(revived);

    await db
      .update(integrationEvents)
      .set({
        processingStatus: resolvedOrg ? "processed" : "ignored",
        organizationId: resolvedOrg ?? row.organizationId,
        attemptCount: row.attemptCount + 1,
        processedAt: new Date(),
        errorMessage: null,
        nextRetryAt: null,
      })
      .where(eq(integrationEvents.id, eventId));

    return { ok: true, detail: "Evento reprocessado com sucesso." };
  } catch (error) {
    const message = describeError(error);
    // Backoff progressivo: 30 s, 60 s, 120 s, … até 30 min.
    const delay = Math.min(30_000 * 2 ** row.attemptCount, 1_800_000);
    await db
      .update(integrationEvents)
      .set({
        attemptCount: row.attemptCount + 1,
        errorMessage: message.slice(0, 500),
        nextRetryAt: new Date(Date.now() + delay),
      })
      .where(eq(integrationEvents.id, eventId));
    return { ok: false, detail: `Falha ao reprocessar: ${message}` };
  }
}

export { users };
