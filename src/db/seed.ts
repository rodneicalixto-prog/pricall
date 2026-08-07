/**
 * Dados de demonstração.
 *
 * Cria uma empresa fictícia completa para testar o sistema sem nenhuma
 * credencial externa. Nenhum dado pessoal real é usado: nomes, telefones e
 * mensagens são inventados, e todos os registros ficam marcados com
 * `is_demo = true`.
 *
 * Uso: `npm run db:seed`
 */
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "./index";
import {
  assignmentRules,
  calendarEvents,
  contacts,
  conversationEvents,
  conversationTags,
  conversations,
  kanbanBoards,
  kanbanCards,
  kanbanColumns,
  messages,
  organizations,
  quickReplies,
  scheduledFollowups,
  tags,
  teamMembers,
  teams,
  users,
  whatsappConnections,
} from "./schema";
import { hashPassword } from "@/lib/auth/password";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/business-hours";
import { runMigrations } from "./migrate";

const DEMO_SLUG = "distribuidora-modelo";
export const DEMO_PASSWORD = "pricall123";

/** Nomes fictícios — nunca usar dados pessoais reais na demonstração. */
const CONTACT_NAMES = [
  "Ana Ribeiro", "Bruno Tavares", "Camila Nogueira", "Diego Marques",
  "Eduarda Pires", "Felipe Andrade", "Gabriela Souto", "Henrique Vasques",
  "Isabela Cordeiro", "João Meireles", "Karina Bastos", "Lucas Moraes",
  "Mariana Freitas", "Norberto Lima", "Olívia Bezerra", "Paulo Rangel",
  "Queila Martins", "Rafael Duarte", "Simone Aguiar", "Thiago Peixoto",
];

const CITIES = [
  "São Paulo", "Campinas", "Ribeirão Preto", "Santos", "Sorocaba",
  "Bauru", "São José dos Campos", "Piracicaba",
];

const OPENING_MESSAGES = [
  "Bom dia! Vocês trabalham com entrega para a zona sul?",
  "Oi, gostaria de um orçamento para 200 unidades.",
  "Boa tarde, o pedido 4471 já saiu para entrega?",
  "Olá! Qual o prazo de instalação?",
  "Vi o anúncio de vocês, ainda está disponível?",
  "Preciso de ajuda urgente com um produto que chegou com defeito.",
  "Vocês emitem nota fiscal para empresa?",
  "Consigo parcelar essa compra?",
  "Qual o horário de funcionamento de vocês no sábado?",
  "Quero fazer um pedido recorrente mensal, como funciona?",
];

const FOLLOWUP_MESSAGES = [
  "Perfeito, obrigado!",
  "Consegue me mandar por escrito para eu apresentar aqui?",
  "Vou conversar com meu sócio e retorno.",
  "Ficou um pouco acima do que eu esperava.",
  "Fechado, pode seguir.",
];

const SELLER_REPLIES = [
  "Olá! Aqui é {vendedor}, da Distribuidora Modelo. Já vou verificar isso para você.",
  "Consigo sim. Vou levantar os valores e te mando ainda hoje.",
  "Verifiquei aqui: temos disponibilidade e conseguimos atender esse prazo.",
  "Anotei seu pedido. Assim que confirmar internamente, te retorno por aqui.",
];

