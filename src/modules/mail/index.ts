/**
 * Envio de e-mail transacional.
 *
 * Mesma estratégia do módulo de WhatsApp: uma interface, vários adaptadores.
 *   - `log`    → imprime no servidor. Padrão em desenvolvimento; nada sai.
 *   - `smtp`   → qualquer servidor SMTP, inclusive Gmail com Senha de App.
 *   - `resend` → API do Resend, para quando o volume crescer.
 *
 * Nenhuma credencial fica no código: tudo vem de variável de ambiente.
 */
import { env } from "@/lib/env";
import { describeError } from "@/lib/audit";

export type Email = {
  to: string;
  subject: string;
  /** Corpo em texto puro — sempre enviado, para clientes sem HTML. */
  text: string;
  html?: string;
};

export type SendMailResult =
  | { ok: true; provider: string; id?: string }
  | { ok: false; provider: string; message: string };

export interface MailProvider {
  readonly name: string;
  send(email: Email): Promise<SendMailResult>;
}

/* ------------------------------------------------------------------ *
 * Adaptador de desenvolvimento
 * ------------------------------------------------------------------ */

/** Não envia nada: registra no servidor para o fluxo poder ser testado. */
export class LogMailProvider implements MailProvider {
  readonly name = "log";

  async send(email: Email): Promise<SendMailResult> {
    console.info(
      [
        "",
        "──────────── E-MAIL (modo log, nada foi enviado) ────────────",
        `Para:     ${email.to}`,
        `Assunto:  ${email.subject}`,
        "",
        email.text,
        "─────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { ok: true, provider: this.name };
  }
}

/* ------------------------------------------------------------------ *
 * SMTP (Gmail, Google Workspace, Zoho, servidor próprio…)
 * ------------------------------------------------------------------ */

export class SmtpMailProvider implements MailProvider {
  readonly name = "smtp";

  async send(email: Email): Promise<SendMailResult> {
    const { host, port, user, password, secure } = env.mail.smtp;

    if (!host || !user || !password) {
      return {
        ok: false,
        provider: this.name,
        message: "Configuração SMTP incompleta (host, usuário ou senha).",
      };
    }

    try {
      const nodemailer = (await import("nodemailer")).default;
      const transporte = nodemailer.createTransport({
        host,
        port,
        // 465 usa TLS direto; 587 começa em texto e faz STARTTLS.
        secure: secure ?? port === 465,
        auth: { user, pass: password },
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });

      const info = await transporte.sendMail({
        from: env.mail.from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        replyTo: env.mail.replyTo,
      });

      return { ok: true, provider: this.name, id: info.messageId };
    } catch (error) {
      return {
        ok: false,
        provider: this.name,
        message: sanitizar(describeError(error)),
      };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Resend
 * ------------------------------------------------------------------ */

export class ResendMailProvider implements MailProvider {
  readonly name = "resend";

  async send(email: Email): Promise<SendMailResult> {
    const apiKey = env.mail.resendApiKey;
    if (!apiKey) {
      return {
        ok: false,
        provider: this.name,
        message: "RESEND_API_KEY não configurada.",
      };
    }

    try {
      const resposta = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: env.mail.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
          reply_to: env.mail.replyTo,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      const json = (await resposta.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };

      if (!resposta.ok) {
        return {
          ok: false,
          provider: this.name,
          message: sanitizar(json.message ?? `Erro HTTP ${resposta.status}.`),
        };
      }
      return { ok: true, provider: this.name, id: json.id };
    } catch (error) {
      return {
        ok: false,
        provider: this.name,
        message: sanitizar(describeError(error)),
      };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Fábrica e envio
 * ------------------------------------------------------------------ */

export function getMailProvider(): MailProvider {
  switch (env.mail.provider) {
    case "smtp":
      return new SmtpMailProvider();
    case "resend":
      return new ResendMailProvider();
    default:
      return new LogMailProvider();
  }
}

/**
 * Envia um e-mail. Nunca lança: uma falha de e-mail não pode derrubar o
 * cadastro de um usuário nem a redefinição de senha. O resultado é
 * registrado para o administrador ver no log.
 */
export async function sendMail(email: Email): Promise<SendMailResult> {
  const provider = getMailProvider();
  const resultado = await provider.send(email);

  if (!resultado.ok) {
    console.error(
      `[pricall] falha ao enviar e-mail (${resultado.provider}) para ${mascararEmail(email.to)}: ${resultado.message}`,
    );
  }
  return resultado;
}

/** Remove qualquer trecho que pareça credencial antes de registrar no log. */
function sanitizar(texto: string): string {
  return texto
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "[oculto]")
    .replace(/password[=:]\S+/gi, "password=[oculto]");
}

/** `fulano@empresa.com` → `f•••o@empresa.com` */
export function mascararEmail(email: string): string {
  const [usuario, dominio] = email.split("@");
  if (!dominio) return "[e-mail inválido]";
  if (usuario.length <= 2) return `${usuario[0] ?? ""}•••@${dominio}`;
  return `${usuario[0]}•••${usuario.at(-1)}@${dominio}`;
}

/* ------------------------------------------------------------------ *
 * Modelos
 * ------------------------------------------------------------------ */

function layout(titulo: string, corpo: string, botao?: { texto: string; url: string }) {
  const cor = "#16A34A";
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(titulo)}</title></head>
<body style="margin:0;padding:24px;background:#F8FAFC;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto">
    <tr><td style="padding-bottom:20px">
      <span style="display:inline-block;background:${cor};color:#fff;font-weight:700;font-size:15px;padding:8px 14px;border-radius:8px;letter-spacing:.5px">PRICALL</span>
    </td></tr>
    <tr><td style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px">
      <h1 style="margin:0 0 14px;font-size:19px;font-weight:600">${escapar(titulo)}</h1>
      <div style="font-size:15px;line-height:1.6;color:#334155">${corpo}</div>
      ${
        botao
          ? `<div style="margin-top:26px"><a href="${escapar(botao.url)}" style="display:inline-block;background:${cor};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:8px">${escapar(botao.texto)}</a></div>
             <p style="margin-top:18px;font-size:12px;color:#64748B;line-height:1.5">Se o botão não funcionar, copie e cole este endereço no navegador:<br><span style="color:#334155;word-break:break-all">${escapar(botao.url)}</span></p>`
          : ""
      }
    </td></tr>
    <tr><td style="padding-top:18px;font-size:12px;color:#64748B;line-height:1.5">
      Você recebeu este e-mail porque sua empresa usa o PRICALL para organizar
      os atendimentos no WhatsApp. Se não reconhece esta solicitação, ignore
      esta mensagem.
    </td></tr>
  </table>
</body></html>`;
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function emailRecuperacaoSenha(link: string, nome?: string): Email {
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  return {
    to: "",
    subject: "Redefinir sua senha do PRICALL",
    text: [
      saudacao,
      "",
      "Recebemos um pedido para redefinir a senha da sua conta no PRICALL.",
      "Acesse o endereço abaixo para escolher uma nova senha:",
      "",
      link,
      "",
      "O link vale por 1 hora e só pode ser usado uma vez.",
      "Se você não pediu a redefinição, ignore este e-mail — sua senha continua a mesma.",
    ].join("\n"),
    html: layout(
      "Redefinir sua senha",
      `<p style="margin:0 0 12px">${escapar(saudacao)}</p>
       <p style="margin:0">Recebemos um pedido para redefinir a senha da sua conta no PRICALL.
       O link vale por <strong>1 hora</strong> e só pode ser usado uma vez.</p>
       <p style="margin:12px 0 0">Se você não pediu a redefinição, ignore este e-mail — sua senha continua a mesma.</p>`,
      { texto: "Escolher nova senha", url: link },
    ),
  };
}

export function emailConvite(
  link: string,
  nome: string,
  empresa: string,
  convidadoPor: string,
): Email {
  return {
    to: "",
    subject: `${convidadoPor} convidou você para a central de atendimento da ${empresa}`,
    text: [
      `Olá, ${nome}!`,
      "",
      `${convidadoPor} criou um acesso para você na central de atendimento da ${empresa}, no PRICALL.`,
      "",
      "Defina sua senha e comece a atender:",
      link,
      "",
      "O convite vale por 7 dias.",
    ].join("\n"),
    html: layout(
      `Seu acesso à central da ${escapar(empresa)}`,
      `<p style="margin:0 0 12px">Olá, ${escapar(nome)}!</p>
       <p style="margin:0"><strong>${escapar(convidadoPor)}</strong> criou um acesso para você na
       central de atendimento da <strong>${escapar(empresa)}</strong>.</p>
       <p style="margin:12px 0 0">Defina sua senha para começar a atender. O convite vale por <strong>7 dias</strong>.</p>`,
      { texto: "Definir minha senha", url: link },
    ),
  };
}

export function emailSenhaRedefinida(nome: string, senhaTemporaria: string): Email {
  return {
    to: "",
    subject: "Sua senha do PRICALL foi redefinida",
    text: [
      `Olá, ${nome}!`,
      "",
      "Um administrador redefiniu a senha da sua conta no PRICALL.",
      "",
      `Senha temporária: ${senhaTemporaria}`,
      "",
      "Entre com ela e troque por uma senha sua no primeiro acesso.",
      "Todas as sessões abertas foram encerradas por segurança.",
    ].join("\n"),
    html: layout(
      "Sua senha foi redefinida",
      `<p style="margin:0 0 12px">Olá, ${escapar(nome)}!</p>
       <p style="margin:0">Um administrador redefiniu a senha da sua conta no PRICALL.</p>
       <p style="margin:16px 0;padding:14px;background:#F1F5F9;border-radius:8px;font-family:ui-monospace,monospace;font-size:17px;font-weight:700;letter-spacing:1px;text-align:center">${escapar(senhaTemporaria)}</p>
       <p style="margin:0">Entre com esta senha temporária e troque por uma sua no primeiro acesso.
       Todas as sessões abertas foram encerradas por segurança.</p>`,
      { texto: "Entrar no PRICALL", url: `${env.appUrl}/entrar` },
    ),
  };
}
