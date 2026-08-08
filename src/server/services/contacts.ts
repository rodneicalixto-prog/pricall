/**
 * Contatos: painel lateral do cliente, edição, bloqueio e consentimentos.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contactConsents, contacts, conversations, users } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { can, requirePermission } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { errors } from "@/lib/errors";
import { formatPhone, isValidPhone, maskPhone, normalizePhone } from "@/lib/phone";
import { getOrganizationSettings } from "./organization";

export async function getContactPanel(auth: AuthContext, contactId: string) {
  const db = await getDb();
  const settings = await getOrganizationSettings(auth.organizationId);
  const mask =
    settings.maskPhoneForSellers === true && !can(auth, "contacts.view_full_phone");

  const [contact] = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.id, contactId), eq(contacts.organizationId, auth.organizationId)),
    )
    .limit(1);
  if (!contact) throw errors.notFound("Contato não encontrado.");

  const history = await db
    .select({
      id: conversations.id,
      status: conversations.status,
      outcome: conversations.outcome,
      closingReason: conversations.closingReason,
      createdAt: conversations.createdAt,
      closedAt: conversations.closedAt,
      assignedUserName: users.name,
    })
    .from(conversations)
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .where(eq(conversations.contactId, contactId))
    .orderBy(desc(conversations.createdAt))
    .limit(20);

  const consents = await db
    .select()
    .from(contactConsents)
    .where(eq(contactConsents.contactId, contactId))
    .orderBy(desc(contactConsents.createdAt));

  return {
    contact: {
      ...contact,
      phone: mask ? maskPhone(contact.phone) : formatPhone(contact.phone),
      phoneMasked: mask,
      firstContactAt: contact.firstContactAt.toISOString(),
      lastContactAt: contact.lastContactAt.toISOString(),
    },
    history: history.map((h) => ({
      ...h,
      createdAt: h.createdAt.toISOString(),
      closedAt: h.closedAt?.toISOString() ?? null,
    })),
    consents: consents.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
  };
}

export type UpdateContactInput = Partial<{
  name: string;
  email: string | null;
  companyName: string | null;
  city: string | null;
  source: string;
  notes: string | null;
}>;

export async function updateContact(
  auth: AuthContext,
  contactId: string,
  input: UpdateContactInput,
) {
  const db = await getDb();
  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(eq(contacts.id, contactId), eq(contacts.organizationId, auth.organizationId)),
    )
    .limit(1);
  if (!existing) throw errors.notFound("Contato não encontrado.");

  const [updated] = await db
    .update(contacts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(contacts.id, contactId))
    .returning();

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "contact.updated",
    entityType: "contact",
    entityId: contactId,
    metadata: { campos: Object.keys(input) },
  });

  return updated;
}

export async function setContactBlocked(
  auth: AuthContext,
  contactId: string,
  blocked: boolean,
  reason?: string,
) {
  requirePermission(auth, "contacts.block");
  const db = await getDb();

  const [updated] = await db
    .update(contacts)
    .set({
      isBlocked: blocked,
      blockedReason: blocked ? (reason?.trim() || "Bloqueado pelo atendimento") : null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(contacts.id, contactId), eq(contacts.organizationId, auth.organizationId)),
    )
    .returning();

  if (!updated) throw errors.notFound("Contato não encontrado.");

  // Bloquear encerra as conversas abertas do contato.
  if (blocked) {
    await db
      .update(conversations)
      .set({
        status: "closed",
        closedAt: new Date(),
        closedBy: auth.userId,
        closingReason: "Contato bloqueado",
        outcome: "Spam",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversations.contactId, contactId),
          sql`${conversations.status} <> 'closed'`,
        ),
      );
  }

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: blocked ? "contact.blocked" : "contact.unblocked",
    entityType: "contact",
    entityId: contactId,
    metadata: { motivo: reason ?? null },
  });

  return updated;
}

export async function recordConsent(
  auth: AuthContext,
  contactId: string,
  kind: string,
  granted: boolean,
  source?: string,
) {
  const db = await getDb();
  const [row] = await db
    .insert(contactConsents)
    .values({
      organizationId: auth.organizationId,
      contactId,
      kind,
      granted,
      source: source ?? "registro manual no atendimento",
      recordedBy: auth.userId,
    })
    .returning();

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "contact.consent_recorded",
    entityType: "contact",
    entityId: contactId,
    metadata: { tipo: kind, concedido: granted },
  });

  return row;
}

/* ------------------------------------------------------------------ *
 * Agenda de contatos
 *
 * Os contatos já eram gravados a cada mensagem recebida, mas não havia onde
 * vê-los nem como puxar conversa com alguém que já escreveu antes — só dava
 * para responder a quem chegasse primeiro.
 * ------------------------------------------------------------------ */

export type ContactListItem = {
  id: string;
  name: string;
  phone: string;
  phoneFormatted: string;
  isBlocked: boolean;
  lastContactAt: Date | null;
  openConversationId: string | null;
};

