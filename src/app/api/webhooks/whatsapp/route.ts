/**
 * Webhook do WhatsApp (Cloud API e Evolution).
 *
 * O endpoint faz o mínimo antes de responder: valida a assinatura, converte o
 * payload e registra os eventos. O processamento é idempotente e roda logo
 * após a resposta, para a Meta nunca sofrer timeout.
 */
import { NextResponse } from "next/server";
import { describeError } from "@/lib/audit";
import { env } from "@/lib/env";
import { checkRateLimit, clientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { safeCompare } from "@/lib/auth/session";
import { providerByName } from "@/modules/whatsapp";
import { ingestEvents } from "@/server/services/inbound";

/** Verificação inicial exigida pela Meta (hub.challenge). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = env.whatsapp.verifyToken;
  if (!expected) {
    return new NextResponse("Webhook não configurado.", { status: 503 });
  }
  if (mode !== "subscribe" || !token || !safeCompare(token, expected)) {
    return new NextResponse("Token de verificação inválido.", { status: 403 });
  }
  return new NextResponse(challenge ?? "", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

export async function POST(request: Request) {
  const limit = checkRateLimit(`webhook:${clientIp(request)}`, RATE_LIMITS.webhook);
  if (!limit.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: { "retry-after": String(limit.retryAfterSeconds) },
    });
  }

  const rawBody = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Responde 200 para a plataforma não ficar reenviando lixo.
    return NextResponse.json({ received: true, ignored: "payload inválido" });
  }

  // Descobre o provedor pelo formato do envelope.
  const providerName = detectProvider(payload);
  const provider = providerByName(providerName);

  if (!provider.verifySignature(rawBody, request.headers)) {
    return new NextResponse("Assinatura inválida.", { status: 401 });
  }

  let events;
  try {
    events = provider.parseWebhook(payload, request.headers);
  } catch (error) {
    console.error("[pricall] webhook ilegível:", describeError(error));
    return NextResponse.json({ received: true, ignored: "estrutura desconhecida" });
  }

  if (events.length === 0) {
    return NextResponse.json({ received: true, events: 0 });
  }

  // Processamento síncrono e curto: apenas gravações indexadas.
  // Falhas ficam registradas em integration_events para reprocessamento.
  try {
    const result = await ingestEvents(providerName, events, payload);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    console.error("[pricall] falha ao registrar webhook:", describeError(error));
    // 500 faz a plataforma reenviar — a idempotência protege contra duplicidade.
    return new NextResponse("Falha temporária.", { status: 500 });
  }
}

function detectProvider(payload: unknown): "cloud_api" | "evolution" | "mock" {
  if (payload && typeof payload === "object") {
    if ("object" in payload && "entry" in payload) return "cloud_api";
    if ("event" in payload && "instance" in payload) return "evolution";
  }
  return "mock";
}
