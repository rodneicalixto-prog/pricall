/**
 * Registro de auditoria e de eventos de conversa.
 *
 * Nada de token, senha ou payload cru: `sanitizeMetadata` remove chaves
 * sensíveis antes de persistir.
 */
import { getDb } from "@/db";
import { auditLogs, conversationEvents } from "@/db/schema";

const SENSITIVE_KEYS = [
  "password",
  "senha",
  "token",
  "access_token",
  "accesstoken",
  "apikey",
  "api_key",
  "authorization",
  "secret",
  "appsecret",
  "app_secret",
  "cookie",
  "sessionid",
  "session_token",
  "mfasecret",
  "passwordhash",
  "password_hash",
];

export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[profundidade máxima]";
  if (value === null || value === undefined) return value;
  // Date precisa virar ISO antes do jsonb; Object.entries(new Date()) é vazio.
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replace(/[^a-z_]/g, "");
      if (SENSITIVE_KEYS.some((s) => normalized.includes(s.replace(/_/g, "")))) {
        out[key] = "[oculto]";
        continue;
      }
      out[key] = sanitizeMetadata(val, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2000) {
    return `${value.slice(0, 2000)}…`;
  }
  return value;
}

export type AuditInput = {
  organizationId: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

/** Grava um log de auditoria. Nunca lança — auditoria não derruba a operação. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      metadata: input.metadata
        ? (sanitizeMetadata(input.metadata) as Record<string, unknown>)
        : null,
    });
  } catch (error) {
    console.error("[pricall] falha ao gravar auditoria:", describeError(error));
  }
}

export type ConversationEventType =
  | "created"
  | "assigned"
  | "unassigned"
  | "transferred"
  | "status_changed"
  | "priority_changed"
  | "tag_added"
  | "tag_removed"
  | "closed"
  | "reopened"
  | "note_added"
  | "followup_scheduled"
  | "followup_completed"
  | "calendar_event_created"
  | "calendar_event_updated"
  | "escalated"
  | "ai_summary_generated";

export type ConversationEventInput = {
  organizationId: string;
  conversationId: string;
  eventType: ConversationEventType;
  actorUserId?: string | null;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordConversationEvent(
  input: ConversationEventInput,
): Promise<void> {
  const db = await getDb();
  await db.insert(conversationEvents).values({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    eventType: input.eventType,
    actorUserId: input.actorUserId ?? null,
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
    metadata: input.metadata
      ? (sanitizeMetadata(input.metadata) as Record<string, unknown>)
      : null,
  });
}

/** Mensagem de erro sem stack e sem dados sensíveis, para log. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "erro desconhecido";
}
