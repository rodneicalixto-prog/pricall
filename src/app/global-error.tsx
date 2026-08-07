"use client";

/**
 * Último recurso: erro que escapou de todos os boundaries.
 * Reporta ao Sentry (quando configurado) e mostra uma tela em português.
 */
import { useEffect } from "react";
import { sentryHabilitado } from "@/lib/observability";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Import dinâmico: sem DSN a biblioteca não entra no pacote da aplicação.
    if (!sentryHabilitado) return;
    void import("@sentry/nextjs").then((Sentry) => {
      Sentry.captureException(error);
    });
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          padding: "24px",
          textAlign: "center",
          fontFamily:
            "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          background: "#F8FAFC",
          color: "#0F172A",
        }}
      >
        <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>
          Algo deu errado
        </h1>
        <p style={{ maxWidth: "28rem", color: "#64748B", margin: 0 }}>
          Não foi possível carregar esta tela. A falha foi registrada e nossa
          equipe consegue investigar.
        </p>
        {error.digest && (
          <p style={{ fontSize: "12px", color: "#94A3B8", margin: 0 }}>
            Código da ocorrência: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "8px",
            minHeight: "44px",
            padding: "0 24px",
            borderRadius: "8px",
            border: "none",
            background: "#16A34A",
            color: "#fff",
            fontSize: "15px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Tentar novamente
        </button>
      </body>
    </html>
  );
}
