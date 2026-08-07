/**
 * Testes de integração de permissões, isolamento multiempresa, distribuição
 * automática aplicada ao banco, métricas e respostas rápidas por equipe.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  criarCenario,
  limparBanco,
  prepararBanco,
  receberMensagem,
  type Cenario,
} from "./helpers";

let a: Cenario;
let b: Cenario;

beforeAll(async () => {
  await prepararBanco();
  a = await criarCenario("alfa");
  b = await criarCenario("beta");
}, 120_000);

afterAll(async () => {
  await limparBanco();
});

/* ------------------------------------------------------------------ */

describe("escopo de visibilidade das conversas", () => {
  it("vendedor vê as próprias conversas e a fila livre, não as dos colegas", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const { listConversations } = await import("@/server/services/conversations");
    const db = await getDb();

    // Conversa 1: livre. Conversa 2: do vendedor1. Conversa 3: do vendedor2.
    await receberMensagem(a.instancia, "5511990000001", "Livre");
    await receberMensagem(a.instancia, "5511990000002", "Do vendedor 1");
    await receberMensagem(a.instancia, "5511990000003", "Do vendedor 2");

    const contatos = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.organizationId, a.organizationId));

    const acharConversa = async (telefone: string) => {
      const contato = contatos.find((c) => c.whatsappId === telefone)!;
      const [conversa] = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.contactId, contato.id));
      return conversa;
    };

    const doVendedor1 = await acharConversa("5511990000002");
    const doVendedor2 = await acharConversa("5511990000003");

    await db
      .update(schema.conversations)
      .set({ assignedUserId: a.vendedor1.id, status: "in_progress" })
      .where(eq(schema.conversations.id, doVendedor1.id));
    await db
      .update(schema.conversations)
      .set({ assignedUserId: a.vendedor2.id, status: "in_progress" })
      .where(eq(schema.conversations.id, doVendedor2.id));

    const lista = await listConversations(
      a.auth(a.vendedor1, [a.equipe.id]),
      { queue: "all", limit: 100 },
    );
    const ids = lista.items.map((i) => i.id);

    expect(ids).toContain(doVendedor1.id);
    expect(ids).not.toContain(doVendedor2.id);
  });

  it("administrador vê todas as conversas da própria empresa", async () => {
    const { listConversations } = await import("@/server/services/conversations");
    const lista = await listConversations(a.auth(a.admin), {
      queue: "all",
      limit: 100,
    });
    expect(lista.items.length).toBeGreaterThanOrEqual(3);
  });

  it("supervisor vê a fila do setor que supervisiona", async () => {
    const { listConversations } = await import("@/server/services/conversations");
    const lista = await listConversations(
      a.auth(a.supervisor, [a.equipe.id], [a.equipe.id]),
      { queue: "all", limit: 100 },
    );
    expect(lista.items.length).toBeGreaterThan(0);
  });

  it("nenhuma conversa vaza entre empresas", async () => {
    const { listConversations } = await import("@/server/services/conversations");
    await receberMensagem(b.instancia, "5511991111111", "Conversa da empresa B");

    const listaA = await listConversations(a.auth(a.admin), {
      queue: "all",
      limit: 100,
    });
    const listaB = await listConversations(b.auth(b.admin), {
      queue: "all",
      limit: 100,
    });

    const contatosA = listaA.items.map((i) => i.contact.phone);
    expect(contatosA.join(" ")).not.toContain("99111-1111");
    expect(listaB.items.length).toBe(1);
  });
});

