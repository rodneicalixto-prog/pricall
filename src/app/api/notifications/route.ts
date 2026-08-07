import { z } from "zod";
import { listNotifications, markNotificationsRead } from "@/server/services/notifications";
import { handler, jsonOk, parseBody, parseQuery, requireAuth } from "@/server/http";

const querySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const bodySchema = z.object({
  ids: z.union([z.array(z.string().uuid()), z.literal("all")]),
});

export async function GET(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk(await listNotifications(auth, parseQuery(request, querySchema)));
  });
}

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const { ids } = await parseBody(request, bodySchema);
    await markNotificationsRead(auth, ids);
    return jsonOk({ ok: true });
  });
}
