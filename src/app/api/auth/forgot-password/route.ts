import { z } from "zod";
import { requestPasswordReset } from "@/server/services/auth-service";
import { enforceRateLimit, handler, jsonOk, parseBody } from "@/server/http";
import { RATE_LIMITS } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email("Informe um e-mail válido.") });

export async function POST(request: Request) {
  return handler(async () => {
    const body = await parseBody(request, schema);
    enforceRateLimit(request, RATE_LIMITS.passwordReset, "forgot", body.email);
    await requestPasswordReset(body.email);
    // Resposta idêntica exista ou não a conta (evita enumeração de e-mails).
    return jsonOk({
      message:
        "Se este e-mail estiver cadastrado, enviaremos as instruções de recuperação.",
    });
  });
}