describe("permissões nas ações", () => {
  it("vendedor não pode cadastrar usuários", async () => {
    const { createUser } = await import("@/server/services/team");
    await expect(
      createUser(a.auth(a.vendedor1), {
        name: "Intruso",
        email: "intruso@teste.local",
        role: "admin",
      }),
    ).rejects.toThrow(/permissão/i);
  });

  it("supervisor não pode gerenciar integrações", async () => {
    const { createConnection } = await import("@/server/services/connections");
    await expect(
      createConnection(a.auth(a.supervisor, [a.equipe.id], [a.equipe.id]), {
        label: "Número indevido",
        provider: "mock",
        scope: "organization",
        displayPhoneNumber: "+55 (11) 0000-0000",
      }),
    ).rejects.toThrow(/permissão/i);
  });

  it("administrador não consegue se auto-desativar sendo o único admin ativo", async () => {
    const { updateUser } = await import("@/server/services/team");
    await expect(
      updateUser(a.auth(a.admin), a.admin.id, { isActive: false }),
    ).rejects.toThrow(/ao menos um administrador ativo/i);
  });

  it("desativar um vendedor devolve as conversas dele para a fila", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const { updateUser } = await import("@/server/services/team");
    const db = await getDb();

    await receberMensagem(a.instancia, "5511992222222", "Vai voltar para a fila");
    const [contato] = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, a.organizationId),
          eq(schema.contacts.whatsappId, "5511992222222"),
        ),
      );
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, contato.id));

    await db
      .update(schema.conversations)
      .set({ assignedUserId: a.vendedor2.id, status: "in_progress" })
      .where(eq(schema.conversations.id, conversa.id));

    await updateUser(a.auth(a.admin), a.vendedor2.id, { isActive: false });

    const [depois] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversa.id));
    expect(depois.assignedUserId).toBeNull();
    expect(depois.status).toBe("unassigned");

    // Restaura para não afetar os testes seguintes.
    await updateUser(a.auth(a.admin), a.vendedor2.id, { isActive: true });
  });

  it("vendedor não transfere atendimento que não é dele", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const { transferConversation } = await import("@/server/services/conversations");
    const db = await getDb();

    await receberMensagem(a.instancia, "5511993333333", "Conversa do vendedor 1");
    const [contato] = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, a.organizationId),
          eq(schema.contacts.whatsappId, "5511993333333"),
        ),
      );
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, contato.id));

    await db
      .update(schema.conversations)
      .set({ assignedUserId: a.vendedor1.id, status: "in_progress" })
      .where(eq(schema.conversations.id, conversa.id));

    await expect(
      transferConversation(a.auth(a.vendedor2, [a.equipe.id]), {
        conversationId: conversa.id,
        toUserId: a.vendedor2.id,
      }),
    ).rejects.toThrow(/sob sua responsabilidade|não encontrado/i);

    // O supervisor, esse sim, pode transferir.
    await transferConversation(
      a.auth(a.supervisor, [a.equipe.id], [a.equipe.id]),
      { conversationId: conversa.id, toUserId: a.vendedor2.id },
    );
    const [depois] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversa.id));
    expect(depois.assignedUserId).toBe(a.vendedor2.id);
  });

  it("vendedor não acessa contato de outra empresa", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const { getContactPanel } = await import("@/server/services/contacts");
    const db = await getDb();

    const [contatoB] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.organizationId, b.organizationId))
      .limit(1);

    await expect(
      getContactPanel(a.auth(a.admin), contatoB.id),
    ).rejects.toThrow(/não encontrado/i);
  });
});

