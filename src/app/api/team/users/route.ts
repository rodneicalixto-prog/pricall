import { z } from "zod";
import { createUser, listTeamMembers } from "@/server/services/team";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.enum(["admin", "supervisor", "seller"]),
  password: z.string().min(8).optional(),
  teamIds: z.array(z.string().uuid()).optional(),
  maxConcurrentConversations: z.number().int().min(0).max(200).optional(),
});

export async function GET() {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk({ items: await listTeamMembers(auth) });
  });
}

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const body = await parseBody(request, schema);
    const result = await createUser(auth, body);
    return jsonOk({
      user: { id: result.user.id, name: result.user.name, email: result.user.email },
      temporaryPassword: result.temporaryPassword,
    });
  });
}
