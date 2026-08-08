/**
 * Evolution API.
 *
 * Mesma interface do provedor oficial. A Evolution expõe endpoints REST por
 * instância e envia webhooks com o envelope `{ event, instance, data }`.
 */
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type {
  ConnectionCheck,
  NormalizedEvent,
  NormalizedInboundMessage,
  NormalizedStatusUpdate,
  OutboundMessage,
  ProviderCredentials,
  SendResult,
  WhatsappProvider,
} from "./provider";
import { isWithinServiceWindow } from "./provider";

export class EvolutionProvider implements WhatsappProvider {
  readonly name = "evolution" as const;

  constructor(private readonly credentials: ProviderCredentials) {}

  private get baseUrl(): string {
    return (
      this.credentials.apiBaseUrl ??
      env.evolution.baseUrl ??
      ""
    ).replace(/\/+$/, "");
  }

  private get instance(): string {
    return this.credentials.instanceName ?? env.evolution.instance ?? "";
  }

  private get apiKey(): string | undefined {
    return this.credentials.apiKey ?? env.evolution.apiKey;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.baseUrl || !this.instance || !this.apiKey) {
      return {
        ok: false,
        errorCode: "unauthorized",
        message: "Conexão Evolution incompleta (URL, instância ou chave).",
        retryable: false,
      };
    }