describe("mascaramento de telefone", () => {
  it("vendedor recebe o número mascarado quando a empresa exige", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const { listConversations } = await import("@/server/services/conversations");
    const { invalidateOrganizationCache } = await import(
      "@/server/services/organization"
    );
    const db = await getDb();

    await db
      .update(schema.organizations)
      .set({
        settings: { maskPhoneForSellers: true, demoMode: true, aiEnabled: true },
      })
      .where(eq(schema.organizations.id, a.organizationId));
    invalidateOrganizationCache(a.organizationId);

    const listaVendedor = await listConversations(
      a.auth(a.vendedor1, [a.equipe.id]),
      { queue: "all", limit: 5 },
    );
    expect(listaVendedor.items.every((i) => i.contact.phoneMasked)).toBe(true);
    expect(listaVendedor.items[0]?.contact.phone).toContain("•");

    // Administrador continua vendo o número completo.
    const listaAdmin = await listConversations(a.auth(a.admin), {
      queue: "all",
      limit: 5,
    });
    expect(listaAdmin.items.every((i) => !i.contact.phoneMasked)).toBe(true);
    expect(listaAdmin.items[0]?.contact.phone).not.toContain("•");

    // Restaura o padrão.
    await db
      .update(schema.organizations)
      .set({
        settings: { maskPhoneForSellers: false, demoMode: true, aiEnabled: true },
      })
      .where(eq(schema.organizations.id, a.organizationId));
    invalidateOrganizationCache(a.organizationId);
  });
});

describe("distribuição automática aplicada ao banco", () => {
  it("rodízio distribui alternadamente entre os vendedores online", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    const cenario = await criarCenario("rodizio");
    await db
      .delete(schema.assignmentRules)
      .where(eq(schema.assignmentRules.organizationId, cenario.organizationId));
    await db.insert(schema.assignmentRules).values({
      organizationId: cenario.organizationId,
      name: "Rodízio",
      strategy: "round_robin",
      priority: 10,
      isActive: true,
      configuration: { requireOnline: true },
    });

    const atribuidos: (string | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      await receberMensagem(
        cenario.instancia,
        `55119400000${10 + i}`,
        `Mensagem ${i}`,
      );
      const [contato] = await db
        .select()
        .from(schema.contacts)
        .where(eq(schema.contacts.whatsappId, `55119400000${10 + i}`));
      const [conversa] = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.contactId, contato.id));
      atribuidos.push(conversa.assignedUserId);
    }

    // Todas foram atribuídas, alternando entre os atendentes disponíveis
    // (dois vendedores e o supervisor — supervisores também atendem).
    expect(atribuidos.every(Boolean)).toBe(true);
    expect(new Set(atribuidos).size).toBe(3);
    expect(atribuidos[0]).not.toBe(atribuidos[1]);
    expect(atribuidos[1]).not.toBe(atribuidos[2]);
    // Com 3 atendentes e 4 conversas, a quarta volta para o primeiro.
    expect(atribuidos[3]).toBe(atribuidos[0]);
  });

  it("regra por palavra-chave direciona para o setor correto", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    const cenario = await criarCenario("setor");
    const [suporte] = await db
      .insert(schema.teams)
      .values({ organizationId: cenario.organizationId, name: "Suporte" })
      .returning();
    await db.insert(schema.teamMembers).values({
      organizationId: cenario.organizationId,
      teamId: suporte.id,
      userId: cenario.vendedor2.id,
    });

    await db
      .delete(schema.assignmentRules)
      .where(eq(schema.assignmentRules.organizationId, cenario.organizationId));
    await db.insert(schema.assignmentRules).values({
      organizationId: cenario.organizationId,
      name: "Suporte por palavra-chave",
      strategy: "team_based",
      teamId: suporte.id,
      priority: 10,
      isActive: true,
      configuration: { requireOnline: true, keywords: ["defeito"] },
    });

    await receberMensagem(
      cenario.instancia,
      "5511995555555",
      "O produto chegou com defeito",
    );

    const [contato] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.whatsappId, "5511995555555"));
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, contato.id));

    expect(conversa.assignedUserId).toBe(cenario.vendedor2.id);
    expect(conversa.assignedTeamId).toBe(suporte.id);
  });

  it("respeita o limite de atendimentos simultâneos", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    const cenario = await criarCenario("limite");
    await db
      .update(schema.users)
      .set({ maxConcurrentConversations: 1 })
      .where(eq(schema.users.organizationId, cenario.organizationId));

    await db
      .delete(schema.assignmentRules)
      .where(eq(schema.assignmentRules.organizationId, cenario.organizationId));
    await db.insert(schema.assignmentRules).values({
      organizationId: cenario.organizationId,
      name: "Menor carga",
      strategy: "least_active",
      priority: 10,
      isActive: true,
      configuration: { requireOnline: true },
    });

    // Três atendentes (2 vendedores + supervisor) com limite 1 cada:
    // a quarta conversa não tem para quem ir e fica na fila.
    for (let i = 0; i < 4; i += 1) {
      await receberMensagem(cenario.instancia, `55119600000${10 + i}`, `Msg ${i}`);
    }

    const conversas = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.organizationId, cenario.organizationId));

    const semResponsavel = conversas.filter((c) => !c.assignedUserId);
    expect(conversas).toHaveLength(4);
    expect(semResponsavel).toHaveLength(1);
  });
});

