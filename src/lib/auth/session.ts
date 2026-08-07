/**
 * Sessões por cookie HttpOnly.
 *
 * O cookie guarda um token aleatório de 32 bytes; o banco guarda apenas o
 * SHA-256 desse token. Logo, um vazamento da tabela `sessions` não permite
 * personificar ninguém.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { sessions, users, type UserRole } from "@/db/schema";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "pricall_session";

export type AuthContext = {
  userId: string;
  organizationId: string;
  role: UserRole;
  name: string;
  email: string;
  avatarUrl: string | null;
  sessionId: string;
  /** Ids das equipes das quais o usuário participa. */
  teamIds: string[];
  /** Ids das equipes em que o usuário é supervisor. */
  supervisedTeamIds: string[];
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type CreateSessionInput = {
  userId: string;
  organizationId: string;
  remember?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function createSession(input: CreateSessionInput): Promise<{
  token: string;
  expiresAt: Date;
  sessionId: string;
}> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const ttlMs = input.remember
    ? env.sessionRememberTtlDays * 24 * 60 * 60 * 1000
    : env.sessionTtlHours * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  const [row] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      tokenHash: hashToken(token),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt,
    })
    .returning({ id: sessions.id });

  return { token, expiresAt, sessionId: row.id };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Revoga uma sessão específica (logout). */
export async function revokeSession(sessionId: string) {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

/** Revoga todas as sessões de um usuário (troca de senha, desativação). */
export async function revokeAllSessions(userId: string) {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Remove sessões expiradas/revogadas antigas. */
export async function pruneSessions() {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, cutoff), lt(sessions.revokedAt, cutoff)));
}

/**
 * Resolve o contexto autenticado a partir do cookie.
 * Retorna `null` quando não há sessão válida — nunca lança.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveAuthFromToken(token);
}

export async function resolveAuthFromToken(
  token: string,
): Promise<AuthContext | null> {
  const db = await getDb();
  const now = new Date();

  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      organizationId: users.organizationId,
      role: users.role,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.isActive) return null;

  const { teamIds, supervisedTeamIds } = await loadTeamScope(row.userId);

  // Atualização best-effort de presença; não bloqueia a requisição.
  void touchSession(row.sessionId, row.userId);

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    organizationId: row.organizationId,
    role: row.role,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    teamIds,
    supervisedTeamIds,
  };
}

async function loadTeamScope(userId: string) {
  const db = await getDb();
  const { teamMembers } = await import("@/db/schema");
  const memberships = await db
    .select({
      teamId: teamMembers.teamId,
      isSupervisor: teamMembers.isSupervisor,
    })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));

  return {
    teamIds: memberships.map((m) => m.teamId),
    supervisedTeamIds: memberships
      .filter((m) => m.isSupervisor)
      .map((m) => m.teamId),
  };
}

let lastTouchAt = new Map<string, number>();

async function touchSession(sessionId: string, userId: string) {
  // Evita um UPDATE por requisição: no máximo um a cada 60 s por sessão.
  const previous = lastTouchAt.get(sessionId) ?? 0;
  if (Date.now() - previous < 60_000) return;
  lastTouchAt.set(sessionId, Date.now());
  if (lastTouchAt.size > 5_000) lastTouchAt = new Map();

  try {
    const db = await getDb();
    const now = new Date();
    await db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, sessionId));
    await db
      .update(users)
      .set({ lastActivityAt: now })
      .where(eq(users.id, userId));
  } catch {
    // presença é best-effort
  }
}
