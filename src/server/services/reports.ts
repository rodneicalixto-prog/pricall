/**
 * Relatórios e métricas do painel.
 * Todo cálculo é filtrado por organização e, quando o perfil exige, por
 * equipe ou pelo próprio usuário.
 */
import { and, avg, count, eq, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { toRows } from "@/db/rows";
import {
  conversationEvents,
  conversations,
  messages,
  teams,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { can, conversationScopeOf } from "@/lib/auth/rbac";
import { errors } from "@/lib/errors";
import { getOrganizationSettings } from "./organization";

export type ReportFilters = {
  from?: Date;
  to?: Date;
  userId?: string;
  teamId?: string;
};

/** Filtro de relatório que já respeita o perfil de quem consulta. */
function scopedFilters(auth: AuthContext, filters: ReportFilters): SQL[] {
  const clauses: SQL[] = [eq(conversations.organizationId, auth.organizationId)];
  const scope = conversationScopeOf(auth);

  if (scope.kind === "own") {
    clauses.push(eq(conversations.assignedUserId, auth.userId));
  } else if (scope.kind === "team" && scope.teamIds.length > 0) {
    clauses.push(
      sql`(${conversations.assignedTeamId} in ${scope.teamIds} or ${conversations.assignedUserId} = ${auth.userId})`,
    );
  }

  if (filters.from) clauses.push(gte(conversations.createdAt, filters.from));
  if (filters.to) clauses.push(lte(conversations.createdAt, filters.to));
  if (filters.userId) {
    if (!can(auth, "reports.view_team") && filters.userId !== auth.userId) {
      throw errors.forbidden("Você só pode consultar os próprios resultados.");
    }
    clauses.push(eq(conversations.assignedUserId, filters.userId));
  }
  if (filters.teamId) clauses.push(eq(conversations.assignedTeamId, filters.teamId));

  return clauses;
}

/* ------------------------------------------------------------------ *
 * Painel principal
 * ------------------------------------------------------------------ */

export async function getDashboard(auth: AuthContext) {
  const db = await getDb();
  const settings = await getOrganizationSettings(auth.organizationId);
  const staleMinutes = settings.slaStaleConversationMinutes ?? 30;

  const base = scopedFilters(auth, {});
  const startToday = startOfDay(new Date());

  const [counters] = await db
    .select({
      waiting: sql<number>`count(*) filter (where ${conversations.status} in ('unassigned','waiting'))::int`,
      inProgress: sql<number>`count(*) filter (where ${conversations.status} = 'in_progress')::int`,
      waitingCustomer: sql<number>`count(*) filter (where ${conversations.status} = 'waiting_customer')::int`,
      unanswered: sql<number>`count(*) filter (
        where ${conversations.status} <> 'closed'
          and ${conversations.lastInboundAt} is not null
          and (${conversations.lastOutboundAt} is null or ${conversations.lastOutboundAt} < ${conversations.lastInboundAt})
      )::int`,
      closedToday: sql<number>`count(*) filter (where ${conversations.status} = 'closed' and ${conversations.closedAt} >= ${startToday})::int`,
      unassigned: sql<number>`count(*) filter (where ${conversations.assignedUserId} is null and ${conversations.status} <> 'closed')::int`,
    })
    .from(conversations)
    .where(and(...base));

  const [averages] = await db
    .select({
      firstResponse: avg(
        sql<number>`extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt}))`,
      ),
      handleTime: avg(
        sql<number>`extract(epoch from (${conversations.closedAt} - ${conversations.createdAt}))`,
      ),
    })
    .from(conversations)
    .where(and(...base, gte(conversations.createdAt, daysAgo(30))));

  // Conta apenas quem participa do atendimento — o administrador fica de fora
  // da fila, então não deve entrar no indicador de "vendedores online".
  const onlineSellers = Number(
    await db.$count(
      users,
      and(
        eq(users.organizationId, auth.organizationId),
        eq(users.isActive, true),
        eq(users.availabilityStatus, "online"),
        inArray(users.role, ["seller", "supervisor"]),
      ),
    ),
  );

  const perSeller = await db
    .select({
      userId: conversations.assignedUserId,
      userName: users.name,
      total: count(),
    })
    .from(conversations)
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .where(
      and(
        ...base,
        isNotNull(conversations.assignedUserId),
        sql`${conversations.status} <> 'closed'`,
      ),
    )
    .groupBy(conversations.assignedUserId, users.name)
    .orderBy(sql`count(*) desc`)
    .limit(12);

  const sevenDays = await dailySeries(auth, 7);

  const staleCutoff = new Date(Date.now() - staleMinutes * 60_000);
  const stalled = await db
    .select({
      id: conversations.id,
      contactName: sql<string>`(select name from contacts c where c.id = ${conversations.contactId})`,
      assignedUserName: users.name,
      minutes: sql<number>`floor(extract(epoch from (now() - ${conversations.lastInboundAt})) / 60)::int`,
      priority: conversations.priority,
    })
    .from(conversations)
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .where(
      and(
        ...base,
        sql`${conversations.status} <> 'closed'`,
        isNotNull(conversations.lastInboundAt),
        lte(conversations.lastInboundAt, staleCutoff),
        sql`(${conversations.lastOutboundAt} is null or ${conversations.lastOutboundAt} < ${conversations.lastInboundAt})`,
      ),
    )
    .orderBy(conversations.lastInboundAt)
    .limit(10);

  return {
    counters: {
      waiting: Number(counters?.waiting ?? 0),
      inProgress: Number(counters?.inProgress ?? 0),
      waitingCustomer: Number(counters?.waitingCustomer ?? 0),
      unanswered: Number(counters?.unanswered ?? 0),
      closedToday: Number(counters?.closedToday ?? 0),
      unassigned: Number(counters?.unassigned ?? 0),
      onlineSellers,
    },
    averages: {
      firstResponseSeconds: averages?.firstResponse
        ? Math.round(Number(averages.firstResponse))
        : null,
      handleTimeSeconds: averages?.handleTime
        ? Math.round(Number(averages.handleTime))
        : null,
    },
    perSeller: perSeller.map((r) => ({
      userId: r.userId,
      userName: r.userName ?? "Sem responsável",
      total: Number(r.total),
    })),
    lastSevenDays: sevenDays,
    stalled: stalled.map((s) => ({ ...s, minutes: Number(s.minutes) })),
    slaStaleMinutes: staleMinutes,
  };
}

/** Série diária de recebidos x finalizados. */
export async function dailySeries(auth: AuthContext, days: number) {
  const db = await getDb();
  const base = scopedFilters(auth, { from: daysAgo(days) });

  const result = await db.execute(sql`
    with dias as (
      select generate_series(
        (current_date - ${sql.raw(String(days - 1))} * interval '1 day')::date,
        current_date,
        interval '1 day'
      )::date as dia
    ),
    recebidas as (
      select date(created_at) as dia, count(*)::int as total
      from ${conversations}
      where ${and(...base)}
      group by 1
    ),
    finalizadas as (
      select date(closed_at) as dia, count(*)::int as total
      from ${conversations}
      where ${and(...base)} and closed_at is not null
      group by 1
    )
    select
      to_char(d.dia, 'YYYY-MM-DD') as dia,
      coalesce(r.total, 0) as recebidas,
      coalesce(f.total, 0) as finalizadas
    from dias d
    left join recebidas r on r.dia = d.dia
    left join finalizadas f on f.dia = d.dia
    order by d.dia
  `);

  return toRows<{ dia: string; recebidas: number; finalizadas: number }>(result).map(
    (row) => ({
      date: row.dia,
      received: Number(row.recebidas),
      closed: Number(row.finalizadas),
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Relatório completo
 * ------------------------------------------------------------------ */

export async function getFullReport(auth: AuthContext, filters: ReportFilters) {
  if (!can(auth, "reports.view_own")) throw errors.forbidden();
  const db = await getDb();
  const base = scopedFilters(auth, filters);

  const [totals] = await db
    .select({
      received: count(),
      closed: sql<number>`count(*) filter (where ${conversations.status} = 'closed')::int`,
      unanswered: sql<number>`count(*) filter (where ${conversations.firstResponseAt} is null and ${conversations.status} <> 'closed')::int`,
      uniqueContacts: sql<number>`count(distinct ${conversations.contactId})::int`,
      firstResponseAvg: avg(
        sql<number>`extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt}))`,
      ),
      closeTimeAvg: avg(
        sql<number>`extract(epoch from (${conversations.closedAt} - ${conversations.createdAt}))`,
      ),
    })
    .from(conversations)
    .where(and(...base));

  const bySeller = await db
    .select({
      userId: conversations.assignedUserId,
      userName: users.name,
      total: count(),
      closed: sql<number>`count(*) filter (where ${conversations.status} = 'closed')::int`,
      firstResponseAvg: avg(
        sql<number>`extract(epoch from (${conversations.firstResponseAt} - ${conversations.createdAt}))`,
      ),
    })
    .from(conversations)
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .where(and(...base))
    .groupBy(conversations.assignedUserId, users.name)
    .orderBy(sql`count(*) desc`);

  const byTeam = await db
    .select({
      teamId: conversations.assignedTeamId,
      teamName: teams.name,
      total: count(),
      closed: sql<number>`count(*) filter (where ${conversations.status} = 'closed')::int`,
    })
    .from(conversations)
    .leftJoin(teams, eq(teams.id, conversations.assignedTeamId))
    .where(and(...base))
    .groupBy(conversations.assignedTeamId, teams.name)
    .orderBy(sql`count(*) desc`);

  const byHourResult = await db.execute(sql`
    select extract(hour from created_at)::int as hora, count(*)::int as total
    from ${conversations}
    where ${and(...base)}
    group by 1
    order by 1
  `);

  const byOutcome = await db
    .select({
      outcome: conversations.outcome,
      reason: conversations.closingReason,
      total: count(),
    })
    .from(conversations)
    .where(and(...base, eq(conversations.status, "closed")))
    .groupBy(conversations.outcome, conversations.closingReason)
    .orderBy(sql`count(*) desc`);

  const transfers = Number(
    await db.$count(
      conversationEvents,
      and(
        eq(conversationEvents.organizationId, auth.organizationId),
        eq(conversationEvents.eventType, "transferred"),
        filters.from ? gte(conversationEvents.createdAt, filters.from) : undefined,
        filters.to ? lte(conversationEvents.createdAt, filters.to) : undefined,
      ),
    ),
  );

  const received = Number(totals?.received ?? 0);

  return {
    period: {
      from: filters.from?.toISOString() ?? null,
      to: filters.to?.toISOString() ?? null,
    },
    totals: {
      received,
      closed: Number(totals?.closed ?? 0),
      unanswered: Number(totals?.unanswered ?? 0),
      uniqueContacts: Number(totals?.uniqueContacts ?? 0),
      transfers,
      transferRate: received > 0 ? Number((transfers / received).toFixed(3)) : 0,
      averageFirstResponseSeconds: totals?.firstResponseAvg
        ? Math.round(Number(totals.firstResponseAvg))
        : null,
      averageCloseTimeSeconds: totals?.closeTimeAvg
        ? Math.round(Number(totals.closeTimeAvg))
        : null,
    },
    bySeller: bySeller.map((r) => ({
      userId: r.userId,
      userName: r.userName ?? "Sem responsável",
      total: Number(r.total),
      closed: Number(r.closed),
      averageFirstResponseSeconds: r.firstResponseAvg
        ? Math.round(Number(r.firstResponseAvg))
        : null,
    })),
    byTeam: byTeam.map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName ?? "Sem equipe",
      total: Number(r.total),
      closed: Number(r.closed),
    })),
    byHour: toRows<{ hora: number; total: number }>(byHourResult).map((r) => ({
      hour: Number(r.hora),
      total: Number(r.total),
    })),
    byOutcome: byOutcome.map((r) => ({
      outcome: r.outcome ?? "Não informado",
      reason: r.reason ?? "Não informado",
      total: Number(r.total),
    })),
    daily: await dailySeriesForFilters(auth, filters),
  };
}

async function dailySeriesForFilters(auth: AuthContext, filters: ReportFilters) {
  const db = await getDb();
  const base = scopedFilters(auth, filters);
  const result = await db.execute(sql`
    select to_char(date(created_at), 'YYYY-MM-DD') as dia, count(*)::int as total
    from ${conversations}
    where ${and(...base)}
    group by 1
    order by 1
  `);
  return toRows<{ dia: string; total: number }>(result).map((r) => ({
    date: r.dia,
    total: Number(r.total),
  }));
}

/* ------------------------------------------------------------------ *
 * Exportação CSV
 * ------------------------------------------------------------------ */

export async function exportConversationsCsv(
  auth: AuthContext,
  filters: ReportFilters,
): Promise<string> {
  if (!can(auth, "reports.export")) throw errors.forbidden();
  const db = await getDb();
  const base = scopedFilters(auth, filters);

  const rows = await db
    .select({
      id: conversations.id,
      criadoEm: conversations.createdAt,
      status: conversations.status,
      prioridade: conversations.priority,
      contato: sql<string>`(select name from contacts c where c.id = ${conversations.contactId})`,
      telefone: sql<string>`(select phone from contacts c where c.id = ${conversations.contactId})`,
      vendedor: users.name,
      equipe: teams.name,
      primeiraRespostaEm: conversations.firstResponseAt,
      encerradoEm: conversations.closedAt,
      motivo: conversations.closingReason,
      resultado: conversations.outcome,
    })
    .from(conversations)
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .leftJoin(teams, eq(teams.id, conversations.assignedTeamId))
    .where(and(...base))
    .orderBy(conversations.createdAt)
    .limit(50_000);

  const maskPhones =
    (await getOrganizationSettings(auth.organizationId)).maskPhoneForSellers === true &&
    !can(auth, "contacts.view_full_phone");

  const header = [
    "id",
    "criado_em",
    "status",
    "prioridade",
    "contato",
    "telefone",
    "vendedor",
    "equipe",
    "primeira_resposta_em",
    "encerrado_em",
    "motivo_encerramento",
    "resultado",
  ];

  const lines = [header.join(";")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        formatDateTime(row.criadoEm),
        row.status,
        row.prioridade,
        row.contato ?? "",
        maskPhones ? "(oculto)" : (row.telefone ?? ""),
        row.vendedor ?? "",
        row.equipe ?? "",
        formatDateTime(row.primeiraRespostaEm),
        formatDateTime(row.encerradoEm),
        row.motivo ?? "",
        row.resultado ?? "",
      ]
        .map(csvCell)
        .join(";"),
    );
  }

  return `﻿${lines.join("\r\n")}`;
}

/* ------------------------------------------------------------------ *
 * Importação CSV de contatos
 * ------------------------------------------------------------------ */

export type ImportResult = {
  processed: number;
  created: number;
  updated: number;
  skipped: { line: number; reason: string }[];
};

/**
 * Importa contatos a partir de um CSV com cabeçalho.
 * Colunas reconhecidas: nome, telefone, email, empresa, cidade, origem, observacoes.
 */
export async function importContactsCsv(
  auth: AuthContext,
  csv: string,
): Promise<ImportResult> {
  if (!can(auth, "reports.import")) throw errors.forbidden();
  const { contacts } = await import("@/db/schema");
  const { normalizePhone, isValidPhone } = await import("@/lib/phone");
  const db = await getDb();

  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    throw errors.validation("O arquivo precisa ter cabeçalho e ao menos uma linha.");
  }

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const header = splitCsvLine(lines[0], delimiter).map((h) =>
    h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
  );

  const indexOf = (...names: string[]) =>
    names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;

  const idxName = indexOf("nome", "name", "contato");
  const idxPhone = indexOf("telefone", "phone", "celular", "whatsapp");
  if (idxPhone < 0) {
    throw errors.validation('O arquivo precisa ter a coluna "telefone".');
  }

  const idxEmail = indexOf("email", "e-mail");
  const idxCompany = indexOf("empresa", "company");
  const idxCity = indexOf("cidade", "city");
  const idxSource = indexOf("origem", "source");
  const idxNotes = indexOf("observacoes", "observacao", "notas", "notes");

  const result: ImportResult = { processed: 0, created: 0, updated: 0, skipped: [] };

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i], delimiter);
    const rawPhone = cells[idxPhone]?.trim() ?? "";
    result.processed += 1;

    if (!rawPhone) {
      result.skipped.push({ line: i + 1, reason: "Telefone vazio." });
      continue;
    }
    const phone = normalizePhone(rawPhone);
    if (!isValidPhone(phone)) {
      result.skipped.push({ line: i + 1, reason: `Telefone inválido: ${rawPhone}` });
      continue;
    }

    const name = (idxName >= 0 ? cells[idxName]?.trim() : "") || phone;

    const inserted = await db
      .insert(contacts)
      .values({
        organizationId: auth.organizationId,
        whatsappId: phone,
        phone,
        name,
        email: idxEmail >= 0 ? cells[idxEmail]?.trim() || null : null,
        companyName: idxCompany >= 0 ? cells[idxCompany]?.trim() || null : null,
        city: idxCity >= 0 ? cells[idxCity]?.trim() || null : null,
        source: (idxSource >= 0 ? cells[idxSource]?.trim() : "") || "importação csv",
        notes: idxNotes >= 0 ? cells[idxNotes]?.trim() || null : null,
      })
      .onConflictDoUpdate({
        target: [contacts.organizationId, contacts.whatsappId],
        set: { name, updatedAt: new Date() },
      })
      .returning({ createdAt: contacts.createdAt, updatedAt: contacts.updatedAt });

    // Quando createdAt == updatedAt trata-se de inserção nova.
    const row = inserted[0];
    if (row && row.createdAt.getTime() === row.updatedAt.getTime()) result.created += 1;
    else result.updated += 1;
  }

  const { recordAudit } = await import("@/lib/audit");
  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "contacts.imported",
    entityType: "contact",
    metadata: {
      processados: result.processed,
      criados: result.created,
      atualizados: result.updated,
      ignorados: result.skipped.length,
    },
  });

  return result;
}

/* ------------------------------------------------------------------ *
 * Auxiliares
 * ------------------------------------------------------------------ */

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/["\n;,]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function formatDateTime(value: Date | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(value);
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export { inArray, isNull, messages };
