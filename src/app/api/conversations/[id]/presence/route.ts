import { z } from "zod";
import { heartbeat, leave, listViewers } from "@/server/services/presence";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({ isTyping: z.boolean().optional() });

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    return jsonOk({ viewers: await listViewers(auth, id) });
  });
}

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const { isTyping } = await parseBody(request, schema);
    return jsonOk({ viewers: await heartbeat(auth, id, isTyping ?? false) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    await leave(auth, id);
    return jsonOk({ ok: true });
  });
}
