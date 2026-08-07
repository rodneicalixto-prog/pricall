/**
 * Sentry no navegador.
 *
 * O import é dinâmico de propósito: sem DSN configurado a biblioteca nunca é
 * baixada, e o pacote inicial da aplicação não cresce. Com DSN, ela vem num
 * chunk separado, depois da tela já estar utilizável.
 *
 * Deliberadamente sem Session Replay: a central mostra mensagem de cliente e
 * telefone, e gravar a tela seria incompatível com a política de privacidade
 * do produto.
 */
import { opcoesSentry, sentryHabilitado } from "@/lib/observability";

if (sentryHabilitado) {
  void import("@sentry/nextjs").then(async (Sentry) => {
    const { limparEvento } = await import("@/lib/observability");
    Sentry.init({
      ...opcoesSentry,
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      integrations: [],
      beforeSend: (evento, hint) => limparEvento(evento, hint),
    });
  });
}
