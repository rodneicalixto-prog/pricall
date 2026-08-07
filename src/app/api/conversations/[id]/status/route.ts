import { z } from "zod";
import { updateStatus } from "@/server/services/conversations";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  status: z.enum(["unassigned", "waiting", "in_progress", "waiting_customer", "scheduled"]),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const { status } = await parseBody(request, schema);
    return jsonOk(await updateStatus(auth, id, status));
  });
}