    const { path, body } = buildEvolutionPayload(message, this.instance);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          apikey: this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });

      const json = (await response.json().catch(() => ({}))) as {
        key?: { id?: string };
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            errorCode: "unauthorized",
            message: "Chave de API da Evolution inválida.",
            retryable: false,
          };
        }
        if (response.status === 429) {
          return {
            ok: false,
            errorCode: "rate_limited",
            message: "Limite de envio da Evolution atingido.",
            retryable: true,
          };
        }
        if (response.status >= 500) {
          return {
            ok: false,
            errorCode: "unavailable",
            message: "A instância da Evolution está indisponível.",
            retryable: true,
          };
        }
        return {
          ok: false,
          errorCode: "unknown",
          message: sanitize(json.error ?? json.message) ?? `Erro HTTP ${response.status}.`,
          retryable: false,
        };
      }

      const id = json.key?.id;
      if (!id) {
        return {
          ok: false,
          errorCode: "unknown",
          message: "A Evolution não retornou o identificador da mensagem.",
          retryable: true,
        };
      }
      return { ok: true, whatsappMessageId: id };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return {
        ok: false,
        errorCode: "unavailable",
        message: timedOut
          ? "Tempo esgotado ao falar com a Evolution API."
          : "Não foi possível alcançar a Evolution API.",
        retryable: true,
      };
    }
  }

  /** A Evolution não assina o corpo; usamos um token compartilhado no header. */
  /**
   * A Evolution não assina o corpo do webhook, então a autenticidade vem de um
   * segredo compartilhado que só nós e a instalação dela conhecemos.
   *
   * O cabeçalho é o caminho preferido. A query string existe porque vários
   * painéis do Evolution Manager não têm campo para cabeçalho personalizado —
   * sem essa alternativa, a única saída seria configurar o webhook pela API,
   * de linha de comando. O segredo na URL aparece em log de servidor, o que é
   * pior que no cabeçalho; por isso ela é a segunda opção, e a limpeza do
   * Sentry já oculta a query string desta rota.
   */
  verifySignature(_rawBody: string, headers: Headers, url?: URL): boolean {
    const expected = env.evolution.webhookToken;
    if (!expected) return !env.isProduction;

    const received =
      headers.get("x-evolution-token") ??
      headers.get("authorization") ??
      url?.searchParams.get("token") ??
      "";

    const clean = received.replace(/^Bearer\s+/i, "");
    const a = Buffer.from(expected);
    const b = Buffer.from(clean);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown): NormalizedEvent[] {
    const envelope = payload as {
      event?: string;
      instance?: string;
      data?: unknown;
    };
    if (!envelope?.event) return [];

    const instance = envelope.instance ?? this.instance;
    const items = Array.isArray(envelope.data) ? envelope.data : [envelope.data];
    const events: NormalizedEvent[] = [];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const event = envelope.event.toLowerCase();

      if (event === "messages.upsert" || event === "messages.update") {
        const normalized = normalizeEvolutionMessage(item as RawEvolutionMessage, instance);
        if (normalized) events.push(normalized);
      }
      if (
        event === "messages.update" ||
        event === "send.message" ||
        event === "message.status"
      ) {
        const status = normalizeEvolutionStatus(item as RawEvolutionMessage, instance);
        if (status) events.push(status);
      }
    }
    return events;
  }

  async checkConnection(): Promise<ConnectionCheck> {
    if (!this.baseUrl || !this.instance || !this.apiKey) {
      return { ok: false, detail: "Conexão Evolution incompleta." };
    }
    try {
      const response = await fetch(
        `${this.baseUrl}/instance/connectionState/${encodeURIComponent(this.instance)}`,
        { headers: { apikey: this.apiKey }, signal: AbortSignal.timeout(15_000) },
      );
      const json = (await response.json().catch(() => ({}))) as {
        instance?: { state?: string; owner?: string };
      };
      if (!response.ok) {
        return { ok: false, detail: `Erro HTTP ${response.status} na Evolution.` };
      }
      const state = json.instance?.state ?? "desconhecido";
      return {
        ok: state === "open",
        detail: `Instância "${this.instance}" no estado: ${state}.`,
        displayPhoneNumber: json.instance?.owner?.split("@")[0],
      };
    } catch {
      return { ok: false, detail: "Não foi possível alcançar a Evolution API." };
    }
  }

  /**
   * A Evolution opera sobre uma sessão pessoal e não impõe a janela de 24 h
   * da Cloud API. Ainda assim o sistema registra a janela para métricas.
   */
  requiresTemplate(lastInboundAt: Date | null): boolean {
    void isWithinServiceWindow(lastInboundAt);
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Normalização
 * ------------------------------------------------------------------ */

type RawEvolutionMessage = {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean };
  pushName?: string;
  messageTimestamp?: number | string;
  status?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string; contextInfo?: { stanzaId?: string } };
    imageMessage?: { url?: string; mimetype?: string; caption?: string };
    audioMessage?: { url?: string; mimetype?: string };
    videoMessage?: { url?: string; mimetype?: string; caption?: string };
    documentMessage?: { url?: string; mimetype?: string; fileName?: string; caption?: string };
    locationMessage?: { degreesLatitude?: number; degreesLongitude?: number; name?: string };
  };
};

