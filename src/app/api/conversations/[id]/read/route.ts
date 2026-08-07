import { markAsRead } from "@/server/services/conversations";
import { handler, jsonOk, requireAuth } from "@/server/http";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    await markAsRead(auth, id);
    return jsonOk({ ok: true });
  });
}
