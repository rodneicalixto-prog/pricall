/**
 * Configuração compartilhada do Sentry.
 *
 * Sem `SENTRY_DSN` nada é inicializado e nada é enviado — o sistema funciona
 * igual. Isso mantém desenvolvimento e testes livres de rede.
 *
 * O ponto sensível aqui é privacidade: uma central de atendimento trafega
 * mensagem de cliente, telefone e token de integração. Nada disso pode sair
 * junto com o relatório de erro, então há uma etapa de limpeza antes do envio.
 */
import type { ErrorEvent, EventHint } from "@sentry/nextjs";

export const SENTRY_DSN =
  process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

export const sentryHabilitado = Boolean(SENTRY_DSN);

/** Rotas cujo corpo/parâmetros nunca devem ser anexados a um erro. */
const ROTAS_SENSIVEIS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/reset-password",
  "/api/auth/forgot-password",
  "/api/invite",
  "/api/webhooks/",
  "/api/connections",
];

const CHAVES_SENSIVEIS = [
  "password",
  "senha",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "phone",
  "telefone",
  "content",
  "text",
  "body",
  "mensagem",
];

/**
 * Erros previsíveis do fluxo — sessão expirada, validação, permissão — não
 * são defeito e só poluiriam o painel.
 */
const CODIGOS_IGNORADOS = new Set([
  "unauthenticated",
  "forbidden",
  "validation",
  "not_found",
  "rate_limited",
  "conflict",
]);

export function limparEvento(
  evento: ErrorEvent,
  hint?: EventHint,
): ErrorEvent | null {
  // Descarta erros de negócio esperados.
  const original = hint?.originalException as { code?: string } | undefined;
  if (original?.code && CODIGOS_IGNORADOS.has(original.code)) return null;

  // Nunca envia cookies nem cabeçalhos de autenticação.
  if (evento.request) {
    delete evento.request.cookies;
    if (evento.request.headers) {
      for (const chave of Object.keys(evento.request.headers)) {
        if (
          /authorization|cookie|apikey|x-hub-signature|x-evolution-token|x-pricall-job-token/i.test(
            chave,
          )
        ) {
          evento.request.headers[chave] = "[oculto]";
        }
      }
    }

    const url = evento.request.url ?? "";
    if (ROTAS_SENSIVEIS.some((rota) => url.includes(rota))) {
      delete evento.request.data;
      evento.request.query_string = "[oculto]";
    }
  }

  // Limpa dados anexados manualmente (extra/contexts).
  if (evento.extra) evento.extra = sanitizar(evento.extra) as typeof evento.extra;
  if (evento.contexts) {
    evento.contexts = sanitizar(evento.contexts) as typeof evento.contexts;
  }

  // O usuário é identificado só por id e perfil — sem nome, e-mail ou IP.
  if (evento.user) {
    evento.user = {
      id: evento.user.id,
      ...(evento.user.role ? { role: evento.user.role } : {}),
    };
  }

  // Migalhas de navegação podem carregar corpo de requisição.
  if (evento.breadcrumbs) {
    evento.breadcrumbs = evento.breadcrumbs.map((migalha) => ({
      ...migalha,
      data: migalha.data
        ? (sanitizar(migalha.data) as Record<string, unknown>)
        : undefined,
    }));
  }

  return evento;
}

function sanitizar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 5) return "[profundidade máxima]";
  if (valor === null || valor === undefined) return valor;
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) {
    return valor.slice(0, 20).map((item) => sanitizar(item, profundidade + 1));
  }
  if (typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
      const normalizada = chave.toLowerCase().replace(/[^a-z]/g, "");
      if (CHAVES_SENSIVEIS.some((s) => normalizada.includes(s.replace(/_/g, "")))) {
        saida[chave] = "[oculto]";
        continue;
      }
      saida[chave] = sanitizar(item, profundidade + 1);
    }
    return saida;
  }
  return valor;
}

/** Opções comuns aos três ambientes de execução. */
export const opcoesSentry: {
  dsn: string | undefined;
  environment: string;
  release: string | undefined;
  tracesSampleRate: number;
  sendDefaultPii: boolean;
  maxBreadcrumbs: number;
  ignoreErrors: (string | RegExp)[];
} = {
  dsn: SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  release: process.env.VERCEL_GIT_COMMIT_SHA,

  // Amostragem conservadora: erros sempre, desempenho só em parte das requisições.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,

  // Nunca anexar corpo de requisição nem dados de formulário automaticamente.
  sendDefaultPii: false,
  maxBreadcrumbs: 30,

  ignoreErrors: [
    // Ruído de navegador e extensão, sem relação com a aplicação.
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "Non-Error promise rejection captured",
    /^Network request failed$/,
    /Failed to fetch/,
    /Load failed/,
    // Cortes esperados do canal de tempo real em serverless.
    /EventSource/,
  ],
};
