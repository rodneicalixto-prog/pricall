/**
 * Conversas: listagem com escopo por perfil, atribuição atômica,
 * transferência, mudança de status/prioridade, encerramento e reabertura.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { toRows } from "@/db/rows";
import {
  contacts,
  conversationEvents,
  conversationTags,
  conversations,
  messages,
  scheduledFollowups,
  tags,
  teamMembers,
  teams,
  users,
  whatsappConnections,
  type ConversationPriorityValue,
  type ConversationStatusValue,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { can, conversationScopeOf, requirePermission } from "@/lib/auth/rbac";
import { recordAudit, recordConversationEvent } from "@/lib/audit";
import { errors, systemMessages } from "@/lib/errors";
import { publish } from "@/lib/realtime/bus";
import { maskPhone, formatPhone } from "@/lib/phone";
import { notify } from "./notifications";
import { getOrganizationSettings } from "./organization";

/* ------------------------------------------------------------------ *
 * Escopo de visibilidade
 * ------------------------------------------------------------------ */

/**
 * Cláusula que restringe as conversas visíveis ao perfil do usuário.
 * Retorna sempre um filtro — nunca `undefined` — para não abrir a base
 * inteira por engano.
 */
export function visibilityFilter(auth: AuthContext): SQL {
  const scope = conversationScopeOf(auth);
  const sameOrg = eq(conversations.organizationId, auth.organizationId);

  if (scope.kind === "all") return sameOrg;

  if (scope.kind === "team") {
    const clauses: SQL[] = [eq(conversations.assignedUserId, scope.userId)];
    if (scope.teamIds.length > 0) {
      clauses.push(inArray(conversations.assignedTeamId, scope.teamIds));
      /**
       * Conversas atribuídas a alguém das equipes supervisionadas, mesmo sem
       * `assigned_team_id` preenchido — o campo só é gravado quando existe
       * regra por setor, e sem esta cláusula o supervisor perderia de vista
       * boa parte do que a equipe dele está atendendo.
       */
      const idsEquipes = sql.join(
        scope.teamIds.map((id) => sql`${id}`),
        sql`, `,
      );
      clauses.push(
        sql`exists (
          select 1 from ${teamMembers} tm
          where tm.user_id = ${conversations.assignedUserId}
            and tm.team_id in (${idsEquipes})
        )`,
      );
    }
    // Fila geral sem responsável e sem equipe também é visível ao supervisor.
    clauses.push(
      and(isNull(conversations.assignedUserId), isNull(conversations.assignedTeamId))!,
    );
    return and(sameOrg, or(...clauses)!)!;
  }

  // Vendedor: as próprias conversas + a fila disponível para ele.
  const clauses: SQL[] = [eq(conversations.assignedUserId, scope.userId)];
  clauses.push(
    and(isNull(conversations.assignedUserId), isNull(conversations.assignedTeamId))!,
  );
  if (scope.teamIds.length > 0) {
    clauses.push(
      and(
        isNull(conversations.assignedUserId),
        inArray(conversations.assignedTeamId, scope.teamIds),
      )!,
    );
  }
  return and(sameOrg, or(...clauses)!)!;
}

/** Verifica se o usuário pode ver/agir sobre uma conversa específica. */
export async function assertConversationAccess(
  auth: AuthContext,
  conversationId: string,
) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), visibilityFilter(auth)))
    .limit(1);
  const conversation = rows[0];
  if (!conversation) throw errors.notFound("Atendimento não encontrado.");
  return conversation;
}

/* ------------------------------------------------------------------ *
 * Listagem
 * ------------------------------------------------------------------ */

export type QueueFilter =
  | "all"
  | "unassigned"
  | "mine"
  | "waiting"
  | "in_progress"
  | "waiting_customer"
  | "closed"
  | "high_priority"
  | "unread"
  | "favorites";

export type ListConversationsInput = {
  queue?: QueueFilter;
  search?: string;
  assignedUserId?: string;
  teamId?: string;
  tagId?: string;
  connectionId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  /** Cursor de paginação: `lastMessageAt` do último item da página anterior. */
  cursor?: string;
};

