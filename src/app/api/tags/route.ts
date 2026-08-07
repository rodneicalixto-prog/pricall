import { z } from "zod";
import { createTag, listTags } from "@/server/services/catalog";
import { handler, jsonOk, parseBody, parseQuery, requireAuth } from "@/server/http";

const querySchema = z.object({ includeInactive: z.coerce.boolean().optional() });
const bodySchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function GET(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const { includeInactive } = parseQuery(request, querySchema);
    return jsonOk({ items: await listTags(auth, includeInactive) });
  });
}

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk(await createTag(auth, await parseBody(request, bodySchema)));
  });
}
