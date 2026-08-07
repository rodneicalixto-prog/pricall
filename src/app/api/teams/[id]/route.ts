import { z } from "zod";
import { setTeamMembers, updateTeam } from "@/server/services/team";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const patchSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isActive: z.boolean().optional(),
});

const membersSchema = z.object({
  members: z.array(
    z.object({ userId: z.string().uuid(), isSupervisor: z.boolean().default(false) }),
  ),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    return jsonOk(await updateTeam(auth, id, await parseBody(request, patchSchema)));
  });
}

export async function PUT(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const { members } = await parseBody(request, membersSchema);
    await setTeamMembers(auth, id, members);
    return jsonOk({ ok: true });
  });
}
