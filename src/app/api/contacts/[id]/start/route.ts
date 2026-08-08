/**
 * Abre uma conversa com um contato, para quem quer puxar assunto em vez de
 * esperar o cliente escrever.
 *
 * Devolve a conversa pronta e atribuída — o envio segue pelo caminho normal,
 * com as mesmas regras de janela de atendimento e bloqueio.
 */
import { z } from "zod";
import { startConversation } from "@/server/services/contacts";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const bodySchema = z.object({
  connectionId: z.string().uuid().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await parseBody(request, bodySchema).catch(() => ({}));
    return jsonOk(await startConversation(auth, { contactId: id, ...body }));
  });
}
