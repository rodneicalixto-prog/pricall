/**
 * Mensagens: leitura paginada do histórico e envio ao cliente.
 *
 * Fluxo 3 do escopo: a mensagem é gravada como `queued` ANTES da chamada
 * externa. Se o envio falhar, o registro permanece com status `failed` e o
 * vendedor pode tentar novamente — o texto digitado nunca se perde.
 */
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contacts,
  conversations,
  messages,
  users,
  whatsappConnections,
  type MessageStatusValue,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { errors, systemMessages } from "@/lib/errors";
import { publish } from "@/lib/realtime/bus";
import { providerFor, validateMedia, type OutboundMessage } from "@/modules/whatsapp";
import { assertConversationAccess } from "./conversations";
import { notify } from "./notifications";

const PAGE_SIZE = 40;

export type MessageItem = {
  id: string;
  conversationId: string;
  senderType: string;
  senderUserId: string | null;
  senderName: string | null;
  messageType: string;
  content: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  replyToMessageId: string | null;
  direction: string;
  status: MessageStatusValue;
  failureReason: string | null;
  aiSuggested: boolean;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
};

/**
 * Histórico paginado, do mais recente para o mais antigo.
 * O cursor é o `createdAt` da mensagem mais antiga já carregada.
 */
export async function listMessages(
  auth: AuthContext,
  conversationId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<{ items: MessageItem[]; nextCursor: string | null }> {
  const db = await getDb();
  await assertConversationAccess(auth, conversationId);

  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), 100);
  const filters = [eq(messages.conversationId, conversationId)];
  if (options.cursor) {
    const cursorDate = new Date(options.cursor);
    if (!Number.isNaN(cursorDate.getTime())) {
      filters.push(lt(messages.createdAt, cursorDate));
    }
  }

  const rows = await db
    .select({
      message: messages,
      senderName: users.name,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderUserId))
    .where(and(...filters))
    .orderBy(desc(messages.createdAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit ? page.at(-1)!.message.createdAt.toISOString() : null;

  // Devolve em ordem cronológica para a UI renderizar direto.
  const items = page.reverse().map(({ message, senderName }) => toItem(message, senderName));
  return { items, nextCursor };
}

function toItem(
  message: typeof messages.$inferSelect,
  senderName: string | null,
): MessageItem {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderType: message.senderType,
    senderUserId: message.senderUserId,
    senderName,
    messageType: message.messageType,
    content: message.content,
    mediaUrl: message.mediaUrl,
    mediaMimeType: message.mediaMimeType,
    mediaFileName: message.mediaFileName,
    replyToMessageId: message.replyToMessageId,
    direction: message.direction,
    status: message.status,
    failureReason: message.failureReason,
    aiSuggested: message.aiSuggested,
    createdAt: message.createdAt.toISOString(),
    sentAt: message.sentAt?.toISOString() ?? null,
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    readAt: message.readAt?.toISOString() ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Envio
 * ------------------------------------------------------------------ */

export type SendMessageInput = {
  conversationId: string;
  text?: string;
  media?: {
    type: "image" | "audio" | "video" | "document";
    url: string;
    mimeType: string;
    sizeBytes: number;
    fileName?: string;
  };
  replyToMessageId?: string;
  /** Marca que o texto nasceu de uma sugestão da IA (para auditoria). */
  aiSuggested?: boolean;
};

export async function sendMessage(auth: AuthContext, input: SendMessageInput) {
  const db = await getDb();
  const conversation = await assertConversationAccess(auth, input.conversationId);

  if (!input.text?.trim() && !input.media) {
    throw errors.validation("Escreva uma mensagem ou anexe um arquivo.");
  }
  if (input.text && input.text.length > 4096) {
    throw errors.validation("A mensagem excede o limite de 4096 caracteres.");
  }
  if (input.media) {
    const check = validateMedia(
      input.media.type,
      input.media.mimeType,
      input.media.sizeBytes,
    );
    if (!check.ok) throw errors.validation(check.message);
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, conversation.contactId))
    .limit(1);
  if (!contact) throw errors.notFound("Contato não encontrado.");
  if (contact.isBlocked) throw errors.validation(systemMessages.contactBlocked);

  const [connection] = conversation.whatsappConnectionId
    ? await db
        .select()
        .from(whatsappConnections)
        .where(eq(whatsappConnections.id, conversation.whatsappConnectionId))
        .limit(1)
    : [];
  if (!connection) {
    throw errors.integrationUnavailable(
      "Nenhuma conexão de WhatsApp associada a este atendimento.",
    );
  }
  if (connection.status === "disabled") {
    throw errors.integrationUnavailable(systemMessages.connectionNeedsReview);
  }

  const provider = providerFor(connection);

  // Janela de atendimento: fora dela, só mensagem de modelo aprovado.
  if (provider.requiresTemplate(conversation.lastInboundAt)) {
    throw errors.validation(
      "A janela de 24 horas expirou. Para reabrir a conversa é necessário enviar uma mensagem de modelo aprovado pelo WhatsApp.",
    );
  }

  // 1) Persiste como `queued` antes de qualquer chamada externa.
  const now = new Date();
  const [pending] = await db
    .insert(messages)
    .values({
      organizationId: auth.organizationId,
      conversationId: input.conversationId,
      senderType: "seller",
      senderUserId: auth.userId,
      messageType: input.media?.type ?? "text",
      content: input.text?.trim() ?? null,
      mediaUrl: input.media?.url ?? null,
      mediaMimeType: input.media?.mimeType ?? null,
      mediaFileName: input.media?.fileName ?? null,
      mediaSizeBytes: input.media?.sizeBytes ?? null,
      replyToMessageId: input.replyToMessageId ?? null,
      direction: "outbound",
      status: "queued",
      aiSuggested: input.aiSuggested ?? false,
      createdAt: now,
    })
    .returning();

  await publish(auth.organizationId, {
    type: "message.created",
    conversationId: input.conversationId,
    messageId: pending.id,
    direction: "outbound",
  });

  // 2) Envia pelo provedor.
  const replyToWhatsappId = input.replyToMessageId
    ? await lookupWhatsappId(input.replyToMessageId)
    : undefined;

  const outbound: OutboundMessage = input.media
    ? {
        kind: "media",
        to: contact.whatsappId,
        mediaType: input.media.type,
        mediaUrl: input.media.url,
        caption: input.text?.trim(),
        fileName: input.media.fileName,
        replyToWhatsappId,
      }
    : {
        kind: "text",
        to: contact.whatsappId,
        text: input.text!.trim(),
        replyToWhatsappId,
      };

  const result = await provider.send(outbound);

  // 3) Atualiza o status conforme o retorno.
  if (!result.ok) {
    const [failed] = await db
      .update(messages)
      .set({ status: "failed", failureReason: result.message })
      .where(eq(messages.id, pending.id))
      .returning();

    await db
      .update(whatsappConnections)
      .set({
        lastErrorAt: new Date(),
        lastErrorMessage: result.message,
        ...(result.errorCode === "unauthorized" ? { status: "error" as const } : {}),
      })
      .where(eq(whatsappConnections.id, connection.id));

    await notify({
      organizationId: auth.organizationId,
      userId: auth.userId,
      type: "message_failed",
      title: "Falha ao enviar mensagem",
      body: result.message,
      conversationId: input.conversationId,
    });

    await publish(auth.organizationId, {
      type: "message.status",
      conversationId: input.conversationId,
      messageId: pending.id,
      status: "failed",
    });

    return {
      message: toItem(failed, auth.name),
      delivery: { ok: false as const, retryable: result.retryable, message: result.message },
    };
  }

  const sentAt = new Date();
  const [sent] = await db
    .update(messages)
    .set({
      status: "sent",
      whatsappMessageId: result.whatsappMessageId,
      sentAt,
      failureReason: null,
    })
    .where(eq(messages.id, pending.id))
    .returning();

  // 4) Atualiza a conversa (primeira resposta, últimas atividades).
  await db
    .update(conversations)
    .set({
      lastMessageAt: sentAt,
      lastOutboundAt: sentAt,
      firstResponseAt: conversation.firstResponseAt ?? sentAt,
      status:
        conversation.status === "closed"
          ? "in_progress"
          : conversation.status === "unassigned" || conversation.status === "waiting"
            ? "in_progress"
            : conversation.status,
      assignedUserId: conversation.assignedUserId ?? auth.userId,
      assignedAt: conversation.assignedAt ?? sentAt,
      unreadCount: 0,
      updatedAt: sentAt,
      version: sql`${conversations.version} + 1`,
    })
    .where(eq(conversations.id, input.conversationId));

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "message.sent",
    entityType: "message",
    entityId: sent.id,
    metadata: {
      conversationId: input.conversationId,
      tipo: sent.messageType,
      sugeridaPorIa: sent.aiSuggested,
      provedor: provider.name,
    },
  });

  await publish(auth.organizationId, {
    type: "message.status",
    conversationId: input.conversationId,
    messageId: sent.id,
    status: "sent",
  });
  await publish(auth.organizationId, {
    type: "conversation.updated",
    conversationId: input.conversationId,
  });

  return { message: toItem(sent, auth.name), delivery: { ok: true as const } };
}

