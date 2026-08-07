import { z } from "zod";
import {
  classifyConversation,
  suggestReply,
  summarizeConversation,
} from "@/server/services/ai-service";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { enforceRateLimit, handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({ action: z.enum(["suggest", "summary", "classify"]) });

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    enforceRateLimit(request, RATE_LIMITS.ai, "ai", auth.userId);
    const { id } = await params;
    const { action } = await parseBody(request, schema);

    if (action === "suggest") return jsonOk(await suggestReply(auth, id));
    if (action === "summary") return jsonOk(await summarizeConversation(auth, id));
    return jsonOk(await classifyConversation(auth, id));
  });
}
