import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

/**
 * O Sentry só entra em cena quando há DSN configurado. Sem ele, exportamos a
 * configuração crua — o build local e os testes não dependem de rede nem de
 * variáveis extras.
 */
function comSentry(config: NextConfig): NextConfig {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return config;

  // Import síncrono só neste caminho, para não pesar o build sem Sentry.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { withSentryConfig } = require("@sentry/nextjs");

  return withSentryConfig(config, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: true,
    // Envia os source maps e os remove do bundle público: rastreamento
    // legível no painel sem expor o código-fonte no navegador.
    widenClientFileUpload: true,
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    // Contorna bloqueadores de anúncio que barram chamadas ao Sentry.
    tunnelRoute: "/monitoramento",
    disableLogger: true,
    automaticVercelMonitors: true,
  });
}

export default comSentry(nextConfig);