describe("respostas rápidas por equipe", () => {
  it("vendedor não recebe resposta restrita a outra equipe", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const { listQuickReplies } = await import("@/server/services/catalog");
    const db = await getDb();

    const [outraEquipe] = await db
      .insert(schema.teams)
      .values({ organizationId: a.organizationId, name: "Financeiro" })
      .returning();

    await db.insert(schema.quickReplies).values([
      {
        organizationId: a.organizationId,
        title: "Geral",
        shortcut: "/geral",
        content: "Disponível para todos",
        allowedTeamIds: [],
      },
      {
        organizationId: a.organizationId,
        title: "Restrita",
        shortcut: "/restrita",
        content: "Só para o Financeiro",
        allowedTeamIds: [outraEquipe.id],
      },
    ]);

    const doVendedor = await listQuickReplies(a.auth(a.vendedor1, [a.equipe.id]));
    const titulos = doVendedor.map((q) => q.title);
    expect(titulos).toContain("Geral");
    expect(titulos).not.toContain("Restrita");

    // Administrador enxerga todas.
    const doAdmin = await listQuickReplies(a.auth(a.admin));
    expect(doAdmin.map((q) => q.title)).toContain("Restrita");
  });
});

describe("métricas e relatórios", () => {
  it("o painel respeita o escopo do perfil", async () => {
    const { getDashboard } = await import("@/server/services/reports");

    const painelAdmin = await getDashboard(a.auth(a.admin));
    const painelVendedor = await getDashboard(a.auth(a.vendedor1, [a.equipe.id]));

    expect(painelAdmin.counters.waiting).toBeGreaterThanOrEqual(0);
    expect(painelAdmin.lastSevenDays).toHaveLength(7);
    // O vendedor nunca vê mais conversas que o administrador.
    expect(painelVendedor.counters.inProgress).toBeLessThanOrEqual(
      painelAdmin.counters.inProgress,
    );
  });

  it("o relatório calcula totais e agrupamentos", async () => {
    const { getFullReport } = await import("@/server/services/reports");
    const relatorio = await getFullReport(a.auth(a.admin), {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(Date.now() + 60_000),
    });

    expect(relatorio.totals.received).toBeGreaterThan(0);
    expect(relatorio.totals.uniqueContacts).toBeGreaterThan(0);
    expect(Array.isArray(relatorio.bySeller)).toBe(true);
    expect(Array.isArray(relatorio.byHour)).toBe(true);
    expect(Array.isArray(relatorio.daily)).toBe(true);
  });

  it("o CSV exportado tem cabeçalho e uma linha por atendimento", async () => {
    const { exportConversationsCsv } = await import("@/server/services/reports");
    const csv = await exportConversationsCsv(a.auth(a.admin), {});
    const linhas = csv.replace(/^﻿/, "").trim().split("\r\n");

    expect(linhas[0]).toContain("id;criado_em;status");
    expect(linhas.length).toBeGreaterThan(1);
  });

  it("vendedor não pode exportar relatório", async () => {
    const { exportConversationsCsv } = await import("@/server/services/reports");
    await expect(
      exportConversationsCsv(a.auth(a.vendedor1, [a.equipe.id]), {}),
    ).rejects.toThrow(/permissão/i);
  });

  it("importação de CSV cria contatos e reporta linhas inválidas", async () => {
    const { importContactsCsv } = await import("@/server/services/reports");
    const csv = [
      "nome;telefone;email;cidade",
      "Novo Cliente;11987650001;novo@exemplo.test;Campinas",
      "Sem Telefone;;x@y.z;Santos",
      "Telefone Inválido;123;;",
    ].join("\n");

    const resultado = await importContactsCsv(a.auth(a.admin), csv);
    expect(resultado.processed).toBe(3);
    expect(resultado.created).toBe(1);
    expect(resultado.skipped).toHaveLength(2);
  });
});

