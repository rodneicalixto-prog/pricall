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
import { formatPhone, maskPhone } from "@/lib/phone";
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