export type ConversationListItem = {
  id: string;
  status: ConversationStatusValue;
  priority: ConversationPriorityValue;
  unreadCount: number;
  isFavorite: boolean;
  lastMessageAt: string;
  createdAt: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  contact: {
    id: string;
    name: string;
    phone: string;
    phoneMasked: boolean;
    profilePictureUrl: string | null;
  };
  lastMessage: { content: string; direction: string; senderType: string } | null;
  tags: { id: string; name: string; color: string }[];
  /** Minutos desde a última mensagem do cliente sem resposta. */
  stalledMinutes: number | null;
  isDemo: boolean;
};

const DEFAULT_PAGE_SIZE = 30;

export async function listConversations(
  auth: AuthContext,
  input: ListConversationsInput = {},
): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
  const db = await getDb();
  const settings = await getOrganizationSettings(auth.organizationId);
  const maskPhones = settings.maskPhoneForSellers === true && !can(auth, "contacts.view_full_phone");

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
  const filters: SQL[] = [visibilityFilter(auth)];

  switch (input.queue) {
    case "unassigned":
      filters.push(isNull(conversations.assignedUserId));
      filters.push(sql`${conversations.status} <> 'closed'`);
      break;
    case "mine":
      filters.push(eq(conversations.assignedUserId, auth.userId));
      filters.push(sql`${conversations.status} <> 'closed'`);
      break;
    case "waiting":
      filters.push(inArray(conversations.status, ["unassigned", "waiting"]));
      break;
    case "in_progress":
      filters.push(eq(conversations.status, "in_progress"));
      break;
    case "waiting_customer":
      filters.push(eq(conversations.status, "waiting_customer"));
      break;
    case "closed":
      filters.push(eq(conversations.status, "closed"));
      break;
    case "high_priority":
      filters.push(inArray(conversations.priority, ["high", "urgent"]));
      filters.push(sql`${conversations.status} <> 'closed'`);
      break;
    case "unread":
      filters.push(sql`${conversations.unreadCount} > 0`);
      break;
    case "favorites":
      filters.push(eq(conversations.isFavorite, true));
      break;
    case "all":
    default:
      filters.push(sql`${conversations.status} <> 'closed'`);
      break;
  }

  if (input.assignedUserId) {
    filters.push(eq(conversations.assignedUserId, input.assignedUserId));
  }
  if (input.teamId) filters.push(eq(conversations.assignedTeamId, input.teamId));
  if (input.connectionId) {
    filters.push(eq(conversations.whatsappConnectionId, input.connectionId));
  }
  if (input.from) filters.push(gte(conversations.lastMessageAt, input.from));
  if (input.to) filters.push(lte(conversations.lastMessageAt, input.to));
  if (input.cursor) {
    const cursorDate = new Date(input.cursor);
    if (!Number.isNaN(cursorDate.getTime())) {
      filters.push(sql`${conversations.lastMessageAt} < ${cursorDate}`);
    }
  }

  if (input.search && input.search.trim().length > 0) {
    const term = `%${input.search.trim().toLowerCase()}%`;
    const digits = input.search.replace(/\D/g, "");
    const searchClauses: SQL[] = [sql`lower(${contacts.name}) like ${term}`];
    if (digits.length >= 3) {
      searchClauses.push(sql`${contacts.phone} like ${`%${digits}%`}`);
    }
    filters.push(or(...searchClauses)!);
  }

  if (input.tagId) {
    filters.push(
      sql`exists (select 1 from ${conversationTags} ct where ct.conversation_id = ${conversations.id} and ct.tag_id = ${input.tagId})`,
    );
  }

  const rows = await db
    .select({
      conversation: conversations,
      contact: {
        id: contacts.id,
        name: contacts.name,
        phone: contacts.phone,
        profilePictureUrl: contacts.profilePictureUrl,
      },
      assignedUserName: users.name,
      assignedTeamName: teams.name,
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .leftJoin(teams, eq(teams.id, conversations.assignedTeamId))
    .where(and(...filters))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit ? page.at(-1)!.conversation.lastMessageAt.toISOString() : null;

  const conversationIds = page.map((r) => r.conversation.id);
  const [lastMessages, tagsByConversation] = await Promise.all([
    loadLastMessages(conversationIds),
    loadTags(conversationIds),
  ]);

  const now = Date.now();
  const items: ConversationListItem[] = page.map((row) => {
    const c = row.conversation;
    const awaitingReply =
      c.lastInboundAt != null &&
      (c.lastOutboundAt == null || c.lastOutboundAt < c.lastInboundAt) &&
      c.status !== "closed";

    return {
      id: c.id,
      status: c.status,
      priority: c.priority,
      unreadCount: c.unreadCount,
      isFavorite: c.isFavorite,
      lastMessageAt: c.lastMessageAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
      assignedUserId: c.assignedUserId,
      assignedUserName: row.assignedUserName,
      assignedTeamId: c.assignedTeamId,
      assignedTeamName: row.assignedTeamName,
      contact: {
        id: row.contact.id,
        name: row.contact.name,
        phone: maskPhones
          ? maskPhone(row.contact.phone)
          : formatPhone(row.contact.phone),
        phoneMasked: maskPhones,
        profilePictureUrl: row.contact.profilePictureUrl,
      },
      lastMessage: lastMessages.get(c.id) ?? null,
      tags: tagsByConversation.get(c.id) ?? [],
      stalledMinutes: awaitingReply
        ? Math.floor((now - c.lastInboundAt!.getTime()) / 60_000)
        : null,
      isDemo: c.isDemo,
    };
  });

  return { items, nextCursor };
}

async function loadLastMessages(conversationIds: string[]) {
  const map = new Map<
    string,
    { content: string; direction: string; senderType: string }
  >();
  if (conversationIds.length === 0) return map;

  const db = await getDb();
  // DISTINCT ON evita N+1: uma única consulta traz a última mensagem de cada
  // conversa. Os ids vão parametrizados via sql.join, não interpolados.
  const idList = sql.join(
    conversationIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await db.execute(sql`
    select distinct on (conversation_id)
      conversation_id, content, direction, sender_type, message_type
    from ${messages}
    where conversation_id in (${idList})
    order by conversation_id, created_at desc
  `);

  type Row = {
    conversation_id: string;
    content: string | null;
    direction: string;
    sender_type: string;
    message_type: string;
  };
  for (const row of toRows<Row>(result)) {
    map.set(row.conversation_id, {
      content: row.content ?? describeMediaType(row.message_type),
      direction: row.direction,
      senderType: row.sender_type,
    });
  }
  return map;
}

function describeMediaType(messageType: string): string {
  const labels: Record<string, string> = {
    image: "📷 Imagem",
    audio: "🎤 Áudio",
    video: "🎬 Vídeo",
    document: "📄 Documento",
    location: "📍 Localização",
    template: "Mensagem de modelo",
    system: "Evento do sistema",
  };
  return labels[messageType] ?? "Mensagem";
}

async function loadTags(conversationIds: string[]) {
  const map = new Map<string, { id: string; name: string; color: string }[]>();
  if (conversationIds.length === 0) return map;

  const db = await getDb();
  const rows = await db
    .select({
      conversationId: conversationTags.conversationId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    })
    .from(conversationTags)
    .innerJoin(tags, eq(tags.id, conversationTags.tagId))
    .where(inArray(conversationTags.conversationId, conversationIds));

  for (const row of rows) {
    const list = map.get(row.conversationId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    map.set(row.conversationId, list);
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * Detalhe
 * ------------------------------------------------------------------ */

export async function getConversationDetail(
  auth: AuthContext,
  conversationId: string,
) {
  const db = await getDb();
  const conversation = await assertConversationAccess(auth, conversationId);
  const settings = await getOrganizationSettings(auth.organizationId);
  const maskPhones =
    settings.maskPhoneForSellers === true && !can(auth, "contacts.view_full_phone");

  const [contactRow] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, conversation.contactId))
    .limit(1);

  const [assignedUser] = conversation.assignedUserId
    ? await db
        .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, conversation.assignedUserId))
        .limit(1)
    : [null];

  const [connection] = conversation.whatsappConnectionId
    ? await db
        .select({
          id: whatsappConnections.id,
          label: whatsappConnections.label,
          displayPhoneNumber: whatsappConnections.displayPhoneNumber,
          provider: whatsappConnections.provider,
          extension: whatsappConnections.extension,
          isDemo: whatsappConnections.isDemo,
        })
        .from(whatsappConnections)
        .where(eq(whatsappConnections.id, conversation.whatsappConnectionId))
        .limit(1)
    : [null];

  const conversationTagList = (await loadTags([conversationId])).get(conversationId) ?? [];

  const events = await db
    .select({
      id: conversationEvents.id,
      eventType: conversationEvents.eventType,
      actorUserId: conversationEvents.actorUserId,
      actorName: users.name,
      previousValue: conversationEvents.previousValue,
      newValue: conversationEvents.newValue,
      metadata: conversationEvents.metadata,
      createdAt: conversationEvents.createdAt,
    })
    .from(conversationEvents)
    .leftJoin(users, eq(users.id, conversationEvents.actorUserId))
    .where(eq(conversationEvents.conversationId, conversationId))
    .orderBy(desc(conversationEvents.createdAt))
    .limit(50);

  const followups = await db
    .select()
    .from(scheduledFollowups)
    .where(eq(scheduledFollowups.conversationId, conversationId))
    .orderBy(asc(scheduledFollowups.scheduledAt));

  return {
    conversation: {
      ...conversation,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
      assignedAt: conversation.assignedAt?.toISOString() ?? null,
      firstResponseAt: conversation.firstResponseAt?.toISOString() ?? null,
      closedAt: conversation.closedAt?.toISOString() ?? null,
      lastInboundAt: conversation.lastInboundAt?.toISOString() ?? null,
      lastOutboundAt: conversation.lastOutboundAt?.toISOString() ?? null,
    },
    contact: contactRow
      ? {
          ...contactRow,
          phone: maskPhones ? maskPhone(contactRow.phone) : formatPhone(contactRow.phone),
          phoneMasked: maskPhones,
          firstContactAt: contactRow.firstContactAt.toISOString(),
          lastContactAt: contactRow.lastContactAt.toISOString(),
        }
      : null,
    assignedUser: assignedUser ?? null,
    connection: connection ?? null,
    tags: conversationTagList,
    events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    followups: followups.map((f) => ({
      ...f,
      scheduledAt: f.scheduledAt.toISOString(),
      createdAt: f.createdAt.toISOString(),
      completedAt: f.completedAt?.toISOString() ?? null,
    })),
    permissions: {
      canTransfer: can(auth, "conversations.transfer"),
      canClose: can(auth, "conversations.close"),
      canAssignOthers: can(auth, "conversations.assign_others"),
      canBlockContact: can(auth, "contacts.block"),
      canSeeFullPhone: !maskPhones,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Assumir atendimento (operação atômica)
 * ------------------------------------------------------------------ */

/**
 * Fluxo 2 do escopo: o vendedor assume a conversa.
 *
 * A atribuição é feita em um único UPDATE condicional
 * (`where assigned_user_id is null`). Se dois vendedores clicarem ao mesmo
 * tempo, apenas um UPDATE afeta linha — o outro recebe erro de conflito.
 */
export async function claimConversation(
  auth: AuthContext,
  conversationId: string,
) {
  const db = await getDb();

  /**
   * A verificação de existência é feita no escopo da organização, não no de
   * visibilidade: assim que outro vendedor assume, a conversa sai da fila
   * deste usuário e `assertConversationAccess` responderia "não encontrado" —
   * mensagem confusa para quem acabou de clicar em "Assumir". Aqui a mesma
   * situação devolve a mensagem correta de conflito.
   */
  const [existente] = await db
    .select({
      id: conversations.id,
      assignedUserId: conversations.assignedUserId,
      status: conversations.status,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, auth.organizationId),
      ),
    )
    .limit(1);

  if (!existente) throw errors.notFound("Atendimento não encontrado.");

  if (existente.assignedUserId === auth.userId) return { alreadyMine: true };
  if (existente.assignedUserId) {
    throw errors.conflict(systemMessages.conversationAlreadyTaken, {
      conversationId,
    });
  }

  // Sem responsável ainda: confirma que a fila é visível para este usuário.
  await assertConversationAccess(auth, conversationId);
  const now = new Date();

  const updated = await db
    .update(conversations)
    .set({
      assignedUserId: auth.userId,
      status: "in_progress",
      assignedAt: now,
      updatedAt: now,
      version: sql`${conversations.version} + 1`,
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, auth.organizationId),
        isNull(conversations.assignedUserId),
      ),
    )
    .returning();

  if (updated.length === 0) {
    // Ou já foi assumida, ou não existe mais no escopo do usuário.
    const [current] = await db
      .select({ assignedUserId: conversations.assignedUserId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (current?.assignedUserId === auth.userId) return { alreadyMine: true };
    throw errors.conflict(systemMessages.conversationAlreadyTaken, {
      conversationId,
    });
  }

  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId,
    eventType: "assigned",
    actorUserId: auth.userId,
    newValue: { assignedUserId: auth.userId, status: "in_progress" },
    metadata: { origem: "assumido pelo próprio vendedor" },
  });

  await publish(auth.organizationId, {
    type: "conversation.assigned",
    conversationId,
    userId: auth.userId,
  });

  return { alreadyMine: false, conversation: updated[0] };
}

/* ------------------------------------------------------------------ *
 * Transferência
 * ------------------------------------------------------------------ */

export type TransferInput = {
  conversationId: string;
  toUserId?: string | null;
  toTeamId?: string | null;
  reason?: string;
};

export async function transferConversation(
  auth: AuthContext,
  input: TransferInput,
) {
  requirePermission(auth, "conversations.transfer");
  const db = await getDb();
  const conversation = await assertConversationAccess(auth, input.conversationId);

  if (!input.toUserId && !input.toTeamId) {
    throw errors.validation("Escolha um vendedor ou uma equipe de destino.");
  }

  // Vendedor só transfere a conversa que é dele.
  if (
    !can(auth, "conversations.assign_others") &&
    conversation.assignedUserId !== auth.userId
  ) {
    throw errors.forbidden(
      "Você só pode transferir atendimentos sob sua responsabilidade.",
    );
  }

  if (input.toUserId) {
    const [target] = await db
      .select({ id: users.id, name: users.name, isActive: users.isActive })
      .from(users)
      .where(
        and(
          eq(users.id, input.toUserId),
          eq(users.organizationId, auth.organizationId),
        ),
      )
      .limit(1);
    if (!target) throw errors.notFound("Vendedor de destino não encontrado.");
    if (!target.isActive) {
      throw errors.validation("O vendedor de destino está desativado.");
    }
  }

  if (input.toTeamId) {
    const [team] = await db
      .select({ id: teams.id, isActive: teams.isActive })
      .from(teams)
      .where(
        and(
          eq(teams.id, input.toTeamId),
          eq(teams.organizationId, auth.organizationId),
        ),
      )
      .limit(1);
    if (!team) throw errors.notFound("Equipe de destino não encontrada.");
  }

  const now = new Date();
  // Update condicional por versão: bloqueia transferências simultâneas.
  const updated = await db
    .update(conversations)
    .set({
      assignedUserId: input.toUserId ?? null,
      assignedTeamId: input.toTeamId ?? conversation.assignedTeamId,
      status: input.toUserId ? "in_progress" : "unassigned",
      assignedAt: input.toUserId ? now : null,
      updatedAt: now,
      version: sql`${conversations.version} + 1`,
    })
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.version, conversation.version),
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw errors.conflict(
      "O atendimento foi alterado por outra pessoa. Recarregue e tente novamente.",
    );
  }

  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId: input.conversationId,
    eventType: "transferred",
    actorUserId: auth.userId,
    previousValue: {
      assignedUserId: conversation.assignedUserId,
      assignedTeamId: conversation.assignedTeamId,
    },
    newValue: {
      assignedUserId: input.toUserId ?? null,
      assignedTeamId: input.toTeamId ?? conversation.assignedTeamId,
    },
    metadata: { motivo: input.reason ?? null },
  });

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "conversation.transferred",
    entityType: "conversation",
    entityId: input.conversationId,
    metadata: { paraUsuario: input.toUserId, paraEquipe: input.toTeamId },
  });

  if (input.toUserId) {
    await notify({
      organizationId: auth.organizationId,
      userId: input.toUserId,
      type: "transfer_received",
      title: "Atendimento transferido para você",
      body: input.reason
        ? `${auth.name} transferiu um atendimento. Motivo: ${input.reason}`
        : `${auth.name} transferiu um atendimento para você.`,
      conversationId: input.conversationId,
    });
  }

  await publish(auth.organizationId, {
    type: "conversation.assigned",
    conversationId: input.conversationId,
    userId: input.toUserId ?? null,
  });

  return updated[0];
}

