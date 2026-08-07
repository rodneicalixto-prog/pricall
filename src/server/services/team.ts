/**
 * Equipe: usuários, equipes/setores, convites e desempenho.
 * Usuários com histórico nunca são excluídos — apenas desativados.
 */
import { randomBytes } from "node:crypto";
import { and, avg, count, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  conversations,
  invitations,
  messages,
  teamMembers,
  teams,
  users,
  type UserRole,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { can, requirePermission } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { hashToken, revokeAllSessions } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { errors } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";

/* ------------------------------------------------------------------ *
 * Listagem com métricas
 * ------------------------------------------------------------------ */

export async function listTeamMembers(auth: AuthContext) {
  requirePermission(auth, "users.view");
  const db = await getDb();

  // Supervisor só enxerga os usuários das equipes que supervisiona.
  let visibleUserIds: string[] | null = null;
  if (auth.role === "supervisor") {
    const scope = auth.supervisedTeamIds.length > 0 ? auth.supervisedTeamIds : auth.teamIds;
    if (scope.length === 0) {
      visibleUserIds = [auth.userId];
    } else {
      const rows = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(inArray(teamMembers.teamId, scope));
      visibleUserIds = [...new Set([...rows.map((r) => r.userId), auth.userId])];
    }
  }

  const baseFilter = and(
    eq(users.organizationId, auth.organizationId),
    visibleUserIds ? inArray(users.id, visibleUserIds) : undefined,
  );

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
      role: users.role,
      availabilityStatus: users.availabilityStatus,
      isActive: users.isActive,
      maxConcurrentConversations: users.maxConcurrentConversations,
      lastActivityAt: users.lastActivityAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(baseFilter)
    .orderBy(desc(users.isActive), users.name);

  const ids = rows.map((r) => r.id);
  const [activeCounts, closedToday, responseTimes, memberships] = await Promise.all([
    countByUser(ids, "active"),
    countByUser(ids, "closed_today"),
    averageFirstResponse(auth.organizationId, ids),
    loadMemberships(ids),
  ]);

  return rows.map((row) => ({
    ...row,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    activeConversations: activeCounts.get(row.id) ?? 0,
    closedToday: closedToday.get(row.id) ?? 0,
    averageFirstResponseSeconds: responseTimes.get(row.id) ?? null,
    teams: memberships.get(row.id) ?? [],
  }));
}

async function countByUser(userIds: string[], mode: "active" | "closed_today") {
  const map = new Map<string, number>();
  if (userIds.length === 0) return map;
  const db = await getDb();

  const filters =
    mode === "active"
      ? and(
          inArray(conversations.assignedUserId, userIds),
          inArray(conversations.status, ["in_progress", "waiting", "waiting_customer"]),
        )
      : and(
          inArray(conversations.assignedUserId, userIds),
          eq(conversations.status, "closed"),
          gte(conversations.closedAt, startOfToday()),
        );

  const rows = await db
    .select({ userId: conversations.assignedUserId, total: count() })
    .from(conversations)
    .where(filters)
    .groupBy(conversations.assignedUserId);

  for (const row of rows) if (row.userId) map.set(row.userId, Number(row.total));
  return map;
}

async function averageFirstResponse(organizationId: string, userIds: string[]) {
  const map = new Map<string, number>();
  if (userIds.length === 0) return map;
  const db = await getDb();

  const rows = await db
    .select({
      userId: conversations.assignedUserId,
      seconds: avg(
        sql<number>`extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt}))`,
      ),
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        inArray(conversations.assignedUserId, userIds),
        isNotNull(conversations.firstResponseAt),
        gte(conversations.createdAt, daysAgo(30)),
      ),
    )
    .groupBy(conversations.assignedUserId);

  for (const row of rows) {
    if (row.userId && row.seconds != null) {
      map.set(row.userId, Math.round(Number(row.seconds)));
    }
  }
  return map;
}

async function loadMemberships(userIds: string[]) {
  const map = new Map<string, { id: string; name: string; isSupervisor: boolean }[]>();
  if (userIds.length === 0) return map;
  const db = await getDb();

  const rows = await db
    .select({
      userId: teamMembers.userId,
      id: teams.id,
      name: teams.name,
      isSupervisor: teamMembers.isSupervisor,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(inArray(teamMembers.userId, userIds));

  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push({ id: row.id, name: row.name, isSupervisor: row.isSupervisor });
    map.set(row.userId, list);
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * Criação e edição de usuários
 * ------------------------------------------------------------------ */

export type CreateUserInput = {
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  password?: string;
  teamIds?: string[];
  maxConcurrentConversations?: number;
};

export async function createUser(auth: AuthContext, input: CreateUserInput) {
  requirePermission(auth, "users.manage");
  const db = await getDb();
  const email = input.email.trim().toLowerCase();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (existing.length > 0) {
    throw errors.conflict("Já existe um usuário com este e-mail.");
  }

  // Sem senha informada, gera uma temporária e devolve uma única vez.
  const temporaryPassword = input.password ?? generateTemporaryPassword();
  const problems = validatePasswordStrength(temporaryPassword);
  if (problems.length > 0) throw errors.validation(problems.join(" "));

  const [user] = await db
    .insert(users)
    .values({
      organizationId: auth.organizationId,
      name: input.name.trim(),
      email,
      phone: input.phone ? normalizePhone(input.phone) : null,
      role: input.role,
      passwordHash: await hashPassword(temporaryPassword),
      isActive: true,
      maxConcurrentConversations: input.maxConcurrentConversations ?? 20,
    })
    .returning();

  if (input.teamIds?.length) {
    await db.insert(teamMembers).values(
      input.teamIds.map((teamId) => ({
        organizationId: auth.organizationId,
        teamId,
        userId: user.id,
        isSupervisor: input.role === "supervisor",
      })),
    );
  }

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "user.created",
    entityType: "user",
    entityId: user.id,
    metadata: { perfil: input.role, email },
  });

  return { user, temporaryPassword: input.password ? null : temporaryPassword };
}

export type UpdateUserInput = Partial<{
  name: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  maxConcurrentConversations: number;
  teamIds: string[];
}>;

export async function updateUser(
  auth: AuthContext,
  userId: string,
  input: UpdateUserInput,
) {
  requirePermission(auth, "users.manage");
  const db = await getDb();

  const [target] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, auth.organizationId)))
    .limit(1);
  if (!target) throw errors.notFound("Usuário não encontrado.");

  // Não deixa a empresa ficar sem administrador ativo.
  if (
    (input.role !== undefined && input.role !== "admin" && target.role === "admin") ||
    (input.isActive === false && target.role === "admin")
  ) {
    const activeAdmins = Number(
      await db.$count(
        users,
        and(
          eq(users.organizationId, auth.organizationId),
          eq(users.role, "admin"),
          eq(users.isActive, true),
        ),
      ),
    );
    if (activeAdmins <= 1) {
      throw errors.validation(
        "A empresa precisa ter ao menos um administrador ativo.",
      );
    }
  }

  const [updated] = await db
    .update(users)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.phone !== undefined
        ? { phone: input.phone ? normalizePhone(input.phone) : null }
        : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined
        ? {
            isActive: input.isActive,
            deactivatedAt: input.isActive ? null : new Date(),
            availabilityStatus: input.isActive ? target.availabilityStatus : "offline",
          }
        : {}),
      ...(input.maxConcurrentConversations !== undefined
        ? { maxConcurrentConversations: input.maxConcurrentConversations }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();

  if (input.teamIds) {
    await db.delete(teamMembers).where(eq(teamMembers.userId, userId));
    if (input.teamIds.length > 0) {
      await db.insert(teamMembers).values(
        input.teamIds.map((teamId) => ({
          organizationId: auth.organizationId,
          teamId,
          userId,
          isSupervisor: (input.role ?? target.role) === "supervisor",
        })),
      );
    }
  }

  // Desativação revoga as sessões abertas imediatamente.
  if (input.isActive === false) {
    await revokeAllSessions(userId);
    await db
      .update(conversations)
      .set({ assignedUserId: null, status: "unassigned", updatedAt: new Date() })
      .where(
        and(
          eq(conversations.assignedUserId, userId),
          sql`${conversations.status} <> 'closed'`,
        ),
      );
  }

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: input.isActive === false ? "user.deactivated" : "user.updated",
    entityType: "user",
    entityId: userId,
    metadata: { campos: Object.keys(input) },
  });

  return updated;
}

