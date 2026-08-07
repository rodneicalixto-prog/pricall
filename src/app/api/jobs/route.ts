/**
 * Tarefas periódicas (SLA, reatribuição, lembretes, limpeza).
 * Protegido por token de cabeçalho (cron externo) ou por sessão de administrador.
 */
import { runScheduledJobs } from "@/server/services/automations";
import { can } from "@/lib/auth/rbac";
import { getAuthContext } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { safeCompare } from "@/lib/auth/session";
import { errors } from "@/lib/errors";
import { handler, jsonOk } from "@/server/http";

/** O agendador do Vercel só faz GET; um cron externo pode usar POST. */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  return handler(async () => {
    /**
     * Três formas de autorizar, nesta ordem:
     *  1. `x-pricall-job-token` — cron externo (curl, GitHub Actions…)
     *  2. `Authorization: Bearer …` — formato do Vercel Cron (CRON_SECRET)
     *  3. sessão de administrador — disparo manual pelo painel
     */
    const expected = process.env.JOB_TOKEN ?? process.env.CRON_SECRET;
    const headerProprio = request.headers.get("x-pricall-job-token");
    const bearer = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");

    const byToken = Boolean(
      expected &&
        ((headerProprio && safeCompare(headerProprio, expected)) ||
          (bearer && safeCompare(bearer, expected))),
    );

    if (!byToken) {
      const auth = await getAuthContext();
      if (!auth || !can(auth, "health.retry_events")) {
        throw errors.forbidden("Somente administradores podem disparar as tarefas.");
      }
    }

    const result = await runScheduledJobs();
    return jsonOk({ executadoEm: new Date().toISOString(), ...result, ambiente: env.nodeEnv });
  });
}