/* ------------------------------------------------------------------ *
 * Atribuição por supervisor/administrador
 * ------------------------------------------------------------------ */

export async function assignConversation(
  auth: AuthContext,
  conversationId: string,
  userId: string | null,
) {
  requirePermission(auth, "conversations.assign_others");
  return transferConversation(auth, { conversationId, toUserId: userId });
}

/* ------------------------------------------------------------------ *
 * Status, prioridade, favorito, leitura
 * ------------------------------------------------------------------ */

const ALLOWED_TRANSITIONS: Record<ConversationStatusValue, ConversationStatusValue[]> = {
  unassigned: ["waiting", "in_progress", "closed"],
  waiting: ["in_progress", "unassigned", "closed"],
  in_progress: ["waiting_customer", "scheduled", "closed", "waiting"],
  waiting_customer: ["in_progress", "scheduled", "closed"],
  scheduled: ["in_progress", "waiting_customer", "closed"],
  closed: ["in_progress"],
};

export function canTransition(
  from: ConversationStatusValue,
  to: ConversationStatusValue,
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export async function updateStatus(
  auth: AuthContext,
  conversationId: string,
  status: ConversationStatusValue,
) {
  const db = await getDb();
  const conversation = await assertConversationAccess(auth, conversationId);

  if (!canTransition(conversation.status, status)) {
    throw errors.validation(
      `Não é possível mudar de "${conversation.status}" para "${status}".`,
    );
  }
  if (status === "closed") {
    throw errors.validation(
      "Use a ação de finalizar atendimento para encerrar a conversa.",
    );
  }

  const [updated] = await db
    .update(conversations)
    .set({
      status,
      updatedAt: new Date(),
      version: sql`${conversations.version} + 1`,
      // Reabrir limpa os dados de encerramento.
      ...(conversation.status === "closed"
        ? { closedAt: null, closedBy: null, closingReason: null, outcome: null }
        : {}),
    })
    .where(eq(conversations.id, conversationId))
    .returning();

  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId,
    eventType: conversation.status === "closed" ? "reopened" : "status_changed",
    actorUserId: auth.userId,
    previousValue: { status: conversation.status },
    newValue: { status },
  });

  await publish(auth.organizationId, { type: "conversation.updated", conversationId });
  return updated;
}

