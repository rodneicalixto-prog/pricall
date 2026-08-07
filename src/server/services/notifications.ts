/**
 * Notificações internas.
 * Cada notificação também vira um evento em tempo real para o sino da UI.
 * Preferências individuais podem silenciar tipos específicos.
 */
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { describeError } from "@/lib/audit";
import { publish } from "@/lib/realtime/bus";

export type NotificationType =
  | "conversation_assigned"
  | "transfer_received"
  | "customer_replied"
  | "conversation_stalled"
  | "message_failed"
  | "followup_due"
  | "seller_overloaded"
  | "integration_down"
  | "urgent_conversation"
  | "calendar_reminder";

export type NotifyInput = {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  conversationId?: string | null;
};

/** Cria uma notificação. Nunca lança: não derruba a operação principal. */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const db = await getDb();

    const [user] = await db
      .select({ preferences: users.preferences, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!user?.isActive) return;

    const muted = user.preferences?.mutedNotificationTypes ?? [];
    if (muted.includes(input.type)) return;

    const [row] = await db
      .insert(notifications)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        relatedConversationId: input.conversationId ?? null,
      })
      .returning({ id: notifications.id });

    await publish(
      input.organizationId,
      { type: "notification.created", userId: input.userId, notificationId: row.id },
      input.userId,
    );
  } catch (error) {
    console.error("[pricall] falha ao notificar:", describeError(error));
  }
}

export async function listNotifications(
  auth: AuthContext,
  options: { unreadOnly?: boolean; limit?: number } = {},
) {
  const db = await getDb();
  const limit = Math.min(options.limit ?? 30, 100);

  const filters = [
    eq(notifications.userId, auth.userId),
    eq(notifications.organizationId, auth.organizationId),
  ];
  if (options.unreadOnly) filters.push(eq(notifications.isRead, false));

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...filters))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const unread = await db.$count(
    notifications,
    and(
      eq(notifications.userId, auth.userId),
      eq(notifications.organizationId, auth.organizationId),
      eq(notifications.isRead, false),
    ),
  );

  return {
    items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    unreadCount: Number(unread),
  };
}

export async function markNotificationsRead(
  auth: AuthContext,
  ids: string[] | "all",
) {
  const db = await getDb();
  const now = new Date();
  const base = and(
    eq(notifications.userId, auth.userId),
    eq(notifications.organizationId, auth.organizationId),
    eq(notifications.isRead, false),
  );

  await db
    .update(notifications)
    .set({ isRead: true, readAt: now })
    .where(ids === "all" ? base : and(base, inArray(notifications.id, ids)));
}

/** Remove notificações lidas com mais de 30 dias. */
export async function pruneNotifications() {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await db
    .delete(notifications)
    .where(and(eq(notifications.isRead, true), lt(notifications.createdAt, cutoff)));
}
