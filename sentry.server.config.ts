/**
 * Sentry no runtime Node (route handlers e server components).
 * Sem SENTRY_DSN, `init` não é chamado e nada é enviado.
 */
import * as Sentry from "@sentry/nextjs";
import { limparEvento, opcoesSentry, sentryHabilitado } from "@/lib/observability";

if (sentryHabilitado) {
  Sentry.init({
    ...opcoesSentry,
    beforeSend: (evento, hint) => limparEvento(evento, hint),
  });
}
