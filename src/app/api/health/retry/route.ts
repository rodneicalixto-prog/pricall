import { z } from "zod";
import { requirePermission } from "@/lib/auth/rbac";
import { retryIntegrationEvent } from "@/server/services/inbound";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({ eventId: z.string().uuid() });

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    requirePermission(auth, "health.retry_events");
    const { eventId } = await parseBody(request, schema);
    return jsonOk(await retryIntegrationEvent(auth.organizationId, eventId));
  });
}
