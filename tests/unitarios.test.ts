/**
 * Testes unitários das regras puras: distribuição, permissões, transições de
 * status, respostas rápidas, horário de funcionamento e telefone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  eligibleCandidates,
  pickAssignee,
  selectRule,
  type Candidate,
  type RuleLike,
} from "@/lib/assignment";
import { can, conversationScopeOf, permissionsOf } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import { canTransition } from "@/server/services/conversations";
import {
  buildVariables,
  missingVariables,
  renderTemplate,
} from "@/lib/templates";
import {
  describeBusinessHours,
  isWithinBusinessHours,
} from "@/lib/business-hours";
import { formatPhone, isValidPhone, maskPhone, normalizePhone } from "@/lib/phone";
import { sanitizeMetadata } from "@/lib/audit";
import { isWithinServiceWindow, validateMedia } from "@/modules/whatsapp/provider";
import { redact } from "@/modules/ai";
import { detectProvider } from "@/modules/whatsapp";
import { EvolutionProvider } from "@/modules/whatsapp/evolution";
import { env } from "@/lib/env";

function candidato(parcial: Partial<Candidate> & { userId: string }): Candidate {
  return {
    name: parcial.userId,
    isActive: true,
    availabilityStatus: "online",
    activeConversations: 0,
    maxConcurrentConversations: 20,
    teamIds: [],
    createdAtMs: 1_000,
    ...parcial,
  };
}

function auth(parcial: Partial<AuthContext>): AuthContext {
  return {
    userId: "u1",
    organizationId: "org1",
    role: "seller",
    name: "Fulano",
    email: "f@e.com",
    avatarUrl: null,
    sessionId: "s1",
    teamIds: [],
    supervisedTeamIds: [],
    ...parcial,
  };
}

/* ------------------------------------------------------------------ */