function jidToPhone(jid?: string): string {
  return (jid ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
}

function normalizeEvolutionMessage(
  raw: RawEvolutionMessage,
  instance: string,
): NormalizedInboundMessage | null {
  if (!raw.key?.id) return null;
  /**
   * `remoteJid` é sempre o outro lado da conversa, tenha a mensagem chegado ou
   * saído — então ele identifica o contato nos dois casos. Mensagem própria
   * (`fromMe`) já foi descartada aqui, o que apagava do histórico tudo que o
   * vendedor respondia pelo celular.
   */
  const from = jidToPhone(raw.key.remoteJid);
  if (!from) return null;
  // Grupos e listas de transmissão ficam fora do escopo do atendimento 1:1.
  if ((raw.key.remoteJid ?? "").includes("@g.us")) return null;

  const m = raw.message ?? {};
  const timestamp = raw.messageTimestamp
    ? new Date(Number(raw.messageTimestamp) * 1000)
    : new Date();

  const base = {
    kind: "message" as const,
    externalEventId: raw.key.id,
    channelKey: instance,
    whatsappMessageId: raw.key.id,
    from,
    // `pushName` é o nome de quem enviou; em mensagem própria seria o nome da
    // empresa, não o do contato — então só aproveitamos quando veio de fora.
    contactName: raw.key.fromMe ? undefined : raw.pushName,
    replyToWhatsappId: m.extendedTextMessage?.contextInfo?.stanzaId,
    fromMe: raw.key.fromMe === true,
    timestamp,
  };

  if (m.conversation || m.extendedTextMessage?.text) {
    return {
      ...base,
      messageType: "text",
      text: m.conversation ?? m.extendedTextMessage?.text ?? "",
    };
  }
  if (m.imageMessage) {
    return {
      ...base,
      messageType: "image",
      text: m.imageMessage.caption,
      mediaUrl: m.imageMessage.url,
      mediaMimeType: m.imageMessage.mimetype,
    };
  }
  if (m.audioMessage) {
    return {
      ...base,
      messageType: "audio",
      mediaUrl: m.audioMessage.url,
      mediaMimeType: m.audioMessage.mimetype,
    };
  }
  if (m.videoMessage) {
    return {
      ...base,
      messageType: "video",
      text: m.videoMessage.caption,
      mediaUrl: m.videoMessage.url,
      mediaMimeType: m.videoMessage.mimetype,
    };
  }
  if (m.documentMessage) {
    return {
      ...base,
      messageType: "document",
      text: m.documentMessage.caption,
      mediaUrl: m.documentMessage.url,
      mediaMimeType: m.documentMessage.mimetype,
      mediaFileName: m.documentMessage.fileName,
    };
  }
  if (m.locationMessage) {
    return {
      ...base,
      messageType: "location",
      text: [
        m.locationMessage.name,
        `${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}`,
      ]
        .filter(Boolean)
        .join(" — "),
    };
  }
  return { ...base, messageType: "system", text: "Mensagem recebida." };
}

function normalizeEvolutionStatus(
  raw: RawEvolutionMessage,
  instance: string,
): NormalizedStatusUpdate | null {
  if (!raw.key?.id || !raw.status) return null;
  const map: Record<string, NormalizedStatusUpdate["status"]> = {
    PENDING: "sent",
    SERVER_ACK: "sent",
    DELIVERY_ACK: "delivered",
    READ: "read",
    PLAYED: "read",
    ERROR: "failed",
  };
  const status = map[raw.status.toUpperCase()];
  if (!status) return null;

  return {
    kind: "status",
    externalEventId: `${raw.key.id}:${raw.status}`,
    channelKey: instance,
    whatsappMessageId: raw.key.id,
    status,
    timestamp: raw.messageTimestamp
      ? new Date(Number(raw.messageTimestamp) * 1000)
      : new Date(),
  };
}

function buildEvolutionPayload(
  message: OutboundMessage,
  instance: string,
): { path: string; body: Record<string, unknown> } {
  const number = message.to.replace(/\D/g, "");
  const quoted =
    "replyToWhatsappId" in message && message.replyToWhatsappId
      ? { quoted: { key: { id: message.replyToWhatsappId } } }
      : {};

  if (message.kind === "text") {
    return {
      path: `/message/sendText/${encodeURIComponent(instance)}`,
      body: { number, text: message.text, ...quoted },
    };
  }
  if (message.kind === "template") {
    // A Evolution não usa modelos aprovados: envia como texto simples.
    return {
      path: `/message/sendText/${encodeURIComponent(instance)}`,
      body: { number, text: message.templateName },
    };
  }
  return {
    path: `/message/sendMedia/${encodeURIComponent(instance)}`,
    body: {
      number,
      mediatype: message.mediaType,
      media: message.mediaUrl,
      caption: message.caption,
      fileName: message.fileName,
      ...quoted,
    },
  };
}

function sanitize(value?: string): string | undefined {
  if (!value) return undefined;
  return value.replace(/[A-Za-z0-9_-]{24,}/g, "[oculto]");
}