function pick<T>(list: readonly T[], index: number): T {
  return list[index % list.length]!;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

export type SeedResult = {
  organizationId: string;
  adminEmail: string;
  supervisorEmail: string;
  sellerEmails: string[];
  password: string;
};

export async function seedDemo(options: { reset?: boolean } = {}): Promise<SeedResult> {
  const db = await getDb();

  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, DEMO_SLUG))
    .limit(1);

  if (existing) {
    if (!options.reset) {
      console.log("[pricall] empresa de demonstração já existe; nada a fazer.");
      return describeExisting(existing.id);
    }
    // ON DELETE CASCADE limpa toda a árvore da organização.
    await db.delete(organizations).where(eq(organizations.id, existing.id));
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  /* ---------------------------- Empresa ---------------------------- */
  const [organization] = await db
    .insert(organizations)
    .values({
      name: "Distribuidora Modelo",
      slug: DEMO_SLUG,
      segment: "Distribuidora",
      timezone: "America/Sao_Paulo",
      businessHours: DEFAULT_BUSINESS_HOURS,
      status: "active",
      branding: { primaryColor: "#16A34A", inboxName: "Central de atendimento" },
      settings: {
        aiEnabled: true,
        aiSummaryEnabled: true,
        demoMode: true,
        slaFirstResponseMinutes: 10,
        slaStaleConversationMinutes: 30,
        assignOutsideBusinessHours: false,
        maskPhoneForSellers: false,
        dataRetentionDays: 365,
      },
      onboardingCompletedAt: new Date(),
    })
    .returning();

  const organizationId = organization.id;

  /* ---------------------------- Equipes ---------------------------- */
  const insertedTeams = await db
    .insert(teams)
    .values([
      { organizationId, name: "Vendas", description: "Atendimento comercial", color: "#16A34A" },
      { organizationId, name: "Suporte", description: "Pós-venda e assistência", color: "#2563EB" },
    ])
    .returning();
  const [salesTeam, supportTeam] = insertedTeams;

  /* ---------------------------- Usuários ---------------------------- */
  const [admin] = await db
    .insert(users)
    .values({
      organizationId,
      name: "Renata Coelho",
      email: "admin@demo.pricall.app",
      phone: "5511900000001",
      role: "admin",
      passwordHash,
      availabilityStatus: "online",
      lastActivityAt: new Date(),
    })
    .returning();

  const [supervisor] = await db
    .insert(users)
    .values({
      organizationId,
      name: "Marcos Teodoro",
      email: "supervisor@demo.pricall.app",
      phone: "5511900000002",
      role: "supervisor",
      passwordHash,
      availabilityStatus: "online",
      lastActivityAt: new Date(),
    })
    .returning();

  const sellers = await db
    .insert(users)
    .values(
      [
        ["Aline Prado", "vendedor1@demo.pricall.app", "online"],
        ["Caio Bertoldo", "vendedor2@demo.pricall.app", "online"],
        ["Débora Nunes", "vendedor3@demo.pricall.app", "away"],
        ["Elias Fontana", "vendedor4@demo.pricall.app", "offline"],
      ].map(([name, email, status], index) => ({
        organizationId,
        name,
        email,
        phone: `551190000001${index}`,
        role: "seller" as const,
        passwordHash,
        availabilityStatus: status as "online" | "away" | "offline",
        maxConcurrentConversations: 15,
        lastActivityAt: status === "offline" ? minutesAgo(90) : new Date(),
      })),
    )
    .returning();

  await db.insert(teamMembers).values([
    { organizationId, teamId: salesTeam.id, userId: supervisor.id, isSupervisor: true },
    { organizationId, teamId: salesTeam.id, userId: sellers[0].id },
    { organizationId, teamId: salesTeam.id, userId: sellers[1].id },
    { organizationId, teamId: supportTeam.id, userId: sellers[2].id },
    { organizationId, teamId: supportTeam.id, userId: sellers[3].id },
  ]);

  /* ------------------------ Conexões de WhatsApp ------------------------ */
  const insertedConnections = await db
    .insert(whatsappConnections)
    .values([
      {
        organizationId,
        label: "Número principal (demonstração)",
        provider: "mock" as const,
        scope: "organization" as const,
        displayPhoneNumber: "+55 (11) 3000-0000",
        instanceName: "demo-principal",
        status: "connected" as const,
        webhookVerified: true,
        isDemo: true,
        isDefault: true,
        lastWebhookAt: new Date(),
      },
      {
        organizationId,
        label: "Vendas — ramal 101",
        provider: "mock" as const,
        scope: "team" as const,
        teamId: salesTeam.id,
        extension: "101",
        displayPhoneNumber: "+55 (11) 3000-0101",
        instanceName: "demo-vendas",
        status: "connected" as const,
        webhookVerified: true,
        isDemo: true,
      },
      {
        organizationId,
        label: "Suporte — ramal 201",
        provider: "mock" as const,
        scope: "team" as const,
        teamId: supportTeam.id,
        extension: "201",
        displayPhoneNumber: "+55 (11) 3000-0201",
        instanceName: "demo-suporte",
        status: "connected" as const,
        webhookVerified: true,
        isDemo: true,
      },
      {
        organizationId,
        label: `Número individual — ${sellers[0].name}`,
        provider: "mock" as const,
        scope: "user" as const,
        ownerUserId: sellers[0].id,
        teamId: salesTeam.id,
        displayPhoneNumber: "+55 (11) 98000-0001",
        instanceName: "demo-aline",
        status: "connected" as const,
        webhookVerified: true,
        isDemo: true,
      },
    ])
    .returning();

  const mainConnection = insertedConnections[0];
  const salesConnection = insertedConnections[1];
  const supportConnection = insertedConnections[2];

  /* ---------------------------- Marcadores ---------------------------- */
  const insertedTags = await db
    .insert(tags)
    .values(
      [
        ["Novo cliente", "#2563EB"],
        ["Urgente", "#DC2626"],
        ["Orçamento", "#F59E0B"],
        ["Retornar depois", "#64748B"],
        ["Cliente recorrente", "#16A34A"],
        ["Suporte", "#0EA5E9"],
        ["Reclamação", "#DC2626"],
        ["Possível venda", "#166534"],
      ].map(([name, color]) => ({ organizationId, name, color })),
    )
    .returning();

  /* ------------------------- Respostas rápidas ------------------------- */
  await db.insert(quickReplies).values([
    {
      organizationId,
      title: "Saudação inicial",
      shortcut: "/ola",
      content:
        "Olá, {{nome_cliente}}! Aqui é {{nome_vendedor}}, da {{nome_empresa}}. Como posso te ajudar hoje?",
      category: "Abertura",
      createdBy: admin.id,
    },
    {
      organizationId,
      title: "Aguardar um instante",
      shortcut: "/aguarde",
      content:
        "{{primeiro_nome_cliente}}, só um instante que já verifico essa informação para você.",
      category: "Atendimento",
      createdBy: admin.id,
    },
    {
      organizationId,
      title: "Horário de atendimento",
      shortcut: "/horario",
      content:
        "Nosso horário de atendimento é {{horario_atendimento}}. Fora desse período, respondemos assim que voltarmos.",
      category: "Informações",
      createdBy: admin.id,
    },
    {
      organizationId,
      title: "Envio de orçamento",
      shortcut: "/orcamento",
      content:
        "{{primeiro_nome_cliente}}, segue o orçamento solicitado. Ele é válido por 7 dias. Qualquer dúvida, estou à disposição. — {{nome_vendedor}}",
      category: "Comercial",
      allowedTeamIds: [salesTeam.id],
      createdBy: admin.id,
    },
    {
      organizationId,
      title: "Encerramento",
      shortcut: "/obrigado",
      content:
        "Obrigado pelo contato, {{primeiro_nome_cliente}}! Qualquer coisa é só chamar aqui. — {{nome_vendedor}}, {{nome_empresa}}",
      category: "Encerramento",
      createdBy: admin.id,
    },
  ]);

  /* ---------------------- Regras de distribuição ---------------------- */
  await db.insert(assignmentRules).values([
    {
      organizationId,
      name: "Suporte por palavra-chave",
      strategy: "team_based",
      teamId: supportTeam.id,
      priority: 10,
      isActive: true,
      configuration: {
        requireOnline: true,
        keywords: ["defeito", "problema", "reclamação", "assistência", "garantia"],
        fallbackStrategy: "least_active",
      },
    },
    {
      organizationId,
      name: "Vendas — menor carga",
      strategy: "least_active",
      teamId: salesTeam.id,
      priority: 50,
      isActive: true,
      configuration: { requireOnline: true, fallbackStrategy: "round_robin" },
    },
  ]);

  /* ---------------------------- Contatos ---------------------------- */
  const insertedContacts = await db
    .insert(contacts)
    .values(
      CONTACT_NAMES.map((name, index) => {
        const phone = `5511${String(97000000 + index * 137).padStart(9, "0")}`;
        return {
          organizationId,
          whatsappId: phone,
          phone,
          name,
          email: `${name.split(" ")[0]!.toLowerCase()}@exemplo.test`,
          companyName: index % 3 === 0 ? `${name.split(" ")[1]} Comércio Ltda` : null,
          city: pick(CITIES, index),
          source: index % 4 === 0 ? "indicação" : "whatsapp",
          isDemo: true,
          firstContactAt: minutesAgo(60 * 24 * (index % 12) + 30),
          lastContactAt: minutesAgo(index * 23 + 5),
        };
      }),
    )
    .returning();

  /* --------------------------- Conversas --------------------------- */
  // Distribuição pensada para exercitar todos os filtros da caixa de entrada.
  const plan: {
    status: "unassigned" | "waiting" | "in_progress" | "waiting_customer" | "closed";
    seller: number | null;
    team: "sales" | "support";
    priority: "low" | "normal" | "high" | "urgent";
    ageMinutes: number;
    answered: boolean;
  }[] = [
    { status: "unassigned", seller: null, team: "sales", priority: "normal", ageMinutes: 4, answered: false },
    { status: "unassigned", seller: null, team: "sales", priority: "high", ageMinutes: 12, answered: false },
    { status: "unassigned", seller: null, team: "support", priority: "urgent", ageMinutes: 47, answered: false },
    { status: "waiting", seller: null, team: "sales", priority: "normal", ageMinutes: 22, answered: false },
    { status: "in_progress", seller: 0, team: "sales", priority: "normal", ageMinutes: 35, answered: true },
    { status: "in_progress", seller: 0, team: "sales", priority: "high", ageMinutes: 75, answered: true },
    { status: "in_progress", seller: 1, team: "sales", priority: "normal", ageMinutes: 90, answered: true },
    { status: "in_progress", seller: 1, team: "sales", priority: "low", ageMinutes: 130, answered: true },
    { status: "in_progress", seller: 2, team: "support", priority: "urgent", ageMinutes: 55, answered: true },
    { status: "waiting_customer", seller: 0, team: "sales", priority: "normal", ageMinutes: 200, answered: true },
    { status: "waiting_customer", seller: 1, team: "sales", priority: "normal", ageMinutes: 320, answered: true },
    { status: "waiting_customer", seller: 2, team: "support", priority: "low", ageMinutes: 410, answered: true },
    { status: "closed", seller: 0, team: "sales", priority: "normal", ageMinutes: 600, answered: true },
    { status: "closed", seller: 1, team: "sales", priority: "normal", ageMinutes: 900, answered: true },
    { status: "closed", seller: 2, team: "support", priority: "normal", ageMinutes: 1500, answered: true },
    { status: "closed", seller: 3, team: "support", priority: "low", ageMinutes: 2200, answered: true },
    { status: "closed", seller: 0, team: "sales", priority: "high", ageMinutes: 3000, answered: true },
    { status: "closed", seller: 1, team: "sales", priority: "normal", ageMinutes: 4200, answered: true },
    { status: "in_progress", seller: 3, team: "support", priority: "normal", ageMinutes: 65, answered: true },
    { status: "unassigned", seller: null, team: "support", priority: "normal", ageMinutes: 8, answered: false },
  ];

  const outcomes = [
    ["Cliente atendido", "Dúvida respondida"],
    ["Venda encaminhada", "Pedido enviado ao financeiro"],
    ["Cliente pediu retorno", "Retornar na próxima semana"],
    ["Sem interesse", "Cliente achou o valor alto"],
  ];

  let messageCounter = 0;
  const createdConversations: { id: string; contactId: string; sellerIndex: number | null }[] = [];

  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index];
    const contact = insertedContacts[index];
    const team = item.team === "sales" ? salesTeam : supportTeam;
    const connection =
      item.team === "sales" ? salesConnection : supportConnection;
    const seller = item.seller !== null ? sellers[item.seller] : null;

    const createdAt = minutesAgo(item.ageMinutes + 5);
    const lastInboundAt = minutesAgo(item.ageMinutes);
    const firstResponseAt = item.answered ? minutesAgo(item.ageMinutes - 2) : null;
    const lastOutboundAt =
      item.answered && item.status !== "unassigned" && item.status !== "waiting"
        ? minutesAgo(Math.max(item.ageMinutes - 3, 1))
        : null;

    const closed = item.status === "closed";
    const outcome = pick(outcomes, index);

    const [conversation] = await db
      .insert(conversations)
      .values({
        organizationId,
        contactId: contact.id,
        whatsappConnectionId: connection?.id ?? mainConnection.id,
        assignedUserId: seller?.id ?? null,
        assignedTeamId: team.id,
        status: item.status,
        priority: item.priority,
        unreadCount: item.answered ? 0 : 1,
        isFavorite: index % 7 === 0,
        lastMessageAt: closed ? minutesAgo(item.ageMinutes - 4) : lastInboundAt,
        lastInboundAt,
        lastOutboundAt,
        assignedAt: seller ? minutesAgo(item.ageMinutes - 1) : null,
        firstResponseAt,
        closedAt: closed ? minutesAgo(item.ageMinutes - 4) : null,
        closedBy: closed ? (seller?.id ?? admin.id) : null,
        closingReason: closed ? outcome[1] : null,
        outcome: closed ? outcome[0] : null,
        isDemo: true,
        createdAt,
      })
      .returning();

    createdConversations.push({
      id: conversation.id,
      contactId: contact.id,
      sellerIndex: item.seller,
    });

    /* ------------------------ Mensagens ------------------------ */
    const thread: {
      senderType: "contact" | "seller";
      content: string;
      at: Date;
      status: "received" | "sent" | "delivered" | "read" | "failed";
    }[] = [
      {
        senderType: "contact",
        content: pick(OPENING_MESSAGES, index),
        at: createdAt,
        status: "received",
      },
    ];

    if (item.answered && seller) {
      thread.push({
        senderType: "seller",
        content: pick(SELLER_REPLIES, index).replace("{vendedor}", seller.name),
        at: firstResponseAt ?? minutesAgo(item.ageMinutes - 2),
        status: index % 9 === 0 ? "failed" : index % 3 === 0 ? "read" : "delivered",
      });
      thread.push({
        senderType: "contact",
        content: pick(FOLLOWUP_MESSAGES, index),
        at: lastInboundAt,
        status: "received",
      });
    }

    if (closed && seller) {
      thread.push({
        senderType: "seller",
        content: `Obrigado pelo contato, ${contact.name.split(" ")[0]}! Fico à disposição.`,
        at: minutesAgo(item.ageMinutes - 4),
        status: "read",
      });
    }

    for (const entry of thread) {
      messageCounter += 1;
      await db.insert(messages).values({
        organizationId,
        conversationId: conversation.id,
        whatsappMessageId: `demo.msg.${organizationId.slice(0, 8)}.${messageCounter}`,
        senderType: entry.senderType,
        senderUserId: entry.senderType === "seller" ? seller?.id : null,
        messageType: "text",
        content: entry.content,
        direction: entry.senderType === "contact" ? "inbound" : "outbound",
        status: entry.status,
        failureReason:
          entry.status === "failed"
            ? "Falha simulada de envio (modo demonstração)."
            : null,
        sentAt: entry.at,
        deliveredAt: ["delivered", "read"].includes(entry.status) ? entry.at : null,
        readAt: entry.status === "read" ? entry.at : null,
        createdAt: entry.at,
      });
    }

    /* -------------------- Marcadores e eventos -------------------- */
    const tagIndexes = index % 3 === 0 ? [0, 7] : index % 3 === 1 ? [2] : [5];
    for (const tagIndex of tagIndexes) {
      await db
        .insert(conversationTags)
        .values({
          organizationId,
          conversationId: conversation.id,
          tagId: insertedTags[tagIndex].id,
        })
        .onConflictDoNothing();
    }

    await db.insert(conversationEvents).values({
      organizationId,
      conversationId: conversation.id,
      eventType: "created",
      newValue: { origem: "demonstração" },
      createdAt,
    });

    if (seller) {
      await db.insert(conversationEvents).values({
        organizationId,
        conversationId: conversation.id,
        eventType: "assigned",
        actorUserId: seller.id,
        newValue: { assignedUserId: seller.id },
        createdAt: minutesAgo(item.ageMinutes - 1),
      });
    }
    if (closed) {
      await db.insert(conversationEvents).values({
        organizationId,
        conversationId: conversation.id,
        eventType: "closed",
        actorUserId: seller?.id ?? admin.id,
        newValue: { motivo: outcome[1], resultado: outcome[0] },
        createdAt: minutesAgo(item.ageMinutes - 4),
      });
    }
  }

  // Uma transferência registrada, para o histórico não ficar vazio.
  const transferred = createdConversations[6];
  await db.insert(conversationEvents).values({
    organizationId,
    conversationId: transferred.id,
    eventType: "transferred",
    actorUserId: supervisor.id,
    previousValue: { assignedUserId: sellers[0].id },
    newValue: { assignedUserId: sellers[1].id },
    metadata: { motivo: "Cliente da carteira do Caio" },
  });

  /* ------------------------ Retornos e agenda ------------------------ */
  await db.insert(scheduledFollowups).values([
    {
      organizationId,
      conversationId: createdConversations[12].id,
      assignedUserId: sellers[0].id,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60_000),
      note: "Retornar com o orçamento revisado.",
      createdBy: sellers[0].id,
    },
    {
      organizationId,
      conversationId: createdConversations[13].id,
      assignedUserId: sellers[1].id,
      scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60_000),
      note: "Cliente pediu para ligar na próxima semana.",
      createdBy: sellers[1].id,
    },
  ]);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  await db.insert(calendarEvents).values([
    {
      organizationId,
      userId: sellers[0].id,
      conversationId: createdConversations[4].id,
      contactId: createdConversations[4].contactId,
      title: "Visita técnica — apresentação de proposta",
      description: "Levar catálogo impresso e tabela de preços atualizada.",
      location: "Escritório do cliente",
      startsAt: tomorrow,
      endsAt: new Date(tomorrow.getTime() + 60 * 60_000),
      createdBy: sellers[0].id,
    },
    {
      organizationId,
      userId: sellers[1].id,
      title: "Reunião de alinhamento comercial",
      startsAt: new Date(tomorrow.getTime() + 4 * 60 * 60_000),
      endsAt: new Date(tomorrow.getTime() + 5 * 60 * 60_000),
      createdBy: supervisor.id,
    },
  ]);

  /* ------------------------------ Kanban ------------------------------ */
  for (const [ownerIndex, owner] of [admin, sellers[0], sellers[1]].entries()) {
    const [board] = await db
      .insert(kanbanBoards)
      .values({
        organizationId,
        userId: owner.id,
        name: ownerIndex === 0 ? "Visão geral" : "Meu funil",
        description: "Quadro pessoal de acompanhamento comercial.",
        position: 0,
      })
      .returning();

    const columns = await db
      .insert(kanbanColumns)
      .values([
        { organizationId, boardId: board.id, name: "Novos", color: "#2563EB", position: 0 },
        { organizationId, boardId: board.id, name: "Em contato", color: "#F59E0B", position: 1, appliesConversationStatus: "in_progress" as const },
        { organizationId, boardId: board.id, name: "Proposta enviada", color: "#0EA5E9", position: 2, appliesConversationStatus: "waiting_customer" as const },
        { organizationId, boardId: board.id, name: "Fechado", color: "#16A34A", position: 3 },
      ])
      .returning();

    const ownConversations = createdConversations.filter(
      (c) => ownerIndex === 0 || c.sellerIndex === ownerIndex - 1,
    );

    for (const [cardIndex, conversation] of ownConversations.slice(0, 6).entries()) {
      const contact = insertedContacts.find((c) => c.id === conversation.contactId);
      await db
        .insert(kanbanCards)
        .values({
          organizationId,
          boardId: board.id,
          columnId: columns[cardIndex % columns.length].id,
          conversationId: conversation.id,
          contactId: conversation.contactId,
          title: contact?.name ?? "Oportunidade",
          value: (cardIndex + 1) * 1500,
          position: cardIndex,
        })
        .onConflictDoNothing();
    }
  }

  console.log("[pricall] dados de demonstração criados.");
  return {
    organizationId,
    adminEmail: admin.email,
    supervisorEmail: supervisor.email,
    sellerEmails: sellers.map((s) => s.email),
    password: DEMO_PASSWORD,
  };
}