export async function resetUserPassword(auth: AuthContext, userId: string) {
  requirePermission(auth, "users.manage");
  const db = await getDb();

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, auth.organizationId)))
    .limit(1);
  if (!target) throw errors.notFound("Usuário não encontrado.");

  const temporaryPassword = generateTemporaryPassword();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(temporaryPassword), updatedAt: new Date() })
    .where(eq(users.id, userId));
  await revokeAllSessions(userId);

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "user.password_reset",
    entityType: "user",
    entityId: userId,
  });

  return { temporaryPassword };
}

function generateTemporaryPassword(): string {
  // Sempre com letra e número, para passar na validação de força.
  return `Pri${randomBytes(4).toString("hex")}${Math.floor(Math.random() * 90 + 10)}`;
}

/* ------------------------------------------------------------------ *
 * Equipes / setores
 * ------------------------------------------------------------------ */

export async function listTeams(auth: AuthContext) {
  const db = await getDb();
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      color: teams.color,
      isActive: teams.isActive,
      memberCount: sql<number>`(select count(*)::int from ${teamMembers} tm where tm.team_id = ${teams.id})`,
    })
    .from(teams)
    .where(eq(teams.organizationId, auth.organizationId))
    .orderBy(teams.name);
  return rows;
}

export async function createTeam(
  auth: AuthContext,
  input: { name: string; description?: string; color?: string },
) {
  requirePermission(auth, "teams.manage");
  const db = await getDb();
  const [team] = await db
    .insert(teams)
    .values({
      organizationId: auth.organizationId,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      color: input.color ?? "#16A34A",
    })
    .returning();

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "team.created",
    entityType: "team",
    entityId: team.id,
  });
  return team;
}