/** Reenvia uma mensagem que falhou, sem duplicar o registro. */
export async function retryMessage(auth: AuthContext, messageId: string) {
  const db = await getDb();
  const [message] = await db
    .select()
    .from(messages)
    .where(
      and(eq(messages.id, messageId), eq(messages.organizationId, auth.organizationId)),
    )
    .limit(1);

  if (!message) throw errors.notFound("Mensagem não encontrada.");
  if (message.status !== "failed") {
    throw errors.validation("Só é possível reenviar mensagens que falharam.");
  }

  await db.delete(messages).where(eq(messages.id, messageId));

  return sendMessage(auth, {
    conversationId: message.conversationId,
    text: message.content ?? undefined,
    media: message.mediaUrl
      ? {
          type: message.messageType as "image" | "audio" | "video" | "document",
          url: message.mediaUrl,
          mimeType: message.mediaMimeType ?? "application/octet-stream",
          sizeBytes: message.mediaSizeBytes ?? 0,
          fileName: message.mediaFileName ?? undefined,
        }
      : undefined,
    replyToMessageId: message.replyToMessageId ?? undefined,
    aiSuggested: message.aiSuggested,
  });
}

/** Registra uma nota interna (não vai para o cliente). */
export async function addInternalNote(
  auth: AuthContext,
  conversationId: string,
  text: string,
) {
  const db = await getDb();
  await assertConversationAccess(auth, conversationId);
  if (!text.trim()) throw errors.validation("A observação não pode ficar vazia.");

  const [note] = await db
    .insert(messages)
    .values({
      organizationId: auth.organizationId,
      conversationId,
      senderType: "system",
      senderUserId: auth.userId,
      messageType: "system",
      content: text.trim(),
      direction: "outbound",
      status: "sent",
      sentAt: new Date(),
      metadata: { notaInterna: true },
    })
    .returning();

  await publish(auth.organizationId, {
    type: "message.created",
    conversationId,
    messageId: note.id,
    direction: "outbound",
  });

  return toItem(note, auth.name);
}

async function lookupWhatsappId(messageId: string): Promise<string | undefined> {
  const db = await getDb();
  const [row] = await db
    .select({ whatsappMessageId: messages.whatsappMessageId })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  return row?.whatsappMessageId ?? undefined;
}

/** Ordem cronológica usada pelo resumo de IA e pelos relatórios. */
export async function recentMessages(conversationId: string, limit = 30) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export { asc };