async function describeExisting(organizationId: string): Promise<SeedResult> {
  const db = await getDb();
  const rows = await db
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(eq(users.organizationId, organizationId));

  return {
    organizationId,
    adminEmail: rows.find((r) => r.role === "admin")?.email ?? "",
    supervisorEmail: rows.find((r) => r.role === "supervisor")?.email ?? "",
    sellerEmails: rows.filter((r) => r.role === "seller").map((r) => r.email),
    password: DEMO_PASSWORD,
  };
}

/** Remove somente os registros de demonstração da organização informada. */
export async function clearDemoData(organizationId: string) {
  const db = await getDb();
  await db
    .delete(conversations)
    .where(
      sql`${conversations.organizationId} = ${organizationId} and ${conversations.isDemo} = true`,
    );
  await db
    .delete(contacts)
    .where(sql`${contacts.organizationId} = ${organizationId} and ${contacts.isDemo} = true`);
}

const invokedDirectly =
  process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js");

if (invokedDirectly) {
  runMigrations()
    .then(() => seedDemo({ reset: process.argv.includes("--reset") }))
    .then(async (result) => {
      console.log("\n=== Acesso à demonstração ===");
      console.log(`Administrador: ${result.adminEmail}`);
      console.log(`Supervisor:    ${result.supervisorEmail}`);
      result.sellerEmails.forEach((email, i) =>
        console.log(`Vendedor ${i + 1}:    ${email}`),
      );
      console.log(`Senha (todos): ${result.password}\n`);
      await closeDb();
    })
    .catch(async (error) => {
      console.error("[pricall] falha ao criar dados de demonstração:", error);
      await closeDb().catch(() => {});
      process.exit(1);
    });
}