describe("regras de distribuição", () => {
  it("distribuição manual nunca atribui responsável", () => {
    const decisao = pickAssignee([candidato({ userId: "a" })], {
      strategy: "manual",
    });
    expect(decisao.userId).toBeNull();
    expect(decisao.notifyCandidates).toEqual([]);
  });

  it("rodízio avança para o próximo vendedor da fila", () => {
    const pool = [
      candidato({ userId: "a", createdAtMs: 1 }),
      candidato({ userId: "b", createdAtMs: 2 }),
      candidato({ userId: "c", createdAtMs: 3 }),
    ];
    expect(
      pickAssignee(pool, { strategy: "round_robin", lastAssignedUserId: "a" })
        .userId,
    ).toBe("b");
    expect(
      pickAssignee(pool, { strategy: "round_robin", lastAssignedUserId: "c" })
        .userId,
    ).toBe("a");
    // Sem ponteiro anterior, começa no primeiro.
    expect(pickAssignee(pool, { strategy: "round_robin" }).userId).toBe("a");
  });

  it("menor carga escolhe quem tem menos conversas ativas", () => {
    const decisao = pickAssignee(
      [
        candidato({ userId: "a", activeConversations: 5 }),
        candidato({ userId: "b", activeConversations: 1 }),
        candidato({ userId: "c", activeConversations: 3 }),
      ],
      { strategy: "least_active" },
    );
    expect(decisao.userId).toBe("b");
  });

  it("primeiro disponível notifica todos sem atribuir", () => {
    const decisao = pickAssignee(
      [candidato({ userId: "a" }), candidato({ userId: "b" })],
      { strategy: "first_available" },
    );
    expect(decisao.userId).toBeNull();
    expect(decisao.notifyCandidates).toEqual(["a", "b"]);
  });

  it("não atribui a usuário desativado, offline ou acima do limite", () => {
    const pool = [
      candidato({ userId: "desativado", isActive: false }),
      candidato({ userId: "offline", availabilityStatus: "offline" }),
      candidato({
        userId: "lotado",
        activeConversations: 20,
        maxConcurrentConversations: 20,
      }),
      candidato({ userId: "valido" }),
    ];
    const elegiveis = eligibleCandidates(pool, { strategy: "least_active" });
    expect(elegiveis.map((c) => c.userId)).toEqual(["valido"]);
  });

  it("aceita vendedor ausente quando a regra não exige estar online", () => {
    const pool = [candidato({ userId: "ausente", availabilityStatus: "away" })];
    expect(
      pickAssignee(pool, {
        strategy: "least_active",
        configuration: { requireOnline: false },
      }).userId,
    ).toBe("ausente");
  });

  it("filtra por equipe quando a estratégia é por setor", () => {
    const pool = [
      candidato({ userId: "vendas", teamIds: ["t-vendas"] }),
      candidato({ userId: "suporte", teamIds: ["t-suporte"] }),
    ];
    const decisao = pickAssignee(pool, {
      strategy: "team_based",
      teamId: "t-suporte",
    });
    expect(decisao.userId).toBe("suporte");
    expect(decisao.teamId).toBe("t-suporte");
  });

  it("a regra de reserva sai do setor quando ninguém do setor está livre", () => {
    const pool = [
      candidato({ userId: "suporte-offline", teamIds: ["t-suporte"], availabilityStatus: "offline" }),
      candidato({ userId: "vendas-online", teamIds: ["t-vendas"] }),
    ];
    const decisao = pickAssignee(pool, {
      strategy: "team_based",
      teamId: "t-suporte",
      configuration: { requireOnline: true, fallbackStrategy: "least_active" },
    });
    expect(decisao.userId).toBe("vendas-online");
    // A equipe de origem continua registrada na conversa.
    expect(decisao.teamId).toBe("t-suporte");
    expect(decisao.reason).toContain("reserva");
  });

  it("a reserva não atribui a quem está offline ou lotado", () => {
    const pool = [
      candidato({ userId: "offline", teamIds: ["t-vendas"], availabilityStatus: "offline" }),
      candidato({
        userId: "lotado",
        teamIds: ["t-vendas"],
        activeConversations: 20,
        maxConcurrentConversations: 20,
      }),
    ];
    const decisao = pickAssignee(pool, {
      strategy: "team_based",
      teamId: "t-suporte",
      configuration: { requireOnline: true, fallbackStrategy: "least_active" },
    });
    expect(decisao.userId).toBeNull();
  });

  it("deixa na fila quando não há candidato elegível", () => {
    const decisao = pickAssignee([], { strategy: "least_active" });
    expect(decisao.userId).toBeNull();
    expect(decisao.reason).toContain("Nenhum vendedor disponível");
  });
});

describe("seleção de regra", () => {
  const regras: RuleLike[] = [
    {
      id: "suporte",
      strategy: "team_based",
      teamId: "t-suporte",
      priority: 10,
      isActive: true,
      configuration: { keywords: ["defeito", "garantia"] },
    },
    {
      id: "geral",
      strategy: "least_active",
      teamId: null,
      priority: 50,
      isActive: true,
      configuration: {},
    },
    {
      id: "inativa",
      strategy: "manual",
      teamId: null,
      priority: 1,
      isActive: false,
      configuration: {},
    },
  ];

  it("prioriza a regra de menor prioridade cujos filtros casam", () => {
    expect(selectRule(regras, { messageText: "produto com defeito" })?.id).toBe(
      "suporte",
    );
  });

  it("cai na regra geral quando a palavra-chave não bate", () => {
    expect(selectRule(regras, { messageText: "quero um orçamento" })?.id).toBe(
      "geral",
    );
  });

  it("ignora regras inativas mesmo com prioridade menor", () => {
    expect(selectRule(regras, {})?.id).not.toBe("inativa");
  });
});

