/**
 * Dados e configurações da organização.
 * As configurações são lidas com frequência (mascaramento de telefone, SLA,
 * IA) — por isso há um cache curto em memória.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  organizations,
  type BusinessHours,
  type Organization,
  type OrganizationBranding,
  type OrganizationSettings,
} from "@/db/schema";
import { errors } from "@/lib/errors";

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: Organization }>();

export async function getOrganization(
  organizationId: string,
): Promise<Organization> {
  const cached = cache.get(organizationId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const db = await getDb();
  const [row] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!row) throw errors.notFound("Empresa não encontrada.");

  cache.set(organizationId, { at: Date.now(), value: row });
  return row;
}

export async function getOrganizationSettings(
  organizationId: string,
): Promise<OrganizationSettings> {
  const organization = await getOrganization(organizationId);
  return organization.settings ?? {};
}

export function invalidateOrganizationCache(organizationId: string) {
  cache.delete(organizationId);
}

export type UpdateOrganizationInput = Partial<{
  name: string;
  segment: string;
  timezone: string;
  businessHours: BusinessHours;
  branding: OrganizationBranding;
  settings: OrganizationSettings;
  onboardingCompletedAt: Date | null;
}>;

export async function updateOrganization(
  organizationId: string,
  input: UpdateOrganizationInput,
): Promise<Organization> {
  const db = await getDb();
  const current = await getOrganization(organizationId);

  const [updated] = await db
    .update(organizations)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.segment !== undefined ? { segment: input.segment } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.businessHours !== undefined
        ? { businessHours: input.businessHours }
        : {}),
      // Branding e settings são mesclados, não substituídos.
      ...(input.branding !== undefined
        ? { branding: { ...current.branding, ...input.branding } }
        : {}),
      ...(input.settings !== undefined
        ? { settings: { ...current.settings, ...input.settings } }
        : {}),
      ...(input.onboardingCompletedAt !== undefined
        ? { onboardingCompletedAt: input.onboardingCompletedAt }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId))
    .returning();

  invalidateOrganizationCache(organizationId);
  return updated;
}
