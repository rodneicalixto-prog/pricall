import { z } from "zod";
import { createConnection, listConnections } from "@/server/services/connections";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const schema = z.object({
  label: z.string().min(2).max(120),
  provider: z.enum(["mock", "cloud_api", "evolution"]),
  scope: z.enum(["organization", "team", "user"]),
  displayPhoneNumber: z.string().min(5).max(40),
  teamId: z.string().uuid().nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  extension: z.string().max(20).nullable().optional(),
  phoneNumberId: z.string().max(80).nullable().optional(),
  whatsappBusinessAccountId: z.string().max(80).nullable().optional(),
  apiBaseUrl: z.string().url().nullable().optional(),
  instanceName: z.string().max(80).nullable().optional(),
  tokenReference: z.string().max(120).nullable().optional(),
  webhookSecretReference: z.string().max(120).nullable().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  return handler(async () => {
    const auth = await requireAuth();
    return jsonOk({ items: await listConnections(auth) });
  });
}

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const connection = await createConnection(auth, await parseBody(request, schema));
    // Nunca devolve segredo — só o registro público da conexão.
    const { tokenReference: _t, webhookSecretReference: _w, ...safe } = connection;
    return jsonOk(safe);
  });
}
