import { retryMessage } from "@/server/services/messages";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { enforceRateLimit, handler, jsonOk, requireAuth } from "@/server/http";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    enforceRateLimit(request, RATE_LIMITS.sendMessage, "send", auth.userId);
    const { id } = await params;
    return jsonOk(await retryMessage(auth, id));
  });
}
