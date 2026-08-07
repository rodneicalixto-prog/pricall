/**
 * Testes de fluxo — os 13 cenários obrigatórios do escopo, na ordem,
 * mais os fluxos de integração (idempotência, ordem dos webhooks, mídia).
 *
 * Roda contra um Postgres real (PGlite embutido), sem mock de banco.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  atualizarStatus,
  criarCenario,
  limparBanco,
  prepararBanco,
  receberMensagem,
  type Cenario,
} from "./helpers";

let cenario: Cenario;

beforeAll(async () => {
  await prepararBanco();
  cenario = await criarCenario("fluxo");
}, 120_000);

afterAll(async () => {
  await limparBanco();
});

/* ------------------------------------------------------------------ *
 * Cenário completo, na ordem exigida pelo escopo
 * ------------------------------------------------------------------ */

describe("fluxo completo de atendimento", () => {
  const telefone = "5511970000001";
  let conversaId = "";
  let mensagemVendedorId = "";
  let whatsappMessageId = "";

  it("1. novo cliente envia mensagem e a conversa é criada", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    const resultado = await receberMensagem(
      cenario.instancia,
      telefone,
      "Bom dia! Vocês entregam na zona sul?",
      { nome: "Ana Ribeiro" },
    );
    expect(resultado.accepted).toBe(1);

    const [contato] = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, cenario.organizationId),
          eq(schema.contacts.whatsappId, telefone),
        ),
      );
    expect(contato).toBeDefined();
    expect(contato.name).toBe("Ana Ribeiro");

    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, contato.id));
    expect(conversa).toBeDefined();
    conversaId = conversa.id;
  });

  it("2. a conversa entra sem responsável e com uma mensagem não lida", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversaId));

    expect(conversa.assignedUserId).toBeNull();
    expect(conversa.status).toBe("unassigned");
    expect(conversa.unreadCount).toBe(1);
    expect(conversa.firstResponseAt).toBeNull();
  });

  it("3. o vendedor assume o atendimento", async () => {
    const { claimConversation } = await import("@/server/services/conversations");
    const auth = cenario.auth(cenario.vendedor1, [cenario.equipe.id]);

    const resultado = await claimConversation(auth, conversaId);
    expect(resultado.alreadyMine).toBe(false);

    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversaId));

    expect(conversa.assignedUserId).toBe(cenario.vendedor1.id);
    expect(conversa.status).toBe("in_progress");
    expect(conversa.assignedAt).not.toBeNull();
  });

  it("4. um segundo vendedor tenta assumir e é impedido", async () => {
    const { claimConversation } = await import("@/server/services/conversations");
    const auth = cenario.auth(cenario.vendedor2, [cenario.equipe.id]);

    await expect(claimConversation(auth, conversaId)).rejects.toThrow(
      /já foi assumido por outro vendedor/i,
    );

    // A atribuição original permanece intacta.
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversaId));
    expect(conversa.assignedUserId).toBe(cenario.vendedor1.id);
  });

  it("4b. assumir duas vezes em paralelo atribui a apenas um vendedor", async () => {
    const { claimConversation } = await import("@/server/services/conversations");
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    await receberMensagem(cenario.instancia, "5511970000099", "Concorrência", {
      nome: "Cliente Concorrente",
    });
    const [contato] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.whatsappId, "5511970000099"));
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, contato.id));

    const resultados = await Promise.allSettled([
      claimConversation(cenario.auth(cenario.vendedor1, [cenario.equipe.id]), conversa.id),
      claimConversation(cenario.auth(cenario.vendedor2, [cenario.equipe.id]), conversa.id),
    ]);

    const sucessos = resultados.filter((r) => r.status === "fulfilled");
    const falhas = resultados.filter((r) => r.status === "rejected");
    expect(sucessos).toHaveLength(1);
    expect(falhas).toHaveLength(1);
  });

  it("5. o vendedor responde e a mensagem é registrada", async () => {
    const { sendMessage } = await import("@/server/services/messages");
    const auth = cenario.auth(cenario.vendedor1, [cenario.equipe.id]);

    const resultado = await sendMessage(auth, {
      conversationId: conversaId,
      text: "Bom dia, Ana! Entregamos sim na zona sul.",
    });

    expect(resultado.delivery.ok).toBe(true);
    expect(resultado.message.status).toBe("sent");
    expect(resultado.message.direction).toBe("outbound");
    mensagemVendedorId = resultado.message.id;

    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();
    const [mensagem] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, mensagemVendedorId));
    whatsappMessageId = mensagem.whatsappMessageId!;
    expect(whatsappMessageId).toBeTruthy();

    // A primeira resposta é registrada para a métrica de SLA.
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversaId));
    expect(conversa.firstResponseAt).not.toBeNull();
    expect(conversa.unreadCount).toBe(0);
  });

  it("6. o webhook marca a mensagem como entregue e depois lida", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    await atualizarStatus(cenario.instancia, whatsappMessageId, "delivered");
    let [mensagem] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, mensagemVendedorId));
    expect(mensagem.status).toBe("delivered");
    expect(mensagem.deliveredAt).not.toBeNull();

    await atualizarStatus(cenario.instancia, whatsappMessageId, "read");
    [mensagem] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, mensagemVendedorId));
    expect(mensagem.status).toBe("read");
  });

  it("6b. status fora de ordem não retrocede o estado da mensagem", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    // `sent` chegando atrasado, depois de `read`, deve ser ignorado.
    await atualizarStatus(cenario.instancia, whatsappMessageId, "sent");
    const [mensagem] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, mensagemVendedorId));
    expect(mensagem.status).toBe("read");
  });

  it("7. o cliente responde e o contador de não lidas sobe", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    await receberMensagem(cenario.instancia, telefone, "Perfeito, qual o prazo?");

    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversaId));
    expect(conversa.unreadCount).toBe(1);
    expect(conversa.lastInboundAt).not.toBeNull();
  });

  it("8. o atendimento é transferido para outro vendedor", async () => {
    const { transferConversation } = await import("@/server/services/conversations");
    const auth = cenario.auth(cenario.vendedor1, [cenario.equipe.id]);

    await transferConversation(auth, {
      conversationId: conversaId,
      toUserId: cenario.vendedor2.id,
      reason: "Cliente da carteira do Vendedor2",
    });

    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversaId));
    expect(conversa.assignedUserId).toBe(cenario.vendedor2.id);

    // O histórico registra a transferência com o motivo.
    const eventos = await db
      .select()
      .from(schema.conversationEvents)
      .where(
        and(
          eq(schema.conversationEvents.conversationId, conversaId),
          eq(schema.conversationEvents.eventType, "transferred"),
        ),
      );
    expect(eventos).toHaveLength(1);
    expect(eventos[0].metadata?.motivo).toBe("Cliente da carteira do Vendedor2");
  });

  it("9. o novo responsável recebe notificação", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    const notificacoes = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, cenario.vendedor2.id),
          eq(schema.notifications.type, "transfer_received"),
        ),
      );
    expect(notificacoes.length).toBeGreaterThanOrEqual(1);
    expect(notificacoes[0].relatedConversationId).toBe(conversaId);
  });

  it("10. o atendimento é finalizado com resultado e retorno programado", async () => {
    const { closeConversation } = await import("@/server/services/conversations");
    const auth = cenario.auth(cenario.vendedor2, [cenario.equipe.id]);
    const retorno = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const resultado = await closeConversation(auth, {
      conversationId: conversaId,
      reason: "Orçamento enviado",
      outcome: "Venda encaminhada",
      note: "Cliente vai confirmar amanhã.",
      followupAt: retorno,
      followupNote: "Ligar para confirmar o pedido.",
    });

    expect(resultado.conversation.status).toBe("closed");
    expect(resultado.conversation.outcome).toBe("Venda encaminhada");
    expect(resultado.followup).not.toBeNull();
    expect(resultado.followup?.status).toBe("pending");
  });

  it("10b. encerrar exige motivo e resultado", async () => {
    const { closeConversation } = await import("@/server/services/conversations");
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();
    const auth = cenario.auth(cenario.vendedor1, [cenario.equipe.id]);

    await receberMensagem(cenario.instancia, "5511970000055", "Teste de validação");
    const [contato] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.whatsappId, "5511970000055"));
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, contato.id));

    await expect(
      closeConversation(auth, {
        conversationId: conversa.id,
        reason: "   ",
        outcome: "Cliente atendido",
      }),
    ).rejects.toThrow(/motivo/i);
  });

  it("11. nova mensagem do cliente reabre a conversa encerrada", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    await receberMensagem(
      cenario.instancia,
      telefone,
      "Oi! Mudei de ideia, quero fechar.",
    );

    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversaId));

    expect(conversa.status).not.toBe("closed");
    expect(conversa.closedAt).toBeNull();

    // Não foi criada uma segunda conversa para o mesmo contato.
    const todas = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, conversa.contactId));
    expect(todas).toHaveLength(1);

    const reaberturas = await db
      .select()
      .from(schema.conversationEvents)
      .where(
        and(
          eq(schema.conversationEvents.conversationId, conversaId),
          eq(schema.conversationEvents.eventType, "reopened"),
        ),
      );
    expect(reaberturas.length).toBeGreaterThanOrEqual(1);
  });

  it("12. falha de integração preserva a mensagem para reenvio", async () => {
    const { sendMessage, retryMessage } = await import("@/server/services/messages");
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();
    const auth = cenario.auth(cenario.vendedor2, [cenario.equipe.id]);

    // Força a falha: número de destino inválido no adaptador de demonstração.
    await db
      .update(schema.contacts)
      .set({ whatsappId: "123" })
      .where(eq(schema.contacts.phone, "5511970000001"));

    const falha = await sendMessage(auth, {
      conversationId: conversaId,
      text: "Mensagem que vai falhar",
    });

    expect(falha.delivery.ok).toBe(false);
    expect(falha.message.status).toBe("failed");
    expect(falha.message.content).toBe("Mensagem que vai falhar");
    expect(falha.message.failureReason).toBeTruthy();

    // O conteúdo continua no banco — nada é descartado.
    const [persistida] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, falha.message.id));
    expect(persistida.content).toBe("Mensagem que vai falhar");

    // Corrigido o destino, o reenvio funciona e não duplica registro.
    await db
      .update(schema.contacts)
      .set({ whatsappId: "5511970000001" })
      .where(eq(schema.contacts.phone, "5511970000001"));

    const reenvio = await retryMessage(auth, falha.message.id);
    expect(reenvio.delivery.ok).toBe(true);
    expect(reenvio.message.status).toBe("sent");

    const antiga = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, falha.message.id));
    expect(antiga).toHaveLength(0);
  });

  it("13. usuário de uma empresa não acessa dados de outra", async () => {
    const outra = await criarCenario("outra");
    const { assertConversationAccess, listConversations } = await import(
      "@/server/services/conversations"
    );

    // Um admin da outra empresa não enxerga esta conversa.
    const authOutra = outra.auth(outra.admin);
    await expect(
      assertConversationAccess(authOutra, conversaId),
    ).rejects.toThrow(/não encontrado/i);

    const lista = await listConversations(authOutra, { queue: "all" });
    expect(lista.items.every((i) => i.id !== conversaId)).toBe(true);

    // E o contrário também vale.
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();
    await receberMensagem(outra.instancia, "5511960000001", "Mensagem da outra empresa");
    const [contatoOutra] = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, outra.organizationId),
          eq(schema.contacts.whatsappId, "5511960000001"),
        ),
      );
    const [conversaOutra] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, contatoOutra.id));

    const authAqui = cenario.auth(cenario.admin);
    await expect(
      assertConversationAccess(authAqui, conversaOutra.id),
    ).rejects.toThrow(/não encontrado/i);
  });
});

