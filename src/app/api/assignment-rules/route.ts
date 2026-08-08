/**
 * Regra principal de distribuição.
 *
 * A estratégia era definida uma única vez no onboarding e não havia como
 * revisá-la — quem passasse batido ficava com distribuição manual sem
 * entender por que os vendedores nunca recebiam conversa.
 */
import { z } from "zod";
import { getMainRule, updateMainRule } from "@/server/services/assignment-service";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const estrategias = [
  "manual",
  "round_robin",
  "least_active",
  "first_available",
  "team_based",
] as const;

const bodySchema = z.object({
  strategy: z.enum(estrategias),
  teamId: z.string().uuid().nullable().optional(),
  requireOnline: z.boolean().optional(),
  fallbackStrategy: z.enum(["manual", "round_robin", "least_active"]).nullable().optional(),
});

export async function GET() {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk(await getMainRule(auth));
  });
}

export async function PATCH(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const body = await parseBody(request, bodySchema);
    return jsonOk(await updateMainRule(auth, body));
  });
}
