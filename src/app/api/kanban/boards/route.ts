import { z } from "zod";
import { createBoard, listBoards } from "@/server/services/kanban";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  columns: z
    .array(z.object({ name: z.string().min(1).max(60), color: z.string().optional() }))
    .optional(),
});

export async function GET() {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk({ items: await listBoards(auth) });
  });
}

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk(await createBoard(auth, await parseBody(request, schema)));
  });
}
