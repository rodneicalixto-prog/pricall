/**
 * Testes do módulo de e-mail: seleção de adaptador, modelos das mensagens,
 * mascaramento no log e comportamento em falha.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LogMailProvider,
  ResendMailProvider,
  SmtpMailProvider,
  emailConvite,
  emailRecuperacaoSenha,
  emailSenhaRedefinida,
  mascararEmail,
} from "@/modules/mail";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("adaptador de log", () => {
  it("não envia nada e reporta sucesso", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = new LogMailProvider();

    const resultado = await provider.send({
      to: "alguem@exemplo.test",
      subject: "Teste",
      text: "Corpo da mensagem",
    });

    expect(resultado.ok).toBe(true);
    expect(info).toHaveBeenCalled();
    // O corpo aparece no log para o fluxo poder ser testado sem provedor.
    expect(info.mock.calls[0][0]).toContain("Corpo da mensagem");
  });
});

describe("adaptador SMTP", () => {
  it("recusa quando a configuração está incompleta", async () => {
    vi.stubEnv("MAIL_SMTP_HOST", "");
    vi.stubEnv("MAIL_SMTP_USER", "");
    vi.stubEnv("MAIL_SMTP_PASSWORD", "");

    // `env` é lido no import; instanciar aqui usa a configuração vazia padrão.
    const resultado = await new SmtpMailProvider().send({
      to: "a@b.test",
      subject: "x",
      text: "y",
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.message).toMatch(/incompleta/i);
    }
  });
});

describe("adaptador Resend", () => {
  it("recusa sem chave de API", async () => {
    const resultado = await new ResendMailProvider().send({
      to: "a@b.test",
      subject: "x",
      text: "y",
    });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.message).toMatch(/RESEND_API_KEY/);
  });
});

describe("modelos de e-mail", () => {
  it("recuperação de senha traz o link em texto e em HTML", () => {
    const link = "https://app.teste/redefinir-senha?token=abc123";
    const email = emailRecuperacaoSenha(link, "Ana");

    expect(email.subject).toMatch(/senha/i);
    expect(email.text).toContain(link);
    expect(email.text).toContain("Ana");
    expect(email.html).toContain(link);
    // Aviso explícito de validade, para o usuário não tentar o link velho.
    expect(email.text).toMatch(/1 hora/);
  });

  it("convite identifica quem convidou e a empresa", () => {
    const email = emailConvite(
      "https://app.teste/convite?token=xyz",
      "Caio",
      "Distribuidora Modelo",
      "Renata Coelho",
    );

    expect(email.subject).toContain("Renata Coelho");
    expect(email.subject).toContain("Distribuidora Modelo");
    expect(email.text).toContain("Caio");
    expect(email.text).toContain("7 dias");
  });

  it("senha redefinida mostra a senha temporária", () => {
    const email = emailSenhaRedefinida("Aline", "Pri1a2b3c45");
    expect(email.text).toContain("Pri1a2b3c45");
    expect(email.html).toContain("Pri1a2b3c45");
  });

  it("escapa HTML nos valores vindos do usuário", () => {
    const email = emailConvite(
      "https://app.teste/convite?token=1",
      '<script>alert("x")</script>',
      "Empresa & Cia",
      "Fulano",
    );
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("Empresa &amp; Cia");
  });

  it("sempre inclui versão em texto puro", () => {
    for (const email of [
      emailRecuperacaoSenha("https://x.test/a"),
      emailConvite("https://x.test/b", "N", "E", "C"),
      emailSenhaRedefinida("N", "senha123"),
    ]) {
      expect(email.text.length).toBeGreaterThan(20);
      expect(email.text).not.toContain("<");
    }
  });
});

describe("mascaramento de e-mail no log", () => {
  it("preserva o domínio e esconde o usuário", () => {
    expect(mascararEmail("rodnei@empresa.com.br")).toBe("r•••i@empresa.com.br");
    expect(mascararEmail("ab@x.com")).toBe("a•••@x.com");
  });

  it("lida com entrada inválida sem quebrar", () => {
    expect(mascararEmail("sem-arroba")).toBe("[e-mail inválido]");
  });
});
