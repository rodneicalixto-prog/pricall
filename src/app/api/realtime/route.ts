/**
 * Canal de tempo real (Server-Sent Events).
 *
 * Só trafega deltas: a UI usa cada evento como gatilho para recarregar
 * exatamente o que mudou, em vez de reprocessar a tela inteira.
 */
import { getAuthContext } from "@/lib/auth/session";
import { subscribe } from "@/lib/realtime/bus";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getAuthContext();
  if (!auth) return new Response("Sessão expirada.", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown, event?: string) => {
        try {
          const payload = event ? `event: ${event}\n` : "";
          controller.enqueue(
            encoder.encode(`${payload}data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      };

      send({ type: "connected", at: new Date().toISOString() });

      unsubscribe = subscribe(auth.organizationId, auth.userId, (envelope) => {
        send(envelope.event, envelope.event.type);
      });

      // Mantém a conexão viva atrás de proxies que cortam ociosidade.
      heartbeat = setInterval(() => send({ type: "heartbeat" }), 25_000);

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
