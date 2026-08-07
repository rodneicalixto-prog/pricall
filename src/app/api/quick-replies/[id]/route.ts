import { z } from "zod";
import { deleteQuickReply, updateQuickReply } from "@/server/services/catalog";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  title: z.string().min(2).max(120).optional(),
  shortcut: z.string().min(2).max(40).optional(),
  content: z.string().min(1).max(4000).optional(),
  category: z.string().max(60).nullable().optional(),
  allowedTeamIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await parseBody(request, schema);
    return jsonOk(
      await updateQuickReply(auth, id, {
        ...body,
        category: body.category ?? undefined,
      }),
    );
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    await deleteQuickReply(auth, id);
    return jsonOk({ ok: true });
  });
}
