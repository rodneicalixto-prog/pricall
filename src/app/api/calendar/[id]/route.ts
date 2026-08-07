import { z } from "zod";
import { deleteCalendarEvent, updateCalendarEvent } from "@/server/services/agenda";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  status: z.enum(["scheduled", "done", "cancelled"]).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await parseBody(request, schema);
    return jsonOk(
      await updateCalendarEvent(auth, id, {
        ...body,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
      }),
    );
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    await deleteCalendarEvent(auth, id);
    return jsonOk({ ok: true });
  });
}