export async function updatePriority(
  auth: AuthContext,
  conversationId: string,
  priority: ConversationPriorityValue,
) {
  const db = await getDb();
  const conversation = await assertConversationAccess(auth, conversationId);

  const [updated] = await db
    .update(conversations)
    .set({ priority, updatedAt: new Date(), version: sql`${conversations.version} + 1` })
    .where(eq(conversations.id, conversationId))
    .returning();

  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId,
    eventType: "priority_changed",
    actorUserId: auth.userId,
    previousValue: { priority: conversation.priority },
    newValue: { priority },
  });

  if (priority === "urgent" || priority === "high") {
    const supervisors = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, auth.organizationId),
          inArray(users.role, ["admin", "supervisor"]),
          eq(users.isActive, true),
        ),
      );
    for (const supervisor of supervisors) {
      if (supervisor.id === auth.userId) continue;
      await notify({
        organizationId: auth.organizationId,
        userId: supervisor.id,
        type: "urgent_conversation",
        title: "Atendimento marcado como prioritário",
        body: `${auth.name} elevou a prioridade de um atendimento para ${priority === "urgent" ? "urgente" : "alta"}.`,
        conversationId,
      });
    }
  }

  await publish(auth.organizationId, { type: "conversation.updated", conversationId });
  return updated;
}

