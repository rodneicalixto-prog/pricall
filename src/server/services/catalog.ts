/**
 * Cadastros de apoio: marcadores e respostas rápidas.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { conversationTags, quickReplies, tags } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { errors } from "@/lib/errors";
import { missingVariables, renderTemplate, type TemplateVariables } from "@/lib/templates";

/* ---------------------------- Marcadores ---------------------------- */

export async function listTags(auth: AuthContext, includeInactive = false) {
  const db = await getDb();
  const filters = [eq(tags.organizationId, auth.organizationId)];
  if (!includeInactive) filters.push(eq(tags.isActive, true));

  return db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      isActive: tags.isActive,
      usageCount: sql<number>`(select count(*)::int from ${conversationTags} ct where ct.tag_id = ${tags.id})`,
    })
    .from(tags)
    .where(and(...filters))
    .orderBy(tags.name);
}

export async function createTag(
  auth: AuthContext,
  input: { name: string; color: string },
) {
  requirePermission(auth, "tags.manage");
  const db = await getDb();
  const name = input.name.trim();
  if (!name) throw errors.validation("Informe o nome do marcador.");

  const existing = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.organizationId, auth.organizationId), eq(tags.name, name)))
    .limit(1);
  if (existing.length > 0) {
    throw errors.conflict("Já existe um marcador com este nome.");
  }

  const [tag] = await db
    .insert(tags)
    .values({ organizationId: auth.organizationId, name, color: input.color })
    .returning();
  return tag;
}

export async function updateTag(
  auth: AuthContext,
  tagId: string,
  input: Partial<{ name: string; color: string; isActive: boolean }>,
) {
  requirePermission(auth, "tags.manage");
  const db = await getDb();
  const [tag] = await db
    .update(tags)
    .set(input)
    .where(and(eq(tags.id, tagId), eq(tags.organizationId, auth.organizationId)))
    .returning();
  if (!tag) throw errors.notFound("Marcador não encontrado.");
  return tag;
}

/* ------------------------- Respostas rápidas ------------------------- */

export async function listQuickReplies(
  auth: AuthContext,
  options: { includeInactive?: boolean } = {},
) {
  const db = await getDb();
  const filters = [eq(quickReplies.organizationId, auth.organizationId)];
  if (!options.includeInactive) filters.push(eq(quickReplies.isActive, true));

  const rows = await db
    .select()
    .from(quickReplies)
    .where(and(...filters))
    .orderBy(quickReplies.category, quickReplies.title);

  // Vendedor só recebe as respostas liberadas para as equipes dele.
  if (auth.role === "seller") {
    return rows.filter(
      (r) =>
        r.allowedTeamIds.length === 0 ||
        r.allowedTeamIds.some((id) => auth.teamIds.includes(id)),
    );
  }
  return rows;
}

export type QuickReplyInput = {
  title: string;
  shortcut: string;
  content: string;
  category?: string;
  allowedTeamIds?: string[];
  isActive?: boolean;
};

export async function createQuickReply(auth: AuthContext, input: QuickReplyInput) {
  requirePermission(auth, "quick_replies.manage");
  const db = await getDb();
  const shortcut = normalizeShortcut(input.shortcut);

  const existing = await db
    .select({ id: quickReplies.id })
    .from(quickReplies)
    .where(
      and(
        eq(quickReplies.organizationId, auth.organizationId),
        eq(quickReplies.shortcut, shortcut),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw errors.conflict("Já existe uma resposta rápida com este atalho.");
  }

  const [row] = await db
    .insert(quickReplies)
    .values({
      organizationId: auth.organizationId,
      title: input.title.trim(),
      shortcut,
      content: input.content,
      category: input.category?.trim() || null,
      allowedTeamIds: input.allowedTeamIds ?? [],
      isActive: input.isActive ?? true,
      createdBy: auth.userId,
    })
    .returning();

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "quick_reply.created",
    entityType: "quick_reply",
    entityId: row.id,
  });
  return row;
}

export async function updateQuickReply(
  auth: AuthContext,
  id: string,
  input: Partial<QuickReplyInput>,
) {
  requirePermission(auth, "quick_replies.manage");
  const db = await getDb();

  const [row] = await db
    .update(quickReplies)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.shortcut !== undefined
        ? { shortcut: normalizeShortcut(input.shortcut) }
        : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.category !== undefined ? { category: input.category || null } : {}),
      ...(input.allowedTeamIds !== undefined
        ? { allowedTeamIds: input.allowedTeamIds }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(quickReplies.id, id), eq(quickReplies.organizationId, auth.organizationId)),
    )
    .returning();

  if (!row) throw errors.notFound("Resposta rápida não encontrada.");
  return row;
}

export async function deleteQuickReply(auth: AuthContext, id: string) {
  requirePermission(auth, "quick_replies.manage");
  const db = await getDb();
  await db
    .delete(quickReplies)
    .where(
      and(eq(quickReplies.id, id), eq(quickReplies.organizationId, auth.organizationId)),
    );
}

/** Pré-visualização com as variáveis já substituídas. */
export function previewQuickReply(content: string, variables: TemplateVariables) {
  return {
    preview: renderTemplate(content, variables),
    missing: missingVariables(content, variables),
  };
}

function normalizeShortcut(raw: string): string {
  const clean = raw.trim().toLowerCase().replace(/\s+/g, "-");
  return clean.startsWith("/") ? clean : `/${clean}`;
}
