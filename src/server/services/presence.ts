/**
 * Presença na conversa: quem está com ela aberta e quem está digitando.
 * Evita que dois vendedores respondam ao mesmo tempo sem perceber.
 */
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { conversationViewers, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { publish } from "@/lib/realtime/bus";

/** Presença expira em 45 s; o cliente renova a cada 20 s. */
const TTL_MS = 45_000;

export async function heartbeat(
  auth: AuthContext,
  conversationId: string,
  isTyping: boolean,
) {
  const db = await getDb();
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db
    .insert(conversationViewers)
    .values({
      organizationId: auth.organizationId,
      conversationId,
      userId: auth.userId,
      isTyping,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [conversationViewers.conversationId, conversationViewers.userId],
      set: { isTyping, expiresAt, updatedAt: new Date() },
    });

  await publish(auth.organizationId, {
    type: "presence.updated",
    conversationId,
    userId: auth.userId,
    userName: auth.name,
    isTyping,
  });

  return listViewers(auth, conversationId);
}

export async function leave(auth: AuthContext, conversationId: string) {
  const db = await getDb();
  await db
    .delete(conversationViewers)
    .where(
      and(
        eq(conversationViewers.conversationId, conversationId),
        eq(conversationViewers.userId, auth.userId),
      ),
    );

  await publish(auth.organizationId, {
    type: "presence.updated",
    conversationId,
    userId: auth.userId,
    userName: auth.name,
    isTyping: false,
  });
}

/** Outros usuários com a conversa aberta neste momento. */
export async function listViewers(auth: AuthContext, conversationId: string) {
  const db = await getDb();
  const rows = await db
    .select({
      userId: conversationViewers.userId,
      userName: users.name,
      isTyping: conversationViewers.isTyping,
    })
    .from(conversationViewers)
    .innerJoin(users, eq(users.id, conversationViewers.userId))
    .where(
      and(
        eq(conversationViewers.conversationId, conversationId),
        eq(conversationViewers.organizationId, auth.organizationId),
        ne(conversationViewers.userId, auth.userId),
        gt(conversationViewers.expiresAt, new Date()),
      ),
    );
  return rows;
}

/** Limpeza das presenças expiradas (tarefa periódica). */
export async function prunePresence() {
  const db = await getDb();
  await db
    .delete(conversationViewers)
    .where(lt(conversationViewers.expiresAt, new Date()));
}