export async function toggleFavorite(auth: AuthContext, conversationId: string) {
  const db = await getDb();
  const conversation = await assertConversationAccess(auth, conversationId);
  const [updated] = await db
    .update(conversations)
    .set({ isFavorite: !conversation.isFavorite, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId))
    .returning();
  await publish(auth.organizationId, { type: "conversation.updated", conversationId });
  return updated;
}

export async function markAsRead(auth: AuthContext, conversationId: string) {
  const db = await getDb();
  await assertConversationAccess(auth, conversationId);
  await db
    .update(conversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
  await publish(auth.organizationId, { type: "conversation.updated", conversationId });
}

/* ------------------------------------------------------------------ *
 * Encerramento e reabertura
 * ------------------------------------------------------------------ */

export const CLOSING_OUTCOMES = [
  "Cliente atendido",
  "Venda encaminhada",
  "Cliente pediu retorno",
  "Sem interesse",
  "Número incorreto",
  "Spam",
  "Outro",
] as const;

export type CloseInput = {
  conversationId: string;
  reason: string;
  outcome: string;
  note?: string;
  followupAt?: Date | null;
  followupNote?: string;
};

export async function closeConversation(auth: AuthContext, input: CloseInput) {
  requirePermission(auth, "conversations.close");
  const db = await getDb();
  const conversation = await assertConversationAccess(auth, input.conversationId);

  if (conversation.status === "closed") {
    throw errors.validation("Este atendimento já está encerrado.");
  }
  if (!input.reason.trim()) {
    throw errors.validation("Informe o motivo do encerramento.");
  }
  if (!input.outcome.trim()) {
    throw errors.validation("Informe o resultado do contato.");
  }

  const now = new Date();
  const [updated] = await db
    .update(conversations)
    .set({
      status: "closed",
      closedAt: now,
      closedBy: auth.userId,
      closingReason: input.reason.trim(),
      outcome: input.outcome.trim(),
      closingNote: input.note?.trim() || null,
      unreadCount: 0,
      updatedAt: now,
      version: sql`${conversations.version} + 1`,
    })
    .where(eq(conversations.id, input.conversationId))
    .returning();

  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId: input.conversationId,
    eventType: "closed",
    actorUserId: auth.userId,
    previousValue: { status: conversation.status },
    newValue: {
      status: "closed",
      motivo: input.reason,
      resultado: input.outcome,
    },
    metadata: { observacao: input.note ?? null },
  });

  let followup = null;
  if (input.followupAt) {
    if (input.followupAt.getTime() < Date.now()) {
      throw errors.validation("A data do retorno precisa estar no futuro.");
    }
    [followup] = await db
      .insert(scheduledFollowups)
      .values({
        organizationId: auth.organizationId,
        conversationId: input.conversationId,
        assignedUserId: conversation.assignedUserId ?? auth.userId,
        scheduledAt: input.followupAt,
        note: input.followupNote?.trim() || `Retorno de ${input.outcome}`,
        status: "pending",
        createdBy: auth.userId,
      })
      .returning();

    await recordConversationEvent({
      organizationId: auth.organizationId,
      conversationId: input.conversationId,
      eventType: "followup_scheduled",
      actorUserId: auth.userId,
      newValue: { agendadoPara: input.followupAt.toISOString() },
    });
  }

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "conversation.closed",
    entityType: "conversation",
    entityId: input.conversationId,
    metadata: { motivo: input.reason, resultado: input.outcome },
  });

  await publish(auth.organizationId, {
    type: "conversation.closed",
    conversationId: input.conversationId,
  });

  return { conversation: updated, followup };
}

