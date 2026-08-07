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

export async function POST(request: Request) {
  return handler(async () => {
    const token = request.headers.get("x-pricall-job-token");
    const expected = process.env.JOB_TOKEN;

    const byToken = Boolean(expected && token && safeCompare(token, expected));
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
