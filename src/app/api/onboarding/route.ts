/**
 * Onboarding em etapas. Cada passo grava o que já foi preenchido, para o
 * usuário poder sair e voltar sem perder o progresso.
 */
import { z } from "zod";
import { requirePermission } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { errors } from "@/lib/errors";
import { createConnection } from "@/server/services/connections";
import { updateOrganization } from "@/server/services/organization";
import { createTeam, inviteUser } from "@/server/services/team";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";

const dayRanges = z.array(z.object({ start: z.string(), end: z.string() }));

const schema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("company"),
    name: z.string().min(2),
    segment: z.string().min(2),
    timezone: z.string().default("America/Sao_Paulo"),
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
  }),
  z.object({
    step: z.literal("team"),
    teams: z.array(z.object({ name: z.string().min(2) })).optional(),
    invites: z
      .array(
        z.object({
          name: z.string().min(2),
          email: z.string().email(),
          role: z.enum(["admin", "supervisor", "seller"]),
          teamName: z.string().optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    step: z.literal("whatsapp"),
    mode: z.enum(["demo", "cloud_api", "evolution"]),
    label: z.string().max(120).optional(),
    displayPhoneNumber: z.string().max(40).optional(),
    phoneNumberId: z.string().max(80).optional(),
    whatsappBusinessAccountId: z.string().max(80).optional(),
    apiBaseUrl: z.string().url().optional(),
    instanceName: z.string().max(80).optional(),
    tokenReference: z.string().max(120).optional(),
  }),
  z.object({
    step: z.literal("assignment"),
    strategy: z.enum(["manual", "round_robin", "least_active", "team_based", "first_available"]),
    requireOnline: z.boolean().default(true),
  }),
  z.object({ step: z.literal("finish") }),
]);

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    requirePermission(auth, "organization.manage");
    const body = await parseBody(request, schema);

    switch (body.step) {
      case "company": {
        await updateOrganization(auth.organizationId, {
          name: body.name,
          segment: body.segment,
          timezone: body.timezone,
          businessHours: body.businessHours,
        });
        return jsonOk({ step: "company", next: "team" });
      }

      case "team": {
        const createdTeams = new Map<string, string>();
        for (const team of body.teams ?? []) {
          const created = await createTeam(auth, { name: team.name });
          createdTeams.set(team.name, created.id);
        }

        const invitations: { email: string; link: string }[] = [];
        for (const invite of body.invites ?? []) {
          const result = await inviteUser(auth, {
            name: invite.name,
            email: invite.email,
            role: invite.role,
            teamId: invite.teamName ? createdTeams.get(invite.teamName) : undefined,
          });
          invitations.push({ email: invite.email, link: result.link });
        }
        return jsonOk({ step: "team", next: "whatsapp", invitations });
      }

      case "whatsapp": {
        if (body.mode === "demo") {
          const connection = await createConnection(auth, {
            label: body.label ?? "Número de demonstração",
            provider: "mock",
            scope: "organization",
            displayPhoneNumber: body.displayPhoneNumber ?? "+55 (11) 3000-0000",
            instanceName: `demo-${auth.organizationId.slice(0, 8)}`,
            isDefault: true,
          });
          await updateOrganization(auth.organizationId, { settings: { demoMode: true } });
          return jsonOk({ step: "whatsapp", next: "assignment", connectionId: connection.id });
        }

        if (body.mode === "cloud_api" && !body.phoneNumberId) {
          throw errors.validation("Informe o identificador do número da Cloud API.");
        }
        if (body.mode === "evolution" && (!body.apiBaseUrl || !body.instanceName)) {
          throw errors.validation("Informe a URL e a instância da Evolution API.");
        }

        const connection = await createConnection(auth, {
          label: body.label ?? "Número principal",
          provider: body.mode,
          scope: "organization",
          displayPhoneNumber: body.displayPhoneNumber ?? "",
          phoneNumberId: body.phoneNumberId ?? null,
          whatsappBusinessAccountId: body.whatsappBusinessAccountId ?? null,
          apiBaseUrl: body.apiBaseUrl ?? null,
          instanceName: body.instanceName ?? null,
          tokenReference: body.tokenReference ?? null,
          isDefault: true,
        });
        await updateOrganization(auth.organizationId, { settings: { demoMode: false } });
        return jsonOk({ step: "whatsapp", next: "assignment", connectionId: connection.id });
      }

      case "assignment": {
        const { getDb } = await import("@/db");
        const { assignmentRules } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();

        await db
          .delete(assignmentRules)
          .where(eq(assignmentRules.organizationId, auth.organizationId));
        await db.insert(assignmentRules).values({
          organizationId: auth.organizationId,
          name: "Regra principal",
          strategy: body.strategy,
          priority: 100,
          isActive: true,
          configuration: { requireOnline: body.requireOnline, fallbackStrategy: "manual" },
        });
        return jsonOk({ step: "assignment", next: "finish" });
      }

      case "finish": {
        await updateOrganization(auth.organizationId, {
          onboardingCompletedAt: new Date(),
        });
        await recordAudit({
          organizationId: auth.organizationId,
          userId: auth.userId,
          action: "organization.onboarding_completed",
          entityType: "organization",
          entityId: auth.organizationId,
        });
        return jsonOk({ step: "finish", redirectTo: "/atendimentos" });
      }
    }
  });
}
