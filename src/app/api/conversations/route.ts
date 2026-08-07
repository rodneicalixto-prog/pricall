import { z } from "zod";
import { listConversations } from "@/server/services/conversations";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { enforceRateLimit, handler, jsonOk, parseQuery, requireAuth } from "@/server/http";

const schema = z.object({
  queue: z
    .enum([
      "all", "unassigned", "mine", "waiting", "in_progress",
      "waiting_customer", "closed", "high_priority", "unread", "favorites",
    ])
    .optional(),
  search: z.string().max(120).optional(),
  assignedUserId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  connectionId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export async function GET(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const query = parseQuery(request, schema);
    if (query.search) {
      enforceRateLimit(request, RATE_LIMITS.search, "search", auth.userId);
    }
    const result = await listConversations(auth, {
      ...query,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
    return jsonOk(result);
  });
}
