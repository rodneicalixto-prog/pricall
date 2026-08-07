import { z } from "zod";
import { registerOrganization } from "@/server/services/auth-service";
import {
  enforceRateLimit,
  handler,
  jsonOk,
  parseBody,
  requestMeta,
} from "@/server/http";
import { RATE_LIMITS } from "@/lib/rate-limit";

const schema = z
  .object({
    organizationName: z.string().min(2, "Informe o nome da empresa."),
    responsibleName: z.string().min(2, "Informe o nome do responsável."),
    email: z.string().email("Informe um e-mail válido."),
    phone: z.string().min(8, "Informe um telefone válido."),
    password: z.string().min(8, "A senha deve ter ao menos 8 caracteres."),
    passwordConfirmation: z.string(),
    segment: z.string().min(2, "Informe o segmento da empresa."),
    sellerCount: z.string().min(1),
    acceptedTerms: z.literal(true, {
      message: "É necessário aceitar os termos de uso.",
    }),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "As senhas não conferem.",
    path: ["passwordConfirmation"],
  });

export async function POST(request: Request) {
  return handler(async () => {
    enforceRateLimit(request, RATE_LIMITS.register, "register");
    const body = await parseBody(request, schema);
    const meta = requestMeta(request);
    const result = await registerOrganization({ ...body, ...meta });
    return jsonOk({
      organizationId: result.organization.id,
      userId: result.user.id,
      redirectTo: "/onboarding",
    });
  });
}
