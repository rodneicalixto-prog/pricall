import { z } from "zod";
import { requirePermission } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { getOrganization, updateOrganization } from "@/server/services/organization";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const dayRanges = z.array(z.object({ start: z.string(), end: z.string() }));

const schema = z.object({
  name: z.string().min(2).optional(),
  segment: z.string().max(120).optional(),
  timezone: z.string().max(60).optional(),
  businessHours: z
    .object({
      sun: dayRanges.optional(),
      mon: dayRanges.optional(),
      tue: dayRanges.optional(),
      wed: dayRanges.optional(),
      thu: dayRanges.optional(),
      fri: dayRanges.optional(),
      sat: dayRanges.optional(),
    })
    .optional(),
  branding: z
    .object({
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      logoUrl: z.string().url().optional(),
      inboxName: z.string().max(60).optional(),
    })
    .optional(),
  settings: z
    .object({
      aiEnabled: z.boolean().optional(),
      aiSummaryEnabled: z.boolean().optional(),
      demoMode: z.boolean().optional(),
      slaFirstResponseMinutes: z.number().int().min(1).max(1440).optional(),
      slaStaleConversationMinutes: z.number().int().min(1).max(1440).optional(),
      assignOutsideBusinessHours: z.boolean().optional(),
      dataRetentionDays: z.number().int().min(30).max(3650).optional(),
      maskPhoneForSellers: z.boolean().optional(),
    })
    .optional(),
});

export async function GET() {
  return handler(async () => {
    const auth = await requireAuth();
    const organization = await getOrganization(auth.organizationId);
    return jsonOk({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      segment: organization.segment,
      timezone: organization.timezone,
      businessHours: organization.businessHours,
      branding: organization.branding,
      settings: organization.settings,
      onboardingCompleted: Boolean(organization.onboardingCompletedAt),
    });
  });
}

export async function PATCH(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    requirePermission(auth, "organization.manage");
    const body = await parseBody(request, schema);
    const organization = await updateOrganization(auth.organizationId, body);

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: "organization.updated",
      entityType: "organization",
      entityId: auth.organizationId,
      metadata: { campos: Object.keys(body) },
    });

    return jsonOk({ id: organization.id, updatedAt: organization.updatedAt });
  });
}
