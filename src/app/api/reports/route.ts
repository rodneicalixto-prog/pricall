import { z } from "zod";
import { getFullReport } from "@/server/services/reports";
import { handler, jsonOk, parseQuery, requireAuth } from "@/server/http";

const schema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const query = parseQuery(request, schema);
    return jsonOk(
      await getFullReport(auth, {
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        userId: query.userId,
        teamId: query.teamId,
      }),
    );
  });
}
