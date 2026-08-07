import { z } from "zod";
import {
  completeFollowup,
  createCalendarEvent,
  createFollowup,
  listCalendar,
  listFollowups,
} from "@/server/services/agenda";
import { handler, jsonOk, parseBody, parseQuery, requireAuth } from "@/server/http";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  userId: z.string().uuid().optional(),
  includeFollowups: z.coerce.boolean().optional(),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-event"),
    title: z.string().min(1).max(160),
    description: z.string().max(2000).optional(),
    location: z.string().max(200).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    conversationId: z.string().uuid().nullable().optional(),
    contactId: z.string().uuid().nullable().optional(),
    remindMinutesBefore: z.number().int().min(0).max(10080).nullable().optional(),
    userId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("create-followup"),
    conversationId: z.string().uuid(),
    scheduledAt: z.string().datetime(),
    note: z.string().max(500).optional(),
    assignedUserId: z.string().uuid().optional(),
  }),
  z.object({ action: z.literal("complete-followup"), followupId: z.string().uuid() }),
]);

export async function GET(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const query = parseQuery(request, querySchema);
    const calendar = await listCalendar(auth, {
      from: new Date(query.from),
      to: new Date(query.to),
      userId: query.userId,
    });
    const pending = query.includeFollowups
      ? await listFollowups(auth, { status: "pending" })
      : [];
    return jsonOk({ ...calendar, pendingFollowups: pending });
  });
}

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const body = await parseBody(request, bodySchema);

    if (body.action === "create-event") {
      const { action: _a, startsAt, endsAt, ...rest } = body;
      return jsonOk(
        await createCalendarEvent(auth, {
          ...rest,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
        }),
      );
    }
    if (body.action === "create-followup") {
      return jsonOk(
        await createFollowup(auth, {
          conversationId: body.conversationId,
          scheduledAt: new Date(body.scheduledAt),
          note: body.note,
          assignedUserId: body.assignedUserId,
        }),
      );
    }
    return jsonOk(await completeFollowup(auth, body.followupId));
  });
}
