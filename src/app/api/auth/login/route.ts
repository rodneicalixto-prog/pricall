import { z } from "zod";
import { login } from "@/server/services/auth-service";
import {
  enforceRateLimit,
  handler,
  jsonOk,
  parseBody,
  requestMeta,
} from "@/server/http";
import { RATE_LIMITS } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe sua senha."),
  remember: z.boolean().optional(),
});

export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    enforceRateLimit(request, RATE_LIMITS.login, "login", body.email.toLowerCase());
    const meta = requestMeta(request);
    const { user } = await login({ ...body, ...meta });

    // O redirecionamento depende do perfil.
    const redirectTo = user.role === "seller" ? "/atendimentos" : "/painel";
    return jsonOk({ userId: user.id, role: user.role, redirectTo });
  });
}