describe("permissões", () => {
  it("administrador tem acesso completo", () => {
    const admin = auth({ role: "admin" });
    expect(can(admin, "users.manage")).toBe(true);
    expect(can(admin, "integrations.manage")).toBe(true);
    expect(can(admin, "conversations.view_all")).toBe(true);
    expect(conversationScopeOf(admin)).toEqual({ kind: "all" });
  });

  it("supervisor não gerencia integrações nem usuários", () => {
    const supervisor = auth({ role: "supervisor", supervisedTeamIds: ["t1"] });
    expect(can(supervisor, "users.manage")).toBe(false);
    expect(can(supervisor, "integrations.manage")).toBe(false);
    expect(can(supervisor, "conversations.transfer")).toBe(true);
    expect(conversationScopeOf(supervisor)).toEqual({
      kind: "team",
      teamIds: ["t1"],
      userId: "u1",
    });
  });

  it("vendedor não vê conversas da empresa inteira nem configurações", () => {
    const vendedor = auth({ role: "seller", teamIds: ["t1"] });
    expect(can(vendedor, "conversations.view_all")).toBe(false);
    expect(can(vendedor, "organization.manage")).toBe(false);
    expect(can(vendedor, "contacts.view_full_phone")).toBe(false);
    expect(can(vendedor, "conversations.close")).toBe(true);
    expect(conversationScopeOf(vendedor)).toEqual({
      kind: "own",
      userId: "u1",
      teamIds: ["t1"],
    });
  });

  it("supervisor sem equipe atribuída cai no próprio escopo", () => {
    const supervisor = auth({ role: "supervisor" });
    expect(conversationScopeOf(supervisor)).toEqual({
      kind: "team",
      teamIds: [],
      userId: "u1",
    });
  });

  it("cada perfil tem um conjunto distinto de permissões", () => {
    expect(permissionsOf("admin").length).toBeGreaterThan(
      permissionsOf("supervisor").length,
    );
    expect(permissionsOf("supervisor").length).toBeGreaterThan(
      permissionsOf("seller").length,
    );
  });
});

describe("transições de status", () => {
  it("permite o caminho normal do atendimento", () => {
    expect(canTransition("unassigned", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "waiting_customer")).toBe(true);
    expect(canTransition("waiting_customer", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "closed")).toBe(true);
  });

  it("permite reabrir uma conversa encerrada", () => {
    expect(canTransition("closed", "in_progress")).toBe(true);
  });

  it("bloqueia transições sem sentido", () => {
    expect(canTransition("closed", "waiting_customer")).toBe(false);
    expect(canTransition("unassigned", "waiting_customer")).toBe(false);
  });

  it("aceita o mesmo status (operação idempotente)", () => {
    expect(canTransition("in_progress", "in_progress")).toBe(true);
  });
});

describe("respostas rápidas", () => {
  const variaveis = buildVariables({
    contactName: "Ana Ribeiro",
    contactPhone: "(11) 90000-0000",
    sellerName: "Caio",
    organizationName: "Distribuidora Modelo",
    businessHours: "Segunda a sexta, 08:00 às 18:00",
  });

  it("substitui todas as variáveis conhecidas", () => {
    const resultado = renderTemplate(
      "Olá, {{nome_cliente}}! Aqui é {{nome_vendedor}}, da {{nome_empresa}}.",
      variaveis,
    );
    expect(resultado).toBe(
      "Olá, Ana Ribeiro! Aqui é Caio, da Distribuidora Modelo.",
    );
  });

  it("usa o primeiro nome quando solicitado", () => {
    expect(renderTemplate("Oi, {{primeiro_nome_cliente}}!", variaveis)).toBe(
      "Oi, Ana!",
    );
  });

  it("mantém visível a variável sem valor, para o vendedor perceber", () => {
    const resultado = renderTemplate("Valor: {{preco_produto}}", variaveis);
    expect(resultado).toBe("Valor: {{preco_produto}}");
    expect(missingVariables("Valor: {{preco_produto}}", variaveis)).toEqual([
      "preco_produto",
    ]);
  });

  it("tolera espaços dentro das chaves", () => {
    expect(renderTemplate("Oi, {{ nome_cliente }}", variaveis)).toBe(
      "Oi, Ana Ribeiro",
    );
  });
});