/** Reabre uma conversa encerrada (ação manual ou nova mensagem do cliente). */
export async function reopenConversation(
  organizationId: string,
  conversationId: string,
  actorUserId: string | null,
  reason: string,
) {
  const db = await getDb();
  const [updated] = await db
    .update(conversations)
    .set({
      status: "in_progress",
      closedAt: null,
      closedBy: null,
      updatedAt: new Date(),
      version: sql`${conversations.version} + 1`,
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, organizationId),
      ),
    )
    .returning();

  await recordConversationEvent({
    organizationId,
    conversationId,
    eventType: "reopened",
    actorUserId,
    newValue: { status: "in_progress" },
    metadata: { motivo: reason },
  });

  await publish(organizationId, { type: "conversation.updated", conversationId });
  return updated;
}

/* ------------------------------------------------------------------ *
 * Marcadores da conversa
 * ------------------------------------------------------------------ */

export async function addTag(auth: AuthContext, conversationId: string, tagId: string) {
  const db = await getDb();
  await assertConversationAccess(auth, conversationId);

  const [tag] = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.organizationId, auth.organizationId)))
    .limit(1);
  if (!tag) throw errors.notFound("Marcador não encontrado.");

  await db
    .insert(conversationTags)
    .values({ organizationId: auth.organizationId, conversationId, tagId })
    .onConflictDoNothing();

  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId,
    eventType: "tag_added",
    actorUserId: auth.userId,
    newValue: { marcador: tag.name },
  });

  await publish(auth.organizationId, { type: "conversation.updated", conversationId });
}

export async function removeTag(
  auth: AuthContext,
  conversationId: string,
  tagId: string,
) {
  const db = await getDb();
  await assertConversationAccess(auth, conversationId);

  await db
    .delete(conversationTags)
    .where(
      and(
        eq(conversationTags.conversationId, conversationId),
        eq(conversationTags.tagId, tagId),
        eq(conversationTags.organizationId, auth.organizationId),
      ),
    );

  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId,
    eventType: "tag_removed",
    actorUserId: auth.userId,
    previousValue: { tagId },
  });

  await publish(auth.organizationId, { type: "conversation.updated", conversationId });
}
