import { z } from "zod";
import { deleteCard, moveCard, updateCard } from "@/server/services/kanban";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const patchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  notes: z.string().max(2000).nullable().optional(),
  value: z.number().int().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

const moveSchema = z.object({
  columnId: z.string().uuid(),
  position: z.number().int().min(0),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await parseBody(request, patchSchema);
    return jsonOk(
      await updateCard(auth, id, {
        ...body,
        dueAt: body.dueAt === undefined ? undefined : body.dueAt ? new Date(body.dueAt) : null,
      }),
    );
  });
}

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const { columnId, position } = await parseBody(request, moveSchema);
    return jsonOk(await moveCard(auth, id, columnId, position));
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    await deleteCard(auth, id);
    return jsonOk({ ok: true });
  });
}
