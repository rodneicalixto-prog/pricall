import { z } from "zod";
import {
  archiveBoard,
  createCard,
  createColumn,
  getBoard,
  updateBoard,
} from "@/server/services/kanban";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().nullable().optional(),
  isShared: z.boolean().optional(),
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add-column"),
    name: z.string().min(1).max(60),
    color: z.string().optional(),
    appliesConversationStatus: z
      .enum(["unassigned", "waiting", "in_progress", "waiting_customer", "scheduled", "closed"])
      .nullable()
      .optional(),
  }),
  z.object({
    action: z.literal("add-card"),
    columnId: z.string().uuid(),
    title: z.string().min(1).max(160),
    conversationId: z.string().uuid().nullable().optional(),
    contactId: z.string().uuid().nullable().optional(),
    notes: z.string().max(2000).optional(),
    value: z.number().int().optional(),
    dueAt: z.string().datetime().nullable().optional(),
  }),
]);

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    return jsonOk(await getBoard(auth, id));
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    return jsonOk(await updateBoard(auth, id, await parseBody(request, patchSchema)));
  });
}

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await parseBody(request, postSchema);

    if (body.action === "add-column") {
      return jsonOk(
        await createColumn(auth, id, {
          name: body.name,
          color: body.color,
          appliesConversationStatus: body.appliesConversationStatus ?? null,
        }),
      );
    }
    return jsonOk(
      await createCard(auth, {
        boardId: id,
        columnId: body.columnId,
        title: body.title,
        conversationId: body.conversationId ?? null,
        contactId: body.contactId ?? null,
        notes: body.notes,
        value: body.value,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
      }),
    );
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    await archiveBoard(auth, id);
    return jsonOk({ ok: true });
  });
}
