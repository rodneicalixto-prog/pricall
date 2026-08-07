import { testConnection } from "@/server/services/connections";
import { handler, jsonOk, requireAuth } from "@/server/http";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    return jsonOk(await testConnection(auth, id));
  });
}
