import { z } from "zod";
import { getUserPerformance, resetUserPassword, updateUser } from "@/server/services/team";
import { handler, jsonOk, parseBody, parseQuery, requireAuth } from "@/server/http";

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().nullable().optional(),
  role: z.enum(["admin", "supervisor", "seller"]).optional(),
  isActive: z.boolean().optional(),
  maxConcurrentConversations: z.number().int().min(0).max(200).optional(),
  teamIds: z.array(z.string().uuid()).optional(),
});

const postSchema = z.object({ action: z.literal("reset-password") });
const querySchema = z.object({ days: z.coerce.number().int().min(1).max(365).optional() });

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const { days } = parseQuery(request, querySchema);
    return jsonOk(await getUserPerformance(auth, id, days ?? 30));
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await parseBody(request, patchSchema);
    const user = await updateUser(auth, id, body);
    return jsonOk({ id: user.id, isActive: user.isActive, role: user.role });
  });
}

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    await parseBody(request, postSchema);
    return jsonOk(await resetUserPassword(auth, id));
  });
}
