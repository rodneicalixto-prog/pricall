import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { exportConversationsCsv } from "@/server/services/reports";
import { enforceRateLimit, jsonError, parseQuery, requireAuth } from "@/server/http";

const schema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  try {
    const auth = await requireAuth();
    enforceRateLimit(request, RATE_LIMITS.export, "export", auth.userId);
    const query = parseQuery(request, schema);

    const csv = await exportConversationsCsv(auth, {
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      userId: query.userId,
      teamId: query.teamId,
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "reports.exported",
      entityType: "report",
      metadata: { filtros: query },
    });

    const filename = `pricall-atendimentos-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