export async function listContacts(
  auth: AuthContext,
  input: { search?: string; limit?: number; offset?: number } = {},
): Promise<{ items: ContactListItem[]; total: number }> {
  const db = await getDb();
  const settings = await getOrganizationSettings(auth.organizationId);
  const mask =
    settings.maskPhoneForSellers === true && !can(auth, "contacts.view_full_phone");

  const limit = Math.min(input.limit ?? 50, 100);
  const offset = input.offset ?? 0;
  const termo = input.search?.trim();

  // Busca por nome ou por telefone, ignorando a formatação que a pessoa digitar.
  const filtro = termo
    ? and(
        eq(contacts.organizationId, auth.organizationId),
        sql`(${contacts.name} ilike ${"%" + termo + "%"} or ${contacts.phone} like ${
          "%" + termo.replace(/\D/g, "") + "%"
        })`,
      )
    : eq(contacts.organizationId, auth.organizationId);

  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
      isBlocked: contacts.isBlocked,
      lastContactAt: contacts.lastContactAt,
      openConversationId: sql<string | null>`(
        select c.id from ${conversations} c
        where c.contact_id = ${contacts.id} and c.status <> 'closed'
        order by c.last_message_at desc nulls last
        limit 1
      )`,
    })
    .from(contacts)
    .where(filtro)
    .orderBy(desc(contacts.lastContactAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contacts)
    .where(filtro);

  return {
    total: Number(total),
    items: rows.map((row) => ({
      ...row,
      phone: mask ? maskPhone(row.phone) : row.phone,
      phoneFormatted: mask ? maskPhone(row.phone) : formatPhone(row.phone),
    })),
  };
}

export async function createContact(
  auth: AuthContext,
  input: { name: string; phone: string; email?: string; notes?: string },
) {
  const db = await getDb();
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) {
    throw errors.validation("Telefone inválido. Use DDD + número.");
  }

  const whatsappId = `${phone}@s.whatsapp.net`;

  const [existing] = await db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, auth.organizationId),
        eq(contacts.whatsappId, whatsappId),
      ),
    )
    .limit(1);

  if (existing) {
    throw errors.conflict(`Este número já está na agenda como "${existing.name}".`);
  }

  const [contact] = await db
    .insert(contacts)
    .values({
      organizationId: auth.organizationId,
      whatsappId,
      phone,
      name: input.name.trim(),
      email: input.email?.trim() || null,
      notes: input.notes?.trim() || null,
      source: "manual",
    })
    .returning();

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "contact.created",
    entityType: "contact",
    entityId: contact.id,
    metadata: { origem: "cadastro manual" },
  });

  return contact;
}

/**
 * Abre (ou reaproveita) uma conversa com um contato, para quem quer puxar
 * assunto em vez de esperar o cliente escrever.
 *
 * Não envia mensagem: devolve a conversa pronta, já atribuída a quem pediu.
 * O envio segue pelo caminho normal, com as mesmas regras de janela de
 * atendimento e de bloqueio.
 */
export async function startConversation(
  auth: AuthContext,
  input: { contactId: string; connectionId?: string },
): Promise<{ conversationId: string; created: boolean }> {
  const db = await getDb();

  const [contact] = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, input.contactId),
        eq(contacts.organizationId, auth.organizationId),
      ),
    )
    .limit(1);
  if (!contact) throw errors.notFound("Contato não encontrado.");
  if (contact.isBlocked) {
    throw errors.validation("Este contato está bloqueado. Desbloqueie para conversar.");
  }

  // Conversa aberta com este contato: entra nela em vez de criar outra.
  const [aberta] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, auth.organizationId),
        eq(conversations.contactId, contact.id),
        sql`${conversations.status} <> 'closed'`,
      ),
    )
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`)
    .limit(1);

  if (aberta) return { conversationId: aberta.id, created: false };

  const { whatsappConnections } = await import("@/db/schema");
  const [connection] = await db
    .select({ id: whatsappConnections.id, teamId: whatsappConnections.teamId })
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.organizationId, auth.organizationId),
        input.connectionId
          ? eq(whatsappConnections.id, input.connectionId)
          : sql`${whatsappConnections.status} <> 'disabled'`,
      ),
    )
    .orderBy(desc(whatsappConnections.isDefault))
    .limit(1);

  if (!connection) {
    throw errors.validation(
      "Nenhum número de WhatsApp disponível para iniciar a conversa.",
    );
  }

  const agora = new Date();
  const [conversa] = await db
    .insert(conversations)
    .values({
      organizationId: auth.organizationId,
      contactId: contact.id,
      whatsappConnectionId: connection.id,
      // Quem abre já assume: foi uma decisão de atender, não uma fila.
      assignedUserId: auth.userId,
      assignedTeamId: connection.teamId ?? null,
      assignedAt: agora,
      status: "in_progress",
      lastMessageAt: agora,
    })
    .returning({ id: conversations.id });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "conversation.started",
    entityType: "conversation",
    entityId: conversa.id,
    metadata: { origem: "iniciada pela agenda", contato: contact.name },
  });

  const { recordConversationEvent } = await import("@/lib/audit");
  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId: conversa.id,
    eventType: "created",
    actorUserId: auth.userId,
    newValue: { origem: "iniciada pela agenda" },
  });

  const { publish } = await import("@/lib/realtime/bus");
  await publish(auth.organizationId, {
    type: "conversation.created",
    conversationId: conversa.id,
  });

  return { conversationId: conversa.id, created: true };
}
