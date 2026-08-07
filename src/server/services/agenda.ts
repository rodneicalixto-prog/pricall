/**
 * Agenda e calendário: compromissos do vendedor e lembretes de retorno.
 */
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  calendarEvents,
  contacts,
  conversations,
  scheduledFollowups,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { recordConversationEvent } from "@/lib/audit";
import { errors } from "@/lib/errors";
import { notify } from "./notifications";

/* ---------------------------- Calendário ---------------------------- */

export async function listCalendar(
  auth: AuthContext,
  range: { from: Date; to: Date; userId?: string },
) {
  const db = await getDb();

  // Vendedor só vê a própria agenda; supervisor/admin podem filtrar por usuário.
  const targetUserId =
    range.userId && can(auth, "users.view") ? range.userId : auth.userId;

  const events = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      description: calendarEvents.description,
      location: calendarEvents.location,
      startsAt: calendarEvents.startsAt,
      endsAt: calendarEvents.endsAt,
      status: calendarEvents.status,
      conversationId: calendarEvents.conversationId,
      contactId: calendarEvents.contactId,
      contactName: contacts.name,
      userId: calendarEvents.userId,
      userName: users.name,
    })
    .from(calendarEvents)
    .leftJoin(contacts, eq(contacts.id, calendarEvents.contactId))
    .leftJoin(users, eq(users.id, calendarEvents.userId))
    .where(
      and(
        eq(calendarEvents.organizationId, auth.organizationId),
        eq(calendarEvents.userId, targetUserId),
        gte(calendarEvents.startsAt, range.from),
        lte(calendarEvents.startsAt, range.to),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt));

  const followups = await db
    .select({
      id: scheduledFollowups.id,
      conversationId: scheduledFollowups.conversationId,
      scheduledAt: scheduledFollowups.scheduledAt,
      note: scheduledFollowups.note,
      status: scheduledFollowups.status,
      contactName: contacts.name,
    })
    .from(scheduledFollowups)
    .innerJoin(conversations, eq(conversations.id, scheduledFollowups.conversationId))
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(
      and(
        eq(scheduledFollowups.organizationId, auth.organizationId),
        eq(scheduledFollowups.assignedUserId, targetUserId),
        gte(scheduledFollowups.scheduledAt, range.from),
        lte(scheduledFollowups.scheduledAt, range.to),
      ),
    )
    .orderBy(asc(scheduledFollowups.scheduledAt));

  return {
    events: events.map((e) => ({
      ...e,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
    })),
    followups: followups.map((f) => ({
      ...f,
      scheduledAt: f.scheduledAt.toISOString(),
    })),
  };
}

export type CreateCalendarEventInput = {
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  conversationId?: string | null;
  contactId?: string | null;
  remindMinutesBefore?: number | null;
  userId?: string;
};

export async function createCalendarEvent(
  auth: AuthContext,
  input: CreateCalendarEventInput,
) {
  const db = await getDb();
  if (input.endsAt <= input.startsAt) {
    throw errors.validation("O horário de término deve ser depois do início.");
  }

  const targetUserId =
    input.userId && can(auth, "conversations.assign_others")
      ? input.userId
      : auth.userId;

  const [event] = await db
    .insert(calendarEvents)
    .values({
      organizationId: auth.organizationId,
      userId: targetUserId,
      conversationId: input.conversationId ?? null,
      contactId: input.contactId ?? null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      location: input.location?.trim() || null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      remindMinutesBefore: input.remindMinutesBefore ?? 30,
      createdBy: auth.userId,
    })
    .returning();

  if (input.conversationId) {
    await recordConversationEvent({
      organizationId: auth.organizationId,
      conversationId: input.conversationId,
      eventType: "calendar_event_created",
      actorUserId: auth.userId,
      newValue: { titulo: event.title, inicio: event.startsAt.toISOString() },
    });
  }

  if (targetUserId !== auth.userId) {
    await notify({
      organizationId: auth.organizationId,
      userId: targetUserId,
      type: "calendar_reminder",
      title: "Novo compromisso na sua agenda",
      body: `${auth.name} agendou "${event.title}".`,
      conversationId: input.conversationId ?? null,
    });
  }

  return event;
}

export async function updateCalendarEvent(
  auth: AuthContext,
  eventId: string,
  input: Partial<{
    title: string;
    description: string | null;
    location: string | null;
    startsAt: Date;
    endsAt: Date;
    status: "scheduled" | "done" | "cancelled";
  }>,
) {
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, eventId),
        eq(calendarEvents.organizationId, auth.organizationId),
      ),
    )
    .limit(1);

  if (!existing) throw errors.notFound("Compromisso não encontrado.");
  if (existing.userId !== auth.userId && !can(auth, "conversations.assign_others")) {
    throw errors.forbidden("Este compromisso pertence a outro usuário.");
  }

  const [updated] = await db
    .update(calendarEvents)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(calendarEvents.id, eventId))
    .returning();

  if (updated.conversationId) {
    await recordConversationEvent({
      organizationId: auth.organizationId,
      conversationId: updated.conversationId,
      eventType: "calendar_event_updated",
      actorUserId: auth.userId,
      newValue: { status: updated.status },
    });
  }

  return updated;
}

