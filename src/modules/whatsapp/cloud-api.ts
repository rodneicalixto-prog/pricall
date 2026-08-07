/**
 * WhatsApp Business Platform — Cloud API (Meta).
 *
 * Somente a API oficial via Graph. Nenhuma automação de WhatsApp Web.
 * As credenciais vêm por variável de ambiente / cofre; o banco guarda apenas
 * a referência ao segredo.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
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

type GraphError = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

export class CloudApiProvider implements WhatsappProvider {
  readonly name = "cloud_api" as const;

  constructor(private readonly credentials: ProviderCredentials) {}

  private get baseUrl(): string {
    return `${env.whatsapp.graphBaseUrl}/${env.whatsapp.graphVersion}`;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const { accessToken, phoneNumberId } = this.credentials;
    if (!accessToken || !phoneNumberId) {
      return {
        ok: false,
        errorCode: "unauthorized",
        message: "Credenciais do WhatsApp não configuradas para este número.",
        retryable: false,
      };
    }

    const body = buildGraphPayload(message);

    try {
      const response = await fetch(`${this.baseUrl}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });

      const json = (await response.json().catch(() => ({}))) as GraphError & {
        messages?: { id: string }[];
      };

      if (!response.ok) return mapGraphError(response.status, json);

      const id = json.messages?.[0]?.id;
      if (!id) {
        return {
          ok: false,
          errorCode: "unknown",
          message: "A API não retornou o identificador da mensagem.",
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
          ? "Tempo esgotado ao falar com a API do WhatsApp."
          : "Não foi possível alcançar a API do WhatsApp.",
        retryable: true,
      };
    }
  }

  /** Valida `X-Hub-Signature-256` com o app secret. */
  verifySignature(rawBody: string, headers: Headers): boolean {
    const appSecret = this.credentials.appSecret ?? env.whatsapp.appSecret;
    const header = headers.get("x-hub-signature-256");
    if (!appSecret) {
      // Sem segredo configurado, recusa em produção e aceita em dev.
      return !env.isProduction;
    }
    if (!header?.startsWith("sha256=")) return false;

    const expected = createHmac("sha256", appSecret)
      .update(rawBody, "utf8")
      .digest("hex");
    const received = header.slice("sha256=".length);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(received, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    const root = payload as {
      entry?: {
        id?: string;
        changes?: {
          value?: {
            metadata?: { phone_number_id?: string };
            contacts?: { wa_id?: string; profile?: { name?: string } }[];
            messages?: RawMessage[];
            statuses?: RawStatus[];
          };
        }[];
      }[];
    };

    for (const entry of root?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        const channelKey = value.metadata?.phone_number_id ?? "";
        const nameByWaId = new Map<string, string>();
        for (const contact of value.contacts ?? []) {
          if (contact.wa_id && contact.profile?.name) {
            nameByWaId.set(contact.wa_id, contact.profile.name);
          }
        }

        for (const raw of value.messages ?? []) {
          const normalized = normalizeMessage(raw, channelKey, nameByWaId);
          if (normalized) events.push(normalized);
        }
        for (const raw of value.statuses ?? []) {
          const normalized = normalizeStatus(raw, channelKey);
          if (normalized) events.push(normalized);
        }
      }
    }
    return events;
  }

  async checkConnection(): Promise<ConnectionCheck> {
    const { accessToken, phoneNumberId } = this.credentials;
    if (!accessToken || !phoneNumberId) {
      return { ok: false, detail: "Token de acesso ou número não configurado." };
    }
    try {
      const response = await fetch(
        `${this.baseUrl}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      const json = (await response.json().catch(() => ({}))) as GraphError & {
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
      };
      if (!response.ok) {
        return {
          ok: false,
          detail: sanitizeGraphMessage(json) ?? `Erro HTTP ${response.status}.`,
        };
      }
      return {
        ok: true,
        detail: `Conectado como ${json.verified_name ?? "número verificado"} (qualidade: ${json.quality_rating ?? "n/d"}).`,
        displayPhoneNumber: json.display_phone_number,
      };
    } catch {
      return { ok: false, detail: "Não foi possível alcançar a Graph API." };
    }
  }

  requiresTemplate(lastInboundAt: Date | null): boolean {
    return !isWithinServiceWindow(lastInboundAt);
  }
}

/* ------------------------------------------------------------------ *
 * Normalização de payload
 * ------------------------------------------------------------------ */

type RawMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  location?: { latitude?: number; longitude?: number; name?: string };
  context?: { id?: string };
};

type RawStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { title?: string; message?: string; code?: number }[];
};

function normalizeMessage(
  raw: RawMessage,
  channelKey: string,
  names: Map<string, string>,
): NormalizedInboundMessage | null {
  if (!raw.id || !raw.from) return null;

  const timestamp = raw.timestamp
    ? new Date(Number(raw.timestamp) * 1000)
    : new Date();

  const base = {
    kind: "message" as const,
    externalEventId: raw.id,
    channelKey,
    whatsappMessageId: raw.id,
    from: raw.from,
    contactName: names.get(raw.from),
    replyToWhatsappId: raw.context?.id,
    timestamp,
  };

  switch (raw.type) {
    case "text":
      return { ...base, messageType: "text", text: raw.text?.body ?? "" };
    case "image":
      return {
        ...base,
        messageType: "image",
        text: raw.image?.caption,
        mediaUrl: mediaReference(raw.image?.id),
        mediaMimeType: raw.image?.mime_type,
      };
    case "audio":
      return {
        ...base,
        messageType: "audio",
        mediaUrl: mediaReference(raw.audio?.id),
        mediaMimeType: raw.audio?.mime_type,
      };
    case "video":
      return {
        ...base,
        messageType: "video",
        text: raw.video?.caption,
        mediaUrl: mediaReference(raw.video?.id),
        mediaMimeType: raw.video?.mime_type,
      };
    case "document":
      return {
        ...base,
        messageType: "document",
        text: raw.document?.caption,
        mediaUrl: mediaReference(raw.document?.id),
        mediaMimeType: raw.document?.mime_type,
        mediaFileName: raw.document?.filename,
      };
    case "location":
      return {
        ...base,
        messageType: "location",
        text: [
          raw.location?.name,
          raw.location?.latitude != null && raw.location?.longitude != null
            ? `${raw.location.latitude},${raw.location.longitude}`
            : null,
        ]
          .filter(Boolean)
          .join(" — "),
      };
    default:
      return {
        ...base,
        messageType: "system",
        text: `Mensagem do tipo "${raw.type ?? "desconhecido"}" recebida.`,
      };
  }
}

function normalizeStatus(
  raw: RawStatus,
  channelKey: string,
): NormalizedStatusUpdate | null {
  if (!raw.id || !raw.status) return null;
  const map: Record<string, NormalizedStatusUpdate["status"]> = {
    sent: "sent",
    delivered: "delivered",
    read: "read",
    failed: "failed",
  };
  const status = map[raw.status];
  if (!status) return null;

  return {
    kind: "status",
    // O mesmo id de mensagem recebe vários status; a chave inclui o status.
    externalEventId: `${raw.id}:${raw.status}`,
    channelKey,
    whatsappMessageId: raw.id,
    status,
    failureReason: raw.errors?.[0]?.title ?? raw.errors?.[0]?.message,
    timestamp: raw.timestamp ? new Date(Number(raw.timestamp) * 1000) : new Date(),
  };
}

/**
 * A Cloud API entrega apenas o media id; o download exige token e é feito
 * sob demanda pelo backend (`/api/media/[id]`).
 */
function mediaReference(mediaId?: string): string | undefined {
  return mediaId ? `whatsapp-media:${mediaId}` : undefined;
}

function buildGraphPayload(message: OutboundMessage): Record<string, unknown> {
  const context = "replyToWhatsappId" in message && message.replyToWhatsappId
    ? { context: { message_id: message.replyToWhatsappId } }
    : {};

  if (message.kind === "text") {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.to,
      type: "text",
      text: { preview_url: true, body: message.text },
      ...context,
    };
  }

  if (message.kind === "template") {
    return {
      messaging_product: "whatsapp",
      to: message.to,
      type: "template",
      template: {
        name: message.templateName,
        language: { code: message.languageCode },
        components: message.components ?? [],
      },
    };
  }

  const payload: Record<string, unknown> = {
    link: message.mediaUrl,
  };
  if (message.caption && message.mediaType !== "audio") {
    payload.caption = message.caption;
  }
  if (message.mediaType === "document" && message.fileName) {
    payload.filename = message.fileName;
  }

  return {
    messaging_product: "whatsapp",
    to: message.to,
    type: message.mediaType,
    [message.mediaType]: payload,
    ...context,
  };
}

function mapGraphError(status: number, json: GraphError): SendResult {
  const code = json.error?.code;
  const message = sanitizeGraphMessage(json) ?? `Erro HTTP ${status}.`;

  if (status === 401 || status === 403 || code === 190) {
    return {
      ok: false,
      errorCode: "unauthorized",
      message: "Credenciais do WhatsApp inválidas ou expiradas.",
      retryable: false,
    };
  }
  if (status === 429 || code === 4 || code === 80007) {
    return {
      ok: false,
      errorCode: "rate_limited",
      message: "Limite de envio da plataforma atingido. Tente novamente em instantes.",
      retryable: true,
    };
  }
  if (code === 131047 || code === 131051) {
    return {
      ok: false,
      errorCode: "outside_window",
      message:
        "A janela de 24 horas expirou. Use uma mensagem de modelo aprovado para reabrir a conversa.",
      retryable: false,
    };
  }
  if (code === 132000 || code === 132001) {
    return {
      ok: false,
      errorCode: "template_required",
      message: "Modelo de mensagem inválido ou não aprovado.",
      retryable: false,
    };
  }
  if (code === 131026 || code === 131052) {
    return {
      ok: false,
      errorCode: "invalid_number",
      message: "O número informado não possui WhatsApp ativo.",
      retryable: false,
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      errorCode: "unavailable",
      message: "A plataforma do WhatsApp está instável. Tentaremos novamente.",
      retryable: true,
    };
  }
  return { ok: false, errorCode: "unknown", message, retryable: false };
}

/** Remove qualquer trecho que pareça token antes de logar/exibir. */
function sanitizeGraphMessage(json: GraphError): string | undefined {
  const raw = json.error?.message;
  if (!raw) return undefined;
  return raw.replace(/\b(EAA|Bearer\s+)[A-Za-z0-9_\-.]{8,}/g, "[oculto]");
}