describe("horário de funcionamento", () => {
  const horarios = { mon: [{ start: "08:00", end: "18:00" }], sun: [] };

  it("reconhece horário dentro do expediente", () => {
    // Segunda-feira, 10h no fuso de São Paulo (13h UTC).
    const dentro = new Date("2026-08-03T13:00:00Z");
    expect(isWithinBusinessHours(horarios, "America/Sao_Paulo", dentro)).toBe(true);
  });

  it("reconhece horário fora do expediente", () => {
    // Segunda-feira, 22h em São Paulo (01h UTC de terça).
    const fora = new Date("2026-08-04T01:00:00Z");
    expect(isWithinBusinessHours(horarios, "America/Sao_Paulo", fora)).toBe(false);
  });

  it("dia sem faixa configurada fica fora do expediente", () => {
    const domingo = new Date("2026-08-02T13:00:00Z");
    expect(isWithinBusinessHours(horarios, "America/Sao_Paulo", domingo)).toBe(
      false,
    );
  });

  it("sem configuração, considera atendimento 24 horas", () => {
    expect(isWithinBusinessHours({}, "America/Sao_Paulo")).toBe(true);
    expect(isWithinBusinessHours(null, "America/Sao_Paulo")).toBe(true);
    expect(describeBusinessHours(null)).toBe("Atendimento 24 horas");
  });

  it("suporta faixa que atravessa a meia-noite", () => {
    const noturno = { tue: [{ start: "22:00", end: "02:00" }] };
    // Terça, 23h em São Paulo.
    expect(
      isWithinBusinessHours(
        noturno,
        "America/Sao_Paulo",
        new Date("2026-08-05T02:00:00Z"),
      ),
    ).toBe(true);
  });
});

