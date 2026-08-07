/**
 * Testes da limpeza de eventos do Sentry.
 *
 * Esta é a barreira que impede mensagem de cliente, telefone, senha e token
 * de saírem da aplicação junto com um relatório de erro. Se algum destes
 * testes falhar, há vazamento de dado pessoal para um serviço externo.
 */
import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { limparEvento } from "@/lib/observability";

function evento(parcial: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...parcial } as ErrorEvent;
}

describe("descarte de erros esperados", () => {
  it("não reporta erros de negócio previsíveis", () => {
    for (const code of [
      "unauthenticated",
      "forbidden",
      "validation",
      "not_found",
      "rate_limited",
      "conflict",
    ]) {
      const resultado = limparEvento(evento({}), {
        originalException: Object.assign(new Error("x"), { code }),
      });
      expect(resultado, `código ${code} deveria ser descartado`).toBeNull();
    }
  });

  it("reporta erro inesperado", () => {
    const resultado = limparEvento(evento({}), {
      originalException: new Error("falha de verdade"),
    });
    expect(resultado).not.toBeNull();
  });

  it("reporta erro interno, que indica defeito", () => {
    const resultado = limparEvento(evento({}), {
      originalException: Object.assign(new Error("x"), { code: "internal" }),
    });
    expect(resultado).not.toBeNull();
  });
});

describe("limpeza da requisição", () => {
  it("remove cookies e cabeçalhos de autenticação", () => {
    const resultado = limparEvento(
      evento({
        request: {
          url: "https://app.teste/api/conversations",
          cookies: { pricall_session: "token-secreto" },
          headers: {
            authorization: "Bearer abc123",
            cookie: "pricall_session=xyz",
            apikey: "chave-evolution",
            "x-evolution-token": "token-webhook",
            "user-agent": "Mozilla/5.0",
          },
        },
      }),
    );

    expect(resultado?.request?.cookies).toBeUndefined();
    expect(resultado?.request?.headers?.authorization).toBe("[oculto]");
    expect(resultado?.request?.headers?.cookie).toBe("[oculto]");
    expect(resultado?.request?.headers?.apikey).toBe("[oculto]");
    expect(resultado?.request?.headers?.["x-evolution-token"]).toBe("[oculto]");
    // Cabeçalho inofensivo é mantido: ajuda a diagnosticar.
    expect(resultado?.request?.headers?.["user-agent"]).toBe("Mozilla/5.0");
  });

  it("descarta o corpo inteiro nas rotas sensíveis", () => {
    const rotas = [
      "https://app.teste/api/auth/login",
      "https://app.teste/api/auth/reset-password",
      "https://app.teste/api/webhooks/whatsapp",
      "https://app.teste/api/connections",
      "https://app.teste/api/invite",
    ];

    for (const url of rotas) {
      const resultado = limparEvento(
        evento({
          request: {
            url,
            data: { password: "senha-real", token: "abc" },
            query_string: "token=segredo",
          },
        }),
      );
      expect(resultado?.request?.data, url).toBeUndefined();
      expect(resultado?.request?.query_string, url).toBe("[oculto]");
    }
  });
});

describe("limpeza de dados anexados", () => {
  it("oculta chaves sensíveis em extra, inclusive aninhadas", () => {
    const resultado = limparEvento(
      evento({
        extra: {
          conversationId: "abc-123",
          contato: { nome: "Ana", telefone: "5511987654321" },
          integracao: { apiKey: "chave", url: "https://x.test" },
          mensagem: "Bom dia, quero um orçamento",
        },
      }),
    );

    const extra = resultado?.extra as Record<string, unknown>;
    // Identificador técnico é preservado — é o que permite investigar.
    expect(extra.conversationId).toBe("abc-123");

    const contato = extra.contato as Record<string, unknown>;
    expect(contato.telefone).toBe("[oculto]");
    expect(contato.nome).toBe("Ana");

    const integracao = extra.integracao as Record<string, unknown>;
    expect(integracao.apiKey).toBe("[oculto]");
    expect(integracao.url).toBe("https://x.test");

    // Conteúdo de mensagem de cliente nunca sai da aplicação.
    expect(extra.mensagem).toBe("[oculto]");
  });

  it("oculta conteúdo de mensagem em qualquer nível", () => {
    const resultado = limparEvento(
      evento({
        extra: {
          nivel1: { nivel2: { content: "texto do cliente", text: "outro" } },
        },
      }),
    );
    const extra = resultado?.extra as Record<string, unknown>;
    const nivel2 = (extra.nivel1 as Record<string, unknown>)
      .nivel2 as Record<string, unknown>;
    expect(nivel2.content).toBe("[oculto]");
    expect(nivel2.text).toBe("[oculto]");
  });

  it("limita a profundidade para não travar em estrutura circular", () => {
    const profundo = { a: { b: { c: { d: { e: { f: { g: "fundo" } } } } } } };
    const resultado = limparEvento(evento({ extra: profundo }));
    expect(JSON.stringify(resultado?.extra)).toContain("profundidade máxima");
  });
});

describe("identificação do usuário", () => {
  it("mantém apenas id e perfil, sem nome, e-mail ou IP", () => {
    const resultado = limparEvento(
      evento({
        user: {
          id: "user-1",
          email: "vendedor@empresa.com",
          username: "Aline Prado",
          ip_address: "200.1.2.3",
          role: "seller",
        },
      }),
    );

    expect(resultado?.user).toEqual({ id: "user-1", role: "seller" });
    expect(resultado?.user?.email).toBeUndefined();
    expect(resultado?.user?.ip_address).toBeUndefined();
    expect(resultado?.user?.username).toBeUndefined();
  });
});

describe("migalhas de navegação", () => {
  it("sanitiza os dados anexados a cada migalha", () => {
    const resultado = limparEvento(
      evento({
        breadcrumbs: [
          {
            category: "fetch",
            data: { url: "/api/messages", body: "texto do cliente" },
          },
        ],
      }),
    );

    const migalha = resultado?.breadcrumbs?.[0];
    expect(migalha?.data?.body).toBe("[oculto]");
    expect(migalha?.data?.url).toBe("/api/messages");
  });
});

describe("evento sem dados sensíveis", () => {
  it("passa intacto", () => {
    const original = evento({
      request: { url: "https://app.teste/painel", method: "GET" },
      extra: { conversationId: "abc", tentativa: 2 },
    });
    const resultado = limparEvento(original);

    expect(resultado?.request?.url).toBe("https://app.teste/painel");
    expect((resultado?.extra as Record<string, unknown>).tentativa).toBe(2);
  });
});
