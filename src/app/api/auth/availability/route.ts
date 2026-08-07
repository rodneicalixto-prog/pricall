import { z } from "zod";
import { setAvailability } from "@/server/services/auth-service";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({ status: z.enum(["online", "away", "offline"]) });

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const { status } = await parseBody(request, schema);
    await setAvailability(auth.userId, status);
    return jsonOk({ status });
  });
}