describe("kanban individual", () => {
  it("cada usuário só enxerga e edita os próprios quadros", async () => {
    const { createBoard, getBoard, listBoards } = await import(
      "@/server/services/kanban"
    );

    const quadro = await createBoard(a.auth(a.vendedor1, [a.equipe.id]), {
      name: "Funil do Vendedor 1",
    });

    const doVendedor1 = await listBoards(a.auth(a.vendedor1, [a.equipe.id]));
    expect(doVendedor1.map((q) => q.id)).toContain(quadro.id);

    const doVendedor2 = await listBoards(a.auth(a.vendedor2, [a.equipe.id]));
    expect(doVendedor2.map((q) => q.id)).not.toContain(quadro.id);

    await expect(
      getBoard(a.auth(a.vendedor2, [a.equipe.id]), quadro.id),
    ).rejects.toThrow(/pertence a outro usuário/i);
  });

  it("um usuário pode ter vários quadros, sem limite", async () => {
    const { createBoard, listBoards } = await import("@/server/services/kanban");
    const auth = a.auth(a.supervisor, [a.equipe.id], [a.equipe.id]);

    for (let i = 0; i < 5; i += 1) {
      await createBoard(auth, { name: `Quadro ${i}` });
    }
    const quadros = await listBoards(auth);
    expect(quadros.length).toBeGreaterThanOrEqual(5);
  });

  it("mover card para coluna com status aplica o status na conversa", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const { createBoard, createCard, getBoard, moveCard } = await import(
      "@/server/services/kanban"
    );
    const db = await getDb();
    const auth = a.auth(a.vendedor1, [a.equipe.id]);

    const quadro = await createBoard(auth, { name: "Com automação" });
    const { columns } = await getBoard(auth, quadro.id);

    await db
      .update(schema.kanbanColumns)
      .set({ appliesConversationStatus: "waiting_customer" })
      .where(eq(schema.kanbanColumns.id, columns[1].id));

    await receberMensagem(a.instancia, "5511997777777", "Card com automação");
    const [contato] = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, a.organizationId),
          eq(schema.contacts.whatsappId, "5511997777777"),
        ),
      );
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, contato.id));
    await db
      .update(schema.conversations)
      .set({ assignedUserId: a.vendedor1.id, status: "in_progress" })
      .where(eq(schema.conversations.id, conversa.id));

    const card = await createCard(auth, {
      boardId: quadro.id,
      columnId: columns[0].id,
      title: "Oportunidade",
      conversationId: conversa.id,
    });

    await moveCard(auth, card.id, columns[1].id, 0);

    const [depois] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversa.id));
    expect(depois.status).toBe("waiting_customer");
  });
});

describe("auditoria", () => {
  it("registra as ações sensíveis com metadados sanitizados", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    const logs = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, a.organizationId));

    const acoes = logs.map((l) => l.action);
    expect(acoes).toContain("conversation.transferred");
    expect(acoes).toContain("contacts.imported");
    // Nenhum log guarda segredo em texto aberto.
    const serializado = JSON.stringify(logs);
    expect(serializado).not.toMatch(/"password":"(?!\[oculto\])/);
  });
});
