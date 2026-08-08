/**
 * Barramento de eventos em tempo real.
 *
 * Entrega: SSE (`/api/realtime`) alimentado por um EventEmitter por processo.
 * Em Postgres real, o mesmo evento também vai para `pg_notify`, de modo que
 * várias instâncias da aplicação recebam a publicação (ver `attachPgBridge`).
 *
 * Só trafegam deltas pequenos — nunca a lista inteira de conversas. A UI usa o
 * evento como gatilho para atualizar apenas o que mudou.
 */
import { EventEmitter } from "node:events";
import { env } from "@/lib/env";

export type RealtimeEvent =
  | { type: "conversation.created"; conversationId: string }
  | { type: "conversation.updated"; conversationId: string }
  | { type: "conversation.assigned"; conversationId: string; userId: string | null }
  | { type: "conversation.closed"; conversationId: string }
  | {
      type: "message.created";
      conversationId: string;
      messageId: string;
      direction: "inbound" | "outbound";
    }
  | {
      type: "message.status";
      conversationId: string;
      messageId: string;
      status: string;
    }
  | { type: "notification.created"; userId: string; notificationId: string }
  | {
      type: "presence.updated";
      conversationId: string;
      userId: string;
      userName: string;
      isTyping: boolean;
    }
  | { type: "connection.status"; connectionId: string; status: string }
  | { type: "heartbeat" };

export type RealtimeEnvelope = {
  organizationId: string;
  /** Instância que originou o evento — usado para descartar o eco do pg_notify. */
  origin?: string;
  /** Quando definido, apenas este usuário recebe o evento. */
  targetUserId?: string;
  event: RealtimeEvent;
  emittedAt: string;
};

const CHANNEL = "pricall_realtime";

/** Identifica esta instância do processo. */
const INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

type GlobalBus = { emitter?: EventEmitter; pgBridgeReady?: boolean };
const g = globalThis as unknown as { __pricallBus__?: GlobalBus };
g.__pricallBus__ ??= {};

function emitter(): EventEmitter {
  if (!g.__pricallBus__!.emitter) {
    const e = new EventEmitter();
    e.setMaxListeners(0);
    g.__pricallBus__!.emitter = e;
  }
  return g.__pricallBus__!.emitter;
}

/** Publica um evento para todos os assinantes da organização. */
export async function publish(
  organizationId: string,
  event: RealtimeEvent,
  targetUserId?: string,
): Promise<void> {
  const envelope: RealtimeEnvelope = {
    organizationId,
    origin: INSTANCE_ID,
    targetUserId,
    event,
    emittedAt: new Date().toISOString(),
  };
  emitter().emit(CHANNEL, envelope);
  if (env.databaseDriver === "postgres") {
    void notifyPostgres(envelope);
  }
}

export type Unsubscribe = () => void;

/** Assina os eventos de uma organização (opcionalmente filtrando por usuário). */
export function subscribe(
  organizationId: string,
  userId: string,
  handler: (envelope: RealtimeEnvelope) => void,
): Unsubscribe {
  const listener = (envelope: RealtimeEnvelope) => {
    if (envelope.organizationId !== organizationId) return;
    if (envelope.targetUserId && envelope.targetUserId !== userId) return;
    handler(envelope);
  };
  emitter().on(CHANNEL, listener);
  void attachPgBridge();
  return () => emitter().off(CHANNEL, listener);
}

/* ------------------------------------------------------------------ *
 * Ponte com pg_notify (multi-instância)
 * ------------------------------------------------------------------ */

async function notifyPostgres(envelope: RealtimeEnvelope) {
  try {
    const { getDb } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    const payload = JSON.stringify(envelope);
    // pg_notify limita o payload a 8000 bytes; nossos deltas são bem menores.
    if (payload.length > 7000) return;
    await db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`);
  } catch {
    // A entrega local já ocorreu; a ponte é um reforço, não um requisito.
  }
}

async function attachPgBridge() {
  if (env.databaseDriver !== "postgres") return;
  if (g.__pricallBus__!.pgBridgeReady) return;
  g.__pricallBus__!.pgBridgeReady = true;

  // O LISTEN precisa de conexão direta; o pooler transacional não a mantém.
  const url = env.databaseUrlDirect ?? env.databaseUrl;
  if (!url) {
    g.__pricallBus__!.pgBridgeReady = false;
    return;
  }

  try {
    const postgresModule = await import("postgres");
    const client = postgresModule.default(url, { max: 1 });
    await client.listen(CHANNEL, (payload: string) => {
      try {
        const envelope = JSON.parse(payload) as RealtimeEnvelope;
        // Já entregamos localmente no `publish`; ignora o próprio eco.
        if (envelope.origin === INSTANCE_ID) return;
        emitter().emit(CHANNEL, envelope);
      } catch {
        /* payload inválido é ignorado */
      }
    });
    console.info("[pricall] ponte de tempo real ativa");
  } catch (error) {
    /**
     * Sem esta ponte, um evento publicado por uma instância não chega ao SSE
     * das outras — e o sintoma é a conversa aberta não se atualizar sozinha,
     * sem erro visível em lugar nenhum. Registrar é o que separa "o tempo real
     * está quebrado" de "a mensagem demorou".
     */
    console.error(
      "[pricall] ponte de tempo real indisponível:",
      error instanceof Error ? error.message : "motivo desconhecido",
    );
    g.__pricallBus__!.pgBridgeReady = false;
  }
}
