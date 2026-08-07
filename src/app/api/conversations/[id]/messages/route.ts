import { z } from "zod";
import { listMessages, sendMessage } from "@/server/services/messages";
import { RATE_LIMITS } from "@/lib/rate-limit";
import {
  enforceRateLimit,
  handler,
  jsonOk,
  parseBody,
  parseQuery,
  requireAuth,
} from "@/server/http";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const bodySchema = z.object({
  text: z.string().max(4096).optional(),
  media: z
    .object({
      type: z.enum(["image", "audio", "video", "document"]),
      url: z.string().url(),
      mimeType: z.string().min(3),
      sizeBytes: z.number().int().positive(),
      fileName: z.string().max(200).optional(),
    })
    .optional(),
  replyToMessageId: z.string().uuid().optional(),
  aiSuggested: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const query = parseQuery(request, querySchema);
    return jsonOk(await listMessages(auth, id, query));
  });
}

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    enforceRateLimit(request, RATE_LIMITS.sendMessage, "send", auth.userId);
    const { id } = await params;
    const body = await parseBody(request, bodySchema);
    return jsonOk(await sendMessage(auth, { conversationId: id, ...body }));
  });
}
