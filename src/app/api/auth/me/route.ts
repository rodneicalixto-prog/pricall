import { getAuthContext } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/rbac";
import { getOrganization } from "@/server/services/organization";
import { handler, jsonOk } from "@/server/http";

export async function GET() {
  return handler(async () => {
    const auth = await getAuthContext();
    if (!auth) return jsonOk({ authenticated: false as const });

    const organization = await getOrganization(auth.organizationId);
    return jsonOk({
      authenticated: true as const,
      user: {
        id: auth.userId,
        name: auth.name,
        email: auth.email,
        role: auth.role,
        avatarUrl: auth.avatarUrl,
        teamIds: auth.teamIds,
        supervisedTeamIds: auth.supervisedTeamIds,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        timezone: organization.timezone,
        branding: organization.branding,
        demoMode: organization.settings?.demoMode ?? false,
        aiEnabled: organization.settings?.aiEnabled ?? true,
        onboardingCompleted: Boolean(organization.onboardingCompletedAt),
      },
      permissions: permissionsOf(auth.role),
    });
  });
}
