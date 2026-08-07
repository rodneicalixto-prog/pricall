import { z } from "zod";
import { updateConnection } from "@/server/services/connections";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  label: z.string().min(2).max(120).optional(),
  displayPhoneNumber: z.string().min(5).max(40).optional(),
  scope: z.enum(["organization", "team", "user"]).optional(),
  teamId: z.string().uuid().nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  extension: z.string().max(20).nullable().optional(),
  phoneNumberId: z.string().max(80).nullable().optional(),
  apiBaseUrl: z.string().url().nullable().optional(),
  instanceName: z.string().max(80).nullable().optional(),
  tokenReference: z.string().max(120).nullable().optional(),
  webhookSecretReference: z.string().max(120).nullable().optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(["connected", "disabled"]).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const connection = await updateConnection(auth, id, await parseBody(request, schema));
    const { tokenReference: _t, webhookSecretReference: _w, ...safe } = connection;
    return jsonOk(safe);
  });
}