/* ------------------------------------------------------------------ *
 * Idempotência e resiliência dos webhooks
 * ------------------------------------------------------------------ */

describe("idempotência dos webhooks", () => {
  it("o mesmo evento processado duas vezes não duplica a mensagem", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    const idExterno = "evento-repetido-001";
    const idMensagem = "msg-repetida-001";
    const telefone = "5511980000010";

    const primeira = await receberMensagem(
      cenario.instancia,
      telefone,
      "Mensagem duplicada",
      { idExterno, idMensagem },
    );
    expect(primeira.accepted).toBe(1);
    expect(primeira.duplicated).toBe(0);

    const segunda = await receberMensagem(
      cenario.instancia,
      telefone,
      "Mensagem duplicada",
      { idExterno, idMensagem },
    );
    expect(segunda.accepted).toBe(0);
    expect(segunda.duplicated).toBe(1);

    const mensagens = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.whatsappMessageId, idMensagem));
    expect(mensagens).toHaveLength(1);
  });

  it("evento com id externo novo mas mesma mensagem também não duplica", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    const idMensagem = "msg-repetida-002";
    const telefone = "5511980000011";

    await receberMensagem(cenario.instancia, telefone, "Texto", {
      idExterno: "evt-a",
      idMensagem,
    });
    await receberMensagem(cenario.instancia, telefone, "Texto", {
      idExterno: "evt-b",
      idMensagem,
    });

    const mensagens = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.whatsappMessageId, idMensagem));
    expect(mensagens).toHaveLength(1);
  });

  it("evento de canal desconhecido é ignorado sem erro", async () => {
    const resultado = await receberMensagem(
      "instancia-que-nao-existe",
      "5511980000012",
      "Mensagem órfã",
    );
    // O evento é aceito (registrado), mas não gera conversa.
    expect(resultado.failed).toBe(0);

    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();
    const contatos = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.whatsappId, "5511980000012"));
    expect(contatos).toHaveLength(0);
  });

  it("registra os eventos no log de integração para diagnóstico", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();

    const eventos = await db
      .select()
      .from(schema.integrationEvents)
      .where(eq(schema.integrationEvents.provider, "mock"));

    expect(eventos.length).toBeGreaterThan(0);
    expect(
      eventos.some((e) => e.processingStatus === "processed"),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Contato bloqueado e regras de envio
 * ------------------------------------------------------------------ */

describe("bloqueio de contato", () => {
  it("bloquear encerra as conversas abertas e impede o envio", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const { setContactBlocked } = await import("@/server/services/contacts");
    const { sendMessage } = await import("@/server/services/messages");
    const db = await getDb();

    const telefone = "5511980000020";
    await receberMensagem(cenario.instancia, telefone, "Promoção imperdível!!!");
    const [contato] = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, cenario.organizationId),
          eq(schema.contacts.whatsappId, telefone),
        ),
      );
    const [conversa] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, contato.id));

    const authAdmin = cenario.auth(cenario.admin);
    await setContactBlocked(authAdmin, contato.id, true, "Spam");

    const [depois] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversa.id));
    expect(depois.status).toBe("closed");

    await expect(
      sendMessage(authAdmin, { conversationId: conversa.id, text: "Oi" }),
    ).rejects.toThrow(/bloqueado/i);
  });

  it("mensagem de contato bloqueado não cria nova conversa", async () => {
    const { getDb } = await import("@/db");
    const schema = await import("@/db/schema");
    const db = await getDb();
    const telefone = "5511980000020";

    await receberMensagem(cenario.instancia, telefone, "Outra promoção");

    const [contato] = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, cenario.organizationId),
          eq(schema.contacts.whatsappId, telefone),
        ),
      );
    const conversas = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, contato.id));

    expect(conversas).toHaveLength(1);
    expect(conversas[0].status).toBe("closed");
  });
});
