import { z } from "zod";
import { transferConversation } from "@/server/services/conversations";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  toUserId: z.string().uuid().nullable().optional(),
  toTeamId: z.string().uuid().nullable().optional(),
  reason: z.string().max(500).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await parseBody(request, schema);
    return jsonOk(await transferConversation(auth, { conversationId: id, ...body }));
  });
}
