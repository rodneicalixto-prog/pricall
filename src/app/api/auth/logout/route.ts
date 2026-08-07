import { recordAudit } from "@/lib/audit";
import { clearSessionCookie, getAuthContext, revokeSession } from "@/lib/auth/session";
import { setAvailability } from "@/server/services/auth-service";
import { handler, jsonOk, requestMeta } from "@/server/http";

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await getAuthContext();
    if (auth) {
      await revokeSession(auth.sessionId);
      await setAvailability(auth.userId, "offline");
      await recordAudit({
        organizationId: auth.organizationId,
        userId: auth.userId,
        action: "auth.logout",
        entityType: "user",
        entityId: auth.userId,
        ...requestMeta(request),
      });
    }
    await clearSessionCookie();
    return jsonOk({ redirectTo: "/entrar" });
  });
}