export async function deleteCalendarEvent(auth: AuthContext, eventId: string) {
  const db = await getDb();
  const [existing] = await db
    .select({ userId: calendarEvents.userId })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.id, eventId),
        eq(calendarEvents.organizationId, auth.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw errors.notFound("Compromisso não encontrado.");
  if (existing.userId !== auth.userId && !can(auth, "conversations.assign_others")) {
    throw errors.forbidden();
  }
  await db.delete(calendarEvents).where(eq(calendarEvents.id, eventId));
}

/* --------------------------- Retornos --------------------------- */

export async function listFollowups(
  auth: AuthContext,
  options: { status?: "pending" | "overdue" | "completed" | "cancelled"; limit?: number } = {},
) {
  const db = await getDb();
  const filters = [
    eq(scheduledFollowups.organizationId, auth.organizationId),
    can(auth, "conversations.view_all")
      ? undefined
      : eq(scheduledFollowups.assignedUserId, auth.userId),
  ];
  if (options.status) filters.push(eq(scheduledFollowups.status, options.status));

  const rows = await db
    .select({
      id: scheduledFollowups.id,
      conversationId: scheduledFollowups.conversationId,
      scheduledAt: scheduledFollowups.scheduledAt,
      note: scheduledFollowups.note,
      status: scheduledFollowups.status,
      assignedUserId: scheduledFollowups.assignedUserId,
      contactName: contacts.name,
      userName: users.name,
    })
    .from(scheduledFollowups)
    .innerJoin(conversations, eq(conversations.id, scheduledFollowups.conversationId))
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(users, eq(users.id, scheduledFollowups.assignedUserId))
    .where(and(...filters.filter(Boolean)))
    .orderBy(asc(scheduledFollowups.scheduledAt))
    .limit(options.limit ?? 50);

  return rows.map((r) => ({ ...r, scheduledAt: r.scheduledAt.toISOString() }));
}

export async function createFollowup(
  auth: AuthContext,
  input: { conversationId: string; scheduledAt: Date; note?: string; assignedUserId?: string },
) {
  const db = await getDb();
  if (input.scheduledAt.getTime() <= Date.now()) {
    throw errors.validation("A data do retorno precisa estar no futuro.");
  }

  const [followup] = await db
    .insert(scheduledFollowups)
    .values({
      organizationId: auth.organizationId,
      conversationId: input.conversationId,
      assignedUserId: input.assignedUserId ?? auth.userId,
      scheduledAt: input.scheduledAt,
      note: input.note?.trim() || null,
      createdBy: auth.userId,
    })
    .returning();

  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId: input.conversationId,
    eventType: "followup_scheduled",
    actorUserId: auth.userId,
    newValue: { agendadoPara: input.scheduledAt.toISOString() },
  });

  return followup;
}

export async function completeFollowup(auth: AuthContext, followupId: string) {
  const db = await getDb();
  const [updated] = await db
    .update(scheduledFollowups)
    .set({ status: "completed", completedAt: new Date() })
    .where(
      and(
        eq(scheduledFollowups.id, followupId),
        eq(scheduledFollowups.organizationId, auth.organizationId),
      ),
    )
    .returning();
  if (!updated) throw errors.notFound("Retorno não encontrado.");

  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId: updated.conversationId,
    eventType: "followup_completed",
    actorUserId: auth.userId,
  });

  return updated;
}

/**
 * Tarefa periódica: marca retornos vencidos e notifica o responsável.
 * Chamada por `/api/jobs/tick`.
 */
export async function processDueFollowups(): Promise<number> {
  const db = await getDb();
  const now = new Date();

  const due = await db
    .select()
    .from(scheduledFollowups)
    .where(
      and(
        eq(scheduledFollowups.status, "pending"),
        lte(scheduledFollowups.scheduledAt, now),
      ),
    )
    .limit(200);

  for (const followup of due) {
    await db
      .update(scheduledFollowups)
      .set({ status: "overdue" })
      .where(eq(scheduledFollowups.id, followup.id));

    if (followup.assignedUserId) {
      await notify({
        organizationId: followup.organizationId,
        userId: followup.assignedUserId,
        type: "followup_due",
        title: "Retorno agendado chegou",
        body: followup.note ?? "Está na hora de retornar o contato com o cliente.",
        conversationId: followup.conversationId,
      });
    }
  }

  return due.length;
}

/** Tarefa periódica: lembretes de compromissos da agenda. */
export async function processCalendarReminders(): Promise<number> {
  const db = await getDb();
  const now = new Date();

  const events = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.status, "scheduled"),
        sql`${calendarEvents.reminderSentAt} is null`,
        sql`${calendarEvents.startsAt} <= ${now} + (coalesce(${calendarEvents.remindMinutesBefore}, 30) * interval '1 minute')`,
        gte(calendarEvents.startsAt, now),
      ),
    )
    .limit(200);

  for (const event of events) {
    await notify({
      organizationId: event.organizationId,
      userId: event.userId,
      type: "calendar_reminder",
      title: `Compromisso em breve: ${event.title}`,
      body: new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(event.startsAt),
      conversationId: event.conversationId,
    });

    await db
      .update(calendarEvents)
      .set({ reminderSentAt: new Date() })
      .where(eq(calendarEvents.id, event.id));
  }

  return events.length;
}

export { inArray };
