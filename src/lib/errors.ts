/**
 * Erros de aplicação com código estável e mensagem já em português,
 * pronta para ser exibida ao usuário. Nada de payload cru ou stack trace
 * vazando para o cliente.
 */

export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "integration_unavailable"
  | "internal";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 422,
  rate_limited: 429,
  integration_unavailable: 503,
  internal: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const errors = {
  unauthenticated: (msg = "Sua sessão expirou. Entre novamente.") =>
    new AppError("unauthenticated", msg),
  forbidden: (msg = "Você não possui permissão para executar esta ação.") =>
    new AppError("forbidden", msg),
  notFound: (msg = "Registro não encontrado.") => new AppError("not_found", msg),
  conflict: (msg: string, details?: Record<string, unknown>) =>
    new AppError("conflict", msg, details),
  validation: (msg: string, details?: Record<string, unknown>) =>
    new AppError("validation", msg, details),
  rateLimited: (msg = "Muitas tentativas. Aguarde alguns instantes.") =>
    new AppError("rate_limited", msg),
  integrationUnavailable: (
    msg = "A conexão com o WhatsApp está temporariamente indisponível.",
  ) => new AppError("integration_unavailable", msg),
  internal: (msg = "Não foi possível concluir a operação.") =>
    new AppError("internal", msg),
};

/** Mensagens de sistema reaproveitadas em várias telas. */
export const systemMessages = {
  conversationAlreadyTaken:
    "Este atendimento já foi assumido por outro vendedor.",
  noPermission: "Você não possui permissão para executar esta ação.",
  sendFailed: "Não foi possível enviar a mensagem. Tente novamente.",
  connectionNeedsReview: "A conexão com o WhatsApp precisa ser revisada.",
  contactBlocked: "Contato bloqueado. O envio está desativado.",
  offline:
    "Você está offline. As atualizações serão retomadas quando a conexão voltar.",
  loadConversationsFailed: "Não foi possível carregar as conversas.",
  emptyQueue: "Nenhuma conversa aguardando atendimento.",
  messageSavedNotSent: "Mensagem salva, mas ainda não enviada.",
} as const;
