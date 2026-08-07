import { z } from "zod";
import { closeConversation } from "@/server/services/conversations";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  reason: z.string().min(1, "Informe o motivo do encerramento.").max(300),
  outcome: z.string().min(1, "Informe o resultado do contato.").max(120),
  note: z.string().max(2000).optional(),
  followupAt: z.string().datetime().nullable().optional(),
  followupNote: z.string().max(500).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await parseBody(request, schema);
    return jsonOk(
      await closeConversation(auth, {
        conversationId: id,
        reason: body.reason,
        outcome: body.outcome,
        note: body.note,
        followupAt: body.followupAt ? new Date(body.followupAt) : null,
        followupNote: body.followupNote,
      }),
    );
  });
}