export async function updateTeam(
  auth: AuthContext,
  teamId: string,
  input: Partial<{ name: string; description: string | null; color: string; isActive: boolean }>,
) {
  requirePermission(auth, "teams.manage");
  const db = await getDb();
  const [team] = await db
    .update(teams)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(teams.id, teamId), eq(teams.organizationId, auth.organizationId)))
    .returning();
  if (!team) throw errors.notFound("Equipe não encontrada.");
  return team;
}

export async function setTeamMembers(
  auth: AuthContext,
  teamId: string,
  members: { userId: string; isSupervisor: boolean }[],
) {
  requirePermission(auth, "teams.manage");
  const db = await getDb();

  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.organizationId, auth.organizationId)))
    .limit(1);
  if (!team) throw errors.notFound("Equipe não encontrada.");

  await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
  if (members.length > 0) {
    await db.insert(teamMembers).values(
      members.map((m) => ({
        organizationId: auth.organizationId,
        teamId,
        userId: m.userId,
        isSupervisor: m.isSupervisor,
      })),
    );
  }

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "team.members_updated",
    entityType: "team",
    entityId: teamId,
    metadata: { total: members.length },
  });
}

/* ------------------------------------------------------------------ *
 * Convites
 * ------------------------------------------------------------------ */

export async function inviteUser(
  auth: AuthContext,
  input: { name: string; email: string; role: UserRole; teamId?: string },
) {
  requirePermission(auth, "users.manage");
  const db = await getDb();
  const email = input.email.trim().toLowerCase();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (existing.length > 0) {
    throw errors.conflict("Este e-mail já pertence a um usuário.");
  }

  const token = randomBytes(32).toString("base64url");
  const [invitation] = await db
    .insert(invitations)
    .values({
      organizationId: auth.organizationId,
      email,
      name: input.name.trim(),
      role: input.role,
      teamId: input.teamId ?? null,
      tokenHash: hashToken(token),
      invitedBy: auth.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning();

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "user.invited",
    entityType: "invitation",
    entityId: invitation.id,
    metadata: { email, perfil: input.role },
  });

  const link = `${env.appUrl}/convite?token=${token}`;
  // TODO(integração de e-mail): enviar o convite por e-mail transacional.
  console.info(`[pricall] convite gerado para ${email}: ${link}`);

  return { invitation, link };
}

