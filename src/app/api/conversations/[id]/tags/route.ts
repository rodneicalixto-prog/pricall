import { z } from "zod";
import { addTag, removeTag } from "@/server/services/conversations";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({ tagId: z.string().uuid() });

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const { tagId } = await parseBody(request, schema);
    await addTag(auth, id, tagId);
    return jsonOk({ ok: true });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const { tagId } = await parseBody(request, schema);
    await removeTag(auth, id, tagId);
    return jsonOk({ ok: true });
  });
}
