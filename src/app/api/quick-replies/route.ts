import { z } from "zod";
import { createQuickReply, listQuickReplies, previewQuickReply } from "@/server/services/catalog";
import { handler, jsonOk, parseBody, parseQuery, requireAuth } from "@/server/http";

const querySchema = z.object({ includeInactive: z.coerce.boolean().optional() });

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    title: z.string().min(2).max(120),
    shortcut: z.string().min(2).max(40),
    content: z.string().min(1).max(4000),
    category: z.string().max(60).optional(),
    allowedTeamIds: z.array(z.string().uuid()).optional(),
    isActive: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("preview"),
    content: z.string().min(1).max(4000),
    variables: z.record(z.string(), z.string()).optional(),
  }),
]);

export async function GET(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const query = parseQuery(request, querySchema);
    return jsonOk({ items: await listQuickReplies(auth, query) });
  });
}

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const body = await parseBody(request, bodySchema);

    if (body.action === "preview") {
      return jsonOk(previewQuickReply(body.content, body.variables ?? {}));
    }
    const { action: _action, ...input } = body;
    return jsonOk(await createQuickReply(auth, input));
  });
}
