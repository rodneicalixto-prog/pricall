import { z } from "zod";
import { updateTag } from "@/server/services/catalog";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isActive: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    return jsonOk(await updateTag(auth, id, await parseBody(request, schema)));
  });
}
