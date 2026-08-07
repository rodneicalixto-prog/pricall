import { z } from "zod";
import { resetPassword } from "@/server/services/auth-service";
import { enforceRateLimit, handler, jsonOk, parseBody } from "@/server/http";
import { RATE_LIMITS } from "@/lib/rate-limit";

const schema = z
  .object({
    token: z.string().min(10),
    password: z.string().min(8, "A senha deve ter ao menos 8 caracteres."),
    passwordConfirmation: z.string(),
  })
  .refine((d) => d.password === d.passwordConfirmation, {
    message: "As senhas não conferem.",
    path: ["passwordConfirmation"],
  });

export async function POST(request: Request) {
  return handler(async () => {
    enforceRateLimit(request, RATE_LIMITS.passwordReset, "reset");
    const body = await parseBody(request, schema);
    await resetPassword(body.token, body.password);
    return jsonOk({ message: "Senha redefinida. Entre novamente.", redirectTo: "/entrar" });
  });
}
