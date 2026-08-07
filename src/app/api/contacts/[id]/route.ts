import { z } from "zod";
import {
  getContactPanel,
  recordConsent,
  setContactBlocked,
  updateContact,
} from "@/server/services/contacts";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().nullable().optional(),
  companyName: z.string().max(160).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  source: z.string().max(80).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("block"),
    blocked: z.boolean(),
    reason: z.string().max(300).optional(),
  }),
  z.object({
    action: z.literal("consent"),
    kind: z.string().min(2).max(60),
    granted: z.boolean(),
    source: z.string().max(120).optional(),
  }),
]);

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    return jsonOk(await getContactPanel(auth, id));
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    return jsonOk(await updateContact(auth, id, await parseBody(request, patchSchema)));
  });
}

export async function POST(request: Request, { params }: Params) {
  return handler(async () => {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await parseBody(request, postSchema);
    if (body.action === "block") {
      return jsonOk(await setContactBlocked(auth, id, body.blocked, body.reason));
    }
    return jsonOk(await recordConsent(auth, id, body.kind, body.granted, body.source));
  });
}
