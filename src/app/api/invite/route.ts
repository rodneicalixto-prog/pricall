import { z } from "zod";
import { acceptInvitation } from "@/server/services/team";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { enforceRateLimit, handler, jsonOk, parseBody } from "@/server/http";

const schema = z
  .object({
    token: z.string().min(10),
    password: z.string().min(8, "A senha deve ter ao menos 8 caracteres."),
    passwordConfirmation: z.string(),
    phone: z.string().optional(),
  })
  .refine((d) => d.password === d.passwordConfirmation, {
    message: "As senhas não conferem.",
    path: ["passwordConfirmation"],
  });

export async function POST(request: Request) {
  return handler(async () => {
    enforceRateLimit(request, RATE_LIMITS.invite, "invite-accept");
    const body = await parseBody(request, schema);
    const user = await acceptInvitation(body.token, {
      password: body.password,
      phone: body.phone,
    });
    return jsonOk({ userId: user.id, redirectTo: "/entrar" });
  });
}
