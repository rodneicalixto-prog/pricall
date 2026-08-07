import { getHealthDashboard } from "@/server/services/connections";
import { handler, jsonOk, requireAuth } from "@/server/http";

export async function GET() {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk(await getHealthDashboard(auth));
  });
}
