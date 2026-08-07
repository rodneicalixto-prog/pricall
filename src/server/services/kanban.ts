/**
 * Kanban individual — quadros ilimitados por usuário.
 *
 * Cada quadro pertence a um usuário. Supervisores e administradores podem
 * visualizar quadros marcados como compartilhados, mas apenas o dono edita.
 */
import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contacts,
  conversations,
  kanbanBoards,
  kanbanCards,
  kanbanColumns,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { errors } from "@/lib/errors";
import { publish } from "@/lib/realtime/bus";

const DEFAULT_COLUMNS = [
  { name: "Novos", color: "#2563EB" },
  { name: "Em contato", color: "#F59E0B" },
  { name: "Proposta enviada", color: "#0EA5E9" },
  { name: "Fechado", color: "#16A34A" },
];

export async function listBoards(auth: AuthContext) {
  const db = await getDb();

  const rows = await db
    .select({
      id: kanbanBoards.id,
      name: kanbanBoards.name,
      description: kanbanBoards.description,
      isShared: kanbanBoards.isShared,
      position: kanbanBoards.position,
      userId: kanbanBoards.userId,
      cardCount: sql<number>`(select count(*)::int from ${kanbanCards} kc where kc.board_id = ${kanbanBoards.id})`,
    })
    .from(kanbanBoards)
    .where(
      and(
        eq(kanbanBoards.organizationId, auth.organizationId),
        eq(kanbanBoards.userId, auth.userId),
        isNull(kanbanBoards.archivedAt),
      ),
    )
    .orderBy(asc(kanbanBoards.position), asc(kanbanBoards.createdAt));

  return rows.map((r) => ({ ...r, isOwner: true }));
}

export async function createBoard(
  auth: AuthContext,
  input: { name: string; description?: string; columns?: { name: string; color?: string }[] },
) {
  const db = await getDb();
  const name = input.name.trim();
  if (!name) throw errors.validation("Informe o nome do quadro.");

  const [{ value: lastPosition } = { value: null }] = await db
    .select({ value: max(kanbanBoards.position) })
    .from(kanbanBoards)
    .where(eq(kanbanBoards.userId, auth.userId));

  const [board] = await db
    .insert(kanbanBoards)
    .values({
      organizationId: auth.organizationId,
      userId: auth.userId,
      name,
      description: input.description?.trim() || null,
      position: (lastPosition ?? -1) + 1,
    })
    .returning();

  const columns = input.columns?.length ? input.columns : DEFAULT_COLUMNS;
  await db.insert(kanbanColumns).values(
    columns.map((column, index) => ({
      organizationId: auth.organizationId,
      boardId: board.id,
      name: column.name,
      color: column.color ?? "#64748B",
      position: index,
    })),
  );

  return board;
}

export async function getBoard(auth: AuthContext, boardId: string) {
  const db = await getDb();
  const board = await requireOwnedBoard(auth, boardId);

  const columns = await db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.boardId, boardId))
    .orderBy(asc(kanbanColumns.position));

  const cards = await db
    .select({
      id: kanbanCards.id,
      columnId: kanbanCards.columnId,
      conversationId: kanbanCards.conversationId,
      contactId: kanbanCards.contactId,
      title: kanbanCards.title,
      notes: kanbanCards.notes,
      value: kanbanCards.value,
      dueAt: kanbanCards.dueAt,
      position: kanbanCards.position,
      contactName: contacts.name,
      conversationStatus: conversations.status,
    })
    .from(kanbanCards)
    .leftJoin(contacts, eq(contacts.id, kanbanCards.contactId))
    .leftJoin(conversations, eq(conversations.id, kanbanCards.conversationId))
    .where(eq(kanbanCards.boardId, boardId))
    .orderBy(asc(kanbanCards.position));

  return {
    board,
    columns,
    cards: cards.map((c) => ({ ...c, dueAt: c.dueAt?.toISOString() ?? null })),
  };
}

export async function updateBoard(
  auth: AuthContext,
  boardId: string,
  input: Partial<{ name: string; description: string | null; isShared: boolean }>,
) {
  const db = await getDb();
  await requireOwnedBoard(auth, boardId);
  const [board] = await db
    .update(kanbanBoards)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(kanbanBoards.id, boardId))
    .returning();
  return board;
}

export async function archiveBoard(auth: AuthContext, boardId: string) {
  const db = await getDb();
  await requireOwnedBoard(auth, boardId);
  await db
    .update(kanbanBoards)
    .set({ archivedAt: new Date() })
    .where(eq(kanbanBoards.id, boardId));
}

export async function createColumn(
  auth: AuthContext,
  boardId: string,
  input: { name: string; color?: string; appliesConversationStatus?: string | null },
) {
  const db = await getDb();
  await requireOwnedBoard(auth, boardId);

  const [{ value: lastPosition } = { value: null }] = await db
    .select({ value: max(kanbanColumns.position) })
    .from(kanbanColumns)
    .where(eq(kanbanColumns.boardId, boardId));

  const [column] = await db
    .insert(kanbanColumns)
    .values({
      organizationId: auth.organizationId,
      boardId,
      name: input.name.trim(),
      color: input.color ?? "#64748B",
      position: (lastPosition ?? -1) + 1,
      appliesConversationStatus:
        (input.appliesConversationStatus as never) ?? null,
    })
    .returning();
  return column;
}

