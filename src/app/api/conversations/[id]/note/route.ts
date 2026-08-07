import { z } from "zod";
import { addInternalNote } from "@/server/services/messages";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({ text: z.string().min(1).max(2000) });

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const { text } = await parseBody(request, schema);
    return jsonOk(await addInternalNote(auth, id, text));
  });
}
