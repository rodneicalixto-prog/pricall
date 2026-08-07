/**
 * Leitura centralizada das variáveis de ambiente.
 *
 * Nenhum segredo é exportado para o cliente: este módulo só é importado por
 * código server-side. Os valores públicos ficam em `publicEnv`.
 */

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function bool(name: string, fallback = false): boolean {
  const value = optional(name);
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on", "sim"].includes(value.toLowerCase());
}

function int(name: string, fallback: number): number {
  const value = optional(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test" || bool("VITEST"),

  appName: optional("APP_NAME") ?? "PRICALL",
  appUrl: optional("APP_URL") ?? "http://localhost:3000",

  /**
   * Driver do banco:
   *  - `postgres`: conecta em DATABASE_URL (Supabase, RDS, Postgres gerenciado).
   *  - `pglite`:   Postgres embutido em WASM, persistido em disco. Serve para
   *                desenvolvimento e demonstração sem nenhum serviço externo.
   */
  databaseDriver: (optional("DATABASE_DRIVER") ??
    (optional("DATABASE_URL") ? "postgres" : "pglite")) as
    | "postgres"
    | "pglite",
  databaseUrl: optional("DATABASE_URL"),
  /**
   * Conexão direta (sem pooler) usada pelo LISTEN/NOTIFY do tempo real.
   * Pooler em transaction mode — Supabase na porta 6543, Neon "pooled" —
   * descarta a subscrição, então o canal precisa da porta 5432.
   * Sem esta variável, o tempo real fica restrito à própria instância.
   */
  databaseUrlDirect:
    optional("DATABASE_URL_UNPOOLED") ??
    optional("DIRECT_URL") ??
    optional("DATABASE_URL_DIRECT"),
  pgliteDataDir: optional("PGLITE_DATA_DIR") ?? ".pgdata",

  /** Chave usada para derivar/assinar valores de sessão. */
  sessionSecret:
    optional("SESSION_SECRET") ??
    (process.env.NODE_ENV === "production"
      ? ""
      : "pricall-dev-secret-nao-usar-em-producao"),
  sessionTtlHours: int("SESSION_TTL_HOURS", 12),
  sessionRememberTtlDays: int("SESSION_REMEMBER_TTL_DAYS", 30),

  /** Bloqueio temporário de login. */
  loginMaxAttempts: int("LOGIN_MAX_ATTEMPTS", 5),
  loginLockoutMinutes: int("LOGIN_LOCKOUT_MINUTES", 15),

  /* ---------------- WhatsApp Cloud API (Meta) ---------------- */
  whatsapp: {
    graphVersion: optional("WHATSAPP_GRAPH_VERSION") ?? "v21.0",
    graphBaseUrl:
      optional("WHATSAPP_GRAPH_BASE_URL") ?? "https://graph.facebook.com",
    accessToken: optional("WHATSAPP_ACCESS_TOKEN"),
    verifyToken: optional("WHATSAPP_VERIFY_TOKEN"),
    appSecret: optional("WHATSAPP_APP_SECRET"),
    phoneNumberId: optional("WHATSAPP_PHONE_NUMBER_ID"),
    businessAccountId: optional("WHATSAPP_BUSINESS_ACCOUNT_ID"),
  },

  /* ---------------- Evolution API ---------------- */
  evolution: {
    baseUrl: optional("EVOLUTION_API_URL"),
    apiKey: optional("EVOLUTION_API_KEY"),
    instance: optional("EVOLUTION_INSTANCE"),
    webhookToken: optional("EVOLUTION_WEBHOOK_TOKEN"),
  },

  /* ---------------- IA ---------------- */
  ai: {
    provider: (optional("AI_PROVIDER") ?? "mock") as "mock" | "anthropic",
    apiKey: optional("ANTHROPIC_API_KEY"),
    model: optional("AI_MODEL") ?? "claude-sonnet-5",
    maxTokens: int("AI_MAX_TOKENS", 700),
  },

  /* ---------------- E-mail transacional ---------------- */
  mail: {
    /**
     * `log`    — imprime no servidor, não envia nada (padrão em dev).
     * `smtp`   — qualquer servidor SMTP, inclusive Gmail com Senha de App.
     * `resend` — API do Resend, para volume maior.
     */
    provider: (optional("MAIL_PROVIDER") ?? "log") as "log" | "smtp" | "resend",
    from: optional("MAIL_FROM") ?? "PRICALL <nao-responda@localhost>",
    replyTo: optional("MAIL_REPLY_TO"),
    smtp: {
      host: optional("MAIL_SMTP_HOST"),
      port: int("MAIL_SMTP_PORT", 587),
      user: optional("MAIL_SMTP_USER"),
      password: optional("MAIL_SMTP_PASSWORD"),
      secure: optional("MAIL_SMTP_SECURE")
        ? bool("MAIL_SMTP_SECURE")
        : undefined,
    },
    resendApiKey: optional("RESEND_API_KEY"),
  },

  /* ---------------- Observabilidade ---------------- */
  sentryDsn: optional("SENTRY_DSN"),
  logLevel: optional("LOG_LEVEL") ?? "info",

  /** Habilita o seed de demonstração e o selo "Modo demonstração". */
  demoModeEnabled: bool("DEMO_MODE_ENABLED", true),
} as const;

export const publicEnv = {
  appName: env.appName,
  appUrl: env.appUrl,
};

/**
 * Valida a configuração mínima para subir em produção.
 * Chamado no boot do servidor (src/instrumentation.ts).
 */
export function assertProductionEnv(): string[] {
  const problems: string[] = [];
  if (!env.isProduction) return problems;

  if (!env.sessionSecret || env.sessionSecret.length < 32) {
    problems.push(
      "SESSION_SECRET ausente ou curto demais (mínimo de 32 caracteres).",
    );
  }
  if (env.databaseDriver === "pglite") {
    problems.push(
      "DATABASE_URL não configurado. PGlite não deve ser usado em produção.",
    );
  }
  if (env.mail.provider === "smtp" && !env.mail.smtp.password) {
    problems.push("MAIL_PROVIDER=smtp exige MAIL_SMTP_PASSWORD.");
  }
  if (env.mail.provider === "resend" && !env.mail.resendApiKey) {
    problems.push("MAIL_PROVIDER=resend exige RESEND_API_KEY.");
  }
  return problems;
}