export async function deleteColumn(auth: AuthContext, columnId: string) {
  const db = await getDb();
  const [column] = await db
    .select({ boardId: kanbanColumns.boardId })
    .from(kanbanColumns)
    .where(
      and(
        eq(kanbanColumns.id, columnId),
        eq(kanbanColumns.organizationId, auth.organizationId),
      ),
    )
    .limit(1);
  if (!column) throw errors.notFound("Coluna não encontrada.");
  await requireOwnedBoard(auth, column.boardId);
  await db.delete(kanbanColumns).where(eq(kanbanColumns.id, columnId));
}

export type CreateCardInput = {
  boardId: string;
  columnId: string;
  title: string;
  conversationId?: string | null;
  contactId?: string | null;
  notes?: string;
  value?: number;
  dueAt?: Date | null;
};

export async function createCard(auth: AuthContext, input: CreateCardInput) {
  const db = await getDb();
  await requireOwnedBoard(auth, input.boardId);

  // Um card por conversa em cada quadro (índice único no banco reforça).
  if (input.conversationId) {
    const existing = await db
      .select({ id: kanbanCards.id })
      .from(kanbanCards)
      .where(
        and(
          eq(kanbanCards.boardId, input.boardId),
          eq(kanbanCards.conversationId, input.conversationId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw errors.conflict("Esta conversa já está neste quadro.");
    }
  }

  const [{ value: lastPosition } = { value: null }] = await db
    .select({ value: max(kanbanCards.position) })
    .from(kanbanCards)
    .where(eq(kanbanCards.columnId, input.columnId));

  const [card] = await db
    .insert(kanbanCards)
    .values({
      organizationId: auth.organizationId,
      boardId: input.boardId,
      columnId: input.columnId,
      conversationId: input.conversationId ?? null,
      contactId: input.contactId ?? null,
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      value: input.value ?? null,
      dueAt: input.dueAt ?? null,
      position: (lastPosition ?? -1) + 1,
    })
    .returning();

  return card;
}

export async function moveCard(
  auth: AuthContext,
  cardId: string,
  toColumnId: string,
  toPosition: number,
) {
  const db = await getDb();

  const [card] = await db
    .select()
    .from(kanbanCards)
    .where(
      and(eq(kanbanCards.id, cardId), eq(kanbanCards.organizationId, auth.organizationId)),
    )
    .limit(1);
  if (!card) throw errors.notFound("Card não encontrado.");
  await requireOwnedBoard(auth, card.boardId);

  const [column] = await db
    .select()
    .from(kanbanColumns)
    .where(
      and(eq(kanbanColumns.id, toColumnId), eq(kanbanColumns.boardId, card.boardId)),
    )
    .limit(1);
  if (!column) throw errors.notFound("Coluna de destino não encontrada.");

  // Abre espaço na posição de destino.
  await db
    .update(kanbanCards)
    .set({ position: sql`${kanbanCards.position} + 1` })
    .where(
      and(
        eq(kanbanCards.columnId, toColumnId),
        sql`${kanbanCards.position} >= ${toPosition}`,
      ),
    );

  const [moved] = await db
    .update(kanbanCards)
    .set({ columnId: toColumnId, position: toPosition, updatedAt: new Date() })
    .where(eq(kanbanCards.id, cardId))
    .returning();

  // Coluna pode aplicar automaticamente um status na conversa vinculada.
  if (column.appliesConversationStatus && card.conversationId) {
    await db
      .update(conversations)
      .set({
        status: column.appliesConversationStatus,
        updatedAt: new Date(),
        version: sql`${conversations.version} + 1`,
      })
      .where(
        and(
          eq(conversations.id, card.conversationId),
          eq(conversations.organizationId, auth.organizationId),
          sql`${conversations.status} <> 'closed'`,
        ),
      );

    await publish(auth.organizationId, {
      type: "conversation.updated",
      conversationId: card.conversationId,
    });
  }

  return moved;
}

export async function updateCard(
  auth: AuthContext,
  cardId: string,
  input: Partial<{ title: string; notes: string | null; value: number | null; dueAt: Date | null }>,
) {
  const db = await getDb();
  const [card] = await db
    .select({ boardId: kanbanCards.boardId })
    .from(kanbanCards)
    .where(
      and(eq(kanbanCards.id, cardId), eq(kanbanCards.organizationId, auth.organizationId)),
    )
    .limit(1);
  if (!card) throw errors.notFound("Card não encontrado.");
  await requireOwnedBoard(auth, card.boardId);

  const [updated] = await db
    .update(kanbanCards)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(kanbanCards.id, cardId))
    .returning();
  return updated;
}

export async function deleteCard(auth: AuthContext, cardId: string) {
  const db = await getDb();
  const [card] = await db
    .select({ boardId: kanbanCards.boardId })
    .from(kanbanCards)
    .where(
      and(eq(kanbanCards.id, cardId), eq(kanbanCards.organizationId, auth.organizationId)),
    )
    .limit(1);
  if (!card) throw errors.notFound("Card não encontrado.");
  await requireOwnedBoard(auth, card.boardId);
  await db.delete(kanbanCards).where(eq(kanbanCards.id, cardId));
}

async function requireOwnedBoard(auth: AuthContext, boardId: string) {
  const db = await getDb();
  const [board] = await db
    .select()
    .from(kanbanBoards)
    .where(
      and(
        eq(kanbanBoards.id, boardId),
        eq(kanbanBoards.organizationId, auth.organizationId),
      ),
    )
    .limit(1);

  if (!board) throw errors.notFound("Quadro não encontrado.");
  if (board.userId !== auth.userId) {
    throw errors.forbidden("Este quadro pertence a outro usuário.");
  }
  return board;
}

export { inArray };
