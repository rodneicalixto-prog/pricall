/**
 * Sentry no runtime Edge (middleware e rotas edge).
 */
import * as Sentry from "@sentry/nextjs";
import { limparEvento, opcoesSentry, sentryHabilitado } from "@/lib/observability";

if (sentryHabilitado) {
  Sentry.init({
    ...opcoesSentry,
    beforeSend: (evento, hint) => limparEvento(evento, hint),
  });
}
