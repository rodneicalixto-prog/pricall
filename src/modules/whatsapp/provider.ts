/**
 * Contrato do provedor de WhatsApp.
 *
 * O restante da aplicação nunca fala com a Meta ou com a Evolution
 * diretamente: fala com esta interface. Isso permite trocar de provedor,
 * rodar em modo demonstração e testar sem rede.
 */

export type OutboundMessage =
  | { kind: "text"; to: string; text: string; replyToWhatsappId?: string }
  | {
      kind: "media";
      to: string;
      mediaType: "image" | "audio" | "video" | "document";
      mediaUrl: string;
      caption?: string;
      fileName?: string;
      replyToWhatsappId?: string;
    }
  | {
      kind: "template";
      to: string;
      templateName: string;
      languageCode: string;
      components?: unknown[];
    };

export type SendResult =
  | { ok: true; whatsappMessageId: string; providerStatus?: string }
  | {
      ok: false;
      /** Código estável para tratamento no serviço de envio. */
      errorCode:
        | "invalid_number"
        | "outside_window"
        | "template_required"
        | "rate_limited"
        | "unauthorized"
        | "unavailable"
        | "unknown";
      /** Mensagem já sanitizada, segura para log e para a UI. */
      message: string;
      retryable: boolean;
    };

/** Evento normalizado, independente do formato de cada provedor. */
export type NormalizedInboundMessage = {
  kind: "message";
  externalEventId: string;
  /** Identificador do número que recebeu (phone_number_id ou instância). */
  channelKey: string;
  whatsappMessageId: string;
  from: string;
  contactName?: string;
  profilePictureUrl?: string;
  messageType:
    | "text"
    | "image"
    | "audio"
    | "video"
    | "document"
    | "location"
    | "template"
    | "system";
  text?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaFileName?: string;
  replyToWhatsappId?: string;
  /**
   * Verdadeiro quando a mensagem saiu do próprio número — tipicamente porque
   * alguém respondeu pelo aplicativo do celular, fora da central.
   *
   * Numa central compartilhada isso precisa entrar no histórico: sem isso, o
   * painel mostra a pergunta do cliente e não a resposta que ele recebeu, e o
   * próximo vendedor a atender responde de novo o que já foi respondido.
   */
  fromMe?: boolean;
  timestamp: Date;
};

export type NormalizedStatusUpdate = {
  kind: "status";
  externalEventId: string;
  channelKey: string;
  whatsappMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  failureReason?: string;
  timestamp: Date;
};

export type NormalizedEvent = NormalizedInboundMessage | NormalizedStatusUpdate;

export type ConnectionCheck = {
  ok: boolean;
  detail: string;
  /** Número exibido pelo provedor, quando disponível. */
  displayPhoneNumber?: string;
};

export type ProviderCredentials = {
  accessToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  apiBaseUrl?: string;
  instanceName?: string;
  apiKey?: string;
  appSecret?: string;
  verifyToken?: string;
};

export interface WhatsappProvider {
  readonly name: "mock" | "cloud_api" | "evolution";

  /** Envia uma mensagem. Nunca lança: erros voltam em `SendResult`. */
  send(message: OutboundMessage): Promise<SendResult>;

  /** Converte o payload bruto do webhook em eventos normalizados. */
  parseWebhook(payload: unknown, headers: Headers): NormalizedEvent[];

  /** Valida a assinatura/segredo do webhook. */
  /**
   * `url` existe porque nem todo painel de Evolution permite configurar
   * cabeçalhos no webhook; nesses casos o token viaja na query string.
   */
  verifySignature(rawBody: string, headers: Headers, url?: URL): boolean;

  /** Testa a conexão (usado pelo painel de integridade). */
  checkConnection(): Promise<ConnectionCheck>;

  /**
   * Indica se a conversa está dentro da janela livre de 24 h.
   * Fora dela, só mensagens de modelo aprovado podem ser enviadas.
   */
  requiresTemplate(lastInboundAt: Date | null): boolean;
}

/** Janela de atendimento livre do WhatsApp: 24 horas após a última mensagem do cliente. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinServiceWindow(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() < CUSTOMER_SERVICE_WINDOW_MS;
}

/** Limites de mídia aceitos pela plataforma (bytes). */
export const MEDIA_LIMITS = {
  image: 5 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
} as const;

export const ALLOWED_MIME_TYPES: Record<
  keyof typeof MEDIA_LIMITS,
  readonly string[]
> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  audio: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/amr"],
  video: ["video/mp4", "video/3gpp"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/csv",
  ],
};

export function validateMedia(
  mediaType: keyof typeof MEDIA_LIMITS,
  mimeType: string,
  sizeBytes: number,
): { ok: true } | { ok: false; message: string } {
  if (!ALLOWED_MIME_TYPES[mediaType].includes(mimeType)) {
    return {
      ok: false,
      message: `Tipo de arquivo não suportado para ${mediaType}: ${mimeType}.`,
    };
  }
  if (sizeBytes > MEDIA_LIMITS[mediaType]) {
    const mb = (MEDIA_LIMITS[mediaType] / (1024 * 1024)).toFixed(0);
    return { ok: false, message: `Arquivo acima do limite de ${mb} MB.` };
  }
  return { ok: true };
}
