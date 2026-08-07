import { getDashboard } from "@/server/services/reports";
import { handler, jsonOk, requireAuth } from "@/server/http";

export async function GET() {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk(await getDashboard(auth));
  });
}
