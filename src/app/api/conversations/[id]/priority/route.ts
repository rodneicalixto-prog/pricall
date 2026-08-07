import { z } from "zod";
import { updatePriority } from "@/server/services/conversations";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({ priority: z.enum(["low", "normal", "high", "urgent"]) });

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const { priority } = await parseBody(request, schema);
    return jsonOk(await updatePriority(auth, id, priority));
  });
}
