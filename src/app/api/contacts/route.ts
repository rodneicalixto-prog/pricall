/**
 * Agenda de contatos: listagem com busca e cadastro manual.
 *
 * Os contatos sempre foram gravados a cada mensagem recebida; o que faltava
 * era poder vê-los e puxar conversa com quem já escreveu antes.
 */
import { z } from "zod";
import { createContact, listContacts } from "@/server/services/contacts";
import { handler, jsonOk, parseBody, parseQuery, requireAuth } from "@/server/http";

const querySchema = z.object({
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(8).max(20),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().max(1000).optional(),
});

export async function GET(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const query = parseQuery(request, querySchema);
    return jsonOk(await listContacts(auth, query));
  });
}

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const body = await parseBody(request, bodySchema);
    return jsonOk(await createContact(auth, body));
  });
}
