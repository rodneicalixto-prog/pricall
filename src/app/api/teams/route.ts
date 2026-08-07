import { z } from "zod";
import { createTeam, listTeams } from "@/server/services/team";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  name: z.string().min(2),
  description: z.string().max(300).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function GET() {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk({ items: await listTeams(auth) });
  });
}

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk(await createTeam(auth, await parseBody(request, schema)));
  });
}