describe("telefone", () => {
  it("normaliza número nacional adicionando o DDI", () => {
    expect(normalizePhone("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizePhone("11987654321")).toBe("5511987654321");
    expect(normalizePhone("5511987654321")).toBe("5511987654321");
  });

  it("formata no padrão brasileiro", () => {
    expect(formatPhone("5511987654321")).toBe("+55 (11) 98765-4321");
    expect(formatPhone("551133334444")).toBe("+55 (11) 3333-4444");
  });

  it("mascara preservando DDI, DDD e os dois últimos dígitos", () => {
    const mascarado = maskPhone("5511987654321");
    expect(mascarado).toContain("+55 (11)");
    expect(mascarado).toContain("•");
    expect(mascarado.endsWith("21")).toBe(true);
    expect(mascarado).not.toContain("98765");
  });

  it("valida o comprimento do número", () => {
    expect(isValidPhone("5511987654321")).toBe(true);
    expect(isValidPhone("123")).toBe(false);
  });
});

describe("sanitização de logs", () => {
  it("oculta campos sensíveis em qualquer profundidade", () => {
    const limpo = sanitizeMetadata({
      usuario: "ana",
      password: "segredo123",
      integracao: { access_token: "EAAG123", apiKey: "abc", url: "https://x" },
    }) as Record<string, unknown>;

    expect(limpo.usuario).toBe("ana");
    expect(limpo.password).toBe("[oculto]");
    const integracao = limpo.integracao as Record<string, unknown>;
    expect(integracao.access_token).toBe("[oculto]");
    expect(integracao.apiKey).toBe("[oculto]");
    expect(integracao.url).toBe("https://x");
  });

  it("trunca textos muito longos", () => {
    const longo = "a".repeat(5000);
    expect(String(sanitizeMetadata(longo)).length).toBeLessThan(2100);
  });
});

describe("janela de atendimento e mídia", () => {
  it("considera a janela de 24 horas a partir da última mensagem do cliente", () => {
    expect(isWithinServiceWindow(new Date(Date.now() - 60_000))).toBe(true);
    expect(
      isWithinServiceWindow(new Date(Date.now() - 25 * 60 * 60 * 1000)),
    ).toBe(false);
    expect(isWithinServiceWindow(null)).toBe(false);
  });

  it("valida tipo e tamanho de mídia", () => {
    expect(validateMedia("image", "image/png", 1024).ok).toBe(true);
    expect(validateMedia("image", "image/gif", 1024).ok).toBe(false);
    expect(validateMedia("image", "image/png", 20 * 1024 * 1024).ok).toBe(false);
    expect(validateMedia("document", "application/pdf", 1024).ok).toBe(true);
  });
});

describe("privacidade na IA", () => {
  it("mascara CPF, CNPJ, e-mail e telefone antes de enviar ao modelo", () => {
    const texto = redact(
      "Meu CPF é 123.456.789-01, e-mail ana@exemplo.com e telefone (11) 98765-4321.",
    );
    expect(texto).toContain("[CPF oculto]");
    expect(texto).toContain("[e-mail oculto]");
    expect(texto).toContain("[telefone oculto]");
    expect(texto).not.toContain("123.456.789-01");
    expect(texto).not.toContain("ana@exemplo.com");
  });
});

describe("identificação do provedor no webhook", () => {
  /**
   * Regressão de uma falha de segurança real: o padrão era `mock` para
   * qualquer envelope não reconhecido. Como o provedor de demonstração aceita
   * eventos já normalizados e não verifica assinatura, o endpoint público
   * aceitava conversa forjada de qualquer origem — em produção inclusive.
   */
  it("reconhece o envelope da Cloud API", () => {
    expect(detectProvider({ object: "whatsapp_business_account", entry: [] }))
      .toBe("cloud_api");
  });

  it("reconhece o envelope da Evolution", () => {
    expect(detectProvider({ event: "messages.upsert", instance: "pricall" }))
      .toBe("evolution");
  });

  it("recusa envelope desconhecido em vez de cair na demonstração", () => {
    for (const payload of [{}, { foo: "bar" }, [], null, "texto", 42]) {
      expect(detectProvider(payload), JSON.stringify(payload)).toBeNull();
    }
  });

  it("só aceita o envelope de demonstração quando ele se declara", () => {
    // A rota ainda recusa este caminho em produção; aqui garantimos que ele
    // exige a marca `kind` em vez de servir de vala comum.
    expect(detectProvider({ kind: "message", content: "oi" })).toBe("mock");
    expect(detectProvider({ content: "oi" })).toBeNull();
  });
});

describe("autenticidade do webhook da Evolution", () => {
  /**
   * A Evolution não assina o corpo, então o segredo compartilhado é a única
   * prova de origem. Aceitamos cabeçalho e query string porque muitos painéis
   * do Evolution Manager não têm campo para cabeçalho personalizado.
   */
  const TOKEN = "token-de-teste-com-tamanho-razoavel";
  const provider = new EvolutionProvider({});
  const url = (query = "") =>
    new URL(`https://app.teste/api/webhooks/whatsapp${query}`);

  beforeEach(() => {
    vi.spyOn(env.evolution, "webhookToken", "get").mockReturnValue(TOKEN);
  });

  it("aceita o token no cabeçalho próprio", () => {
    const headers = new Headers({ "x-evolution-token": TOKEN });
    expect(provider.verifySignature("", headers, url())).toBe(true);
  });

  it("aceita o token como Bearer", () => {
    const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
    expect(provider.verifySignature("", headers, url())).toBe(true);
  });

  it("aceita o token na query string", () => {
    const headers = new Headers();
    expect(provider.verifySignature("", headers, url(`?token=${TOKEN}`))).toBe(true);
  });

  it("recusa token errado em qualquer um dos caminhos", () => {
    expect(
      provider.verifySignature("", new Headers({ "x-evolution-token": "errado" }), url()),
    ).toBe(false);
    expect(
      provider.verifySignature("", new Headers(), url("?token=errado")),
    ).toBe(false);
  });

  it("recusa quando não vem token nenhum", () => {
    expect(provider.verifySignature("", new Headers(), url())).toBe(false);
  });
});