export async function acceptInvitation(
  token: string,
  input: { password: string; phone?: string },
) {
  const db = await getDb();
  const problems = validatePasswordStrength(input.password);
  if (problems.length > 0) throw errors.validation(problems.join(" "));

  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);

  if (!invitation || invitation.status !== "pending" || invitation.expiresAt < new Date()) {
    throw errors.validation("Convite inválido ou expirado.");
  }

  const [user] = await db
    .insert(users)
    .values({
      organizationId: invitation.organizationId,
      name: invitation.name,
      email: invitation.email,
      phone: input.phone ? normalizePhone(input.phone) : null,
      role: invitation.role,
      passwordHash: await hashPassword(input.password),
      isActive: true,
    })
    .returning();

  if (invitation.teamId) {
    await db.insert(teamMembers).values({
      organizationId: invitation.organizationId,
      teamId: invitation.teamId,
      userId: user.id,
      isSupervisor: invitation.role === "supervisor",
    });
  }

  await db
    .update(invitations)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(invitations.id, invitation.id));

  await recordAudit({
    organizationId: invitation.organizationId,
    userId: user.id,
    action: "user.invitation_accepted",
    entityType: "user",
    entityId: user.id,
  });

  return user;
}

/* ------------------------------------------------------------------ *
 * Desempenho individual
 * ------------------------------------------------------------------ */

export async function getUserPerformance(
  auth: AuthContext,
  userId: string,
  days = 30,
) {
  if (userId !== auth.userId) requirePermission(auth, "users.view");
  const db = await getDb();
  const since = daysAgo(days);

  const [totals] = await db
    .select({
      total: count(),
      closed: sql<number>`count(*) filter (where ${conversations.status} = 'closed')::int`,
      firstResponseAvg: avg(
        sql<number>`extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt}))`,
      ),
      handleTimeAvg: avg(
        sql<number>`extract(epoch from (${conversations.closedAt} - ${conversations.createdAt}))`,
      ),
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, auth.organizationId),
        eq(conversations.assignedUserId, userId),
        gte(conversations.createdAt, since),
      ),
    );

  const [messageStats] = await db
    .select({
      sent: count(),
      failed: sql<number>`count(*) filter (where ${messages.status} = 'failed')::int`,
    })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, auth.organizationId),
        eq(messages.senderUserId, userId),
        gte(messages.createdAt, since),
      ),
    );

  return {
    periodDays: days,
    conversations: Number(totals?.total ?? 0),
    closed: Number(totals?.closed ?? 0),
    averageFirstResponseSeconds: totals?.firstResponseAvg
      ? Math.round(Number(totals.firstResponseAvg))
      : null,
    averageHandleTimeSeconds: totals?.handleTimeAvg
      ? Math.round(Number(totals.handleTimeAvg))
      : null,
    messagesSent: Number(messageStats?.sent ?? 0),
    messagesFailed: Number(messageStats?.failed ?? 0),
  };
}

/* ------------------------------------------------------------------ *
 * Utilitários de data
 * ------------------------------------------------------------------ */

export function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export { can };
