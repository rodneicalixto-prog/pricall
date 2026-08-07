/**
 * IA assistiva.
 *
 * Regras não negociáveis, aplicadas aqui e no prompt:
 *  - A IA nunca envia mensagem sozinha: só devolve sugestão para o vendedor
 *    revisar e confirmar.
 *  - Contexto mínimo: últimas mensagens da conversa, nome do cliente, nome da
 *    empresa e as respostas rápidas cadastradas. Nada de outros clientes.
 *  - Telefone e e-mail são mascarados antes de sair da aplicação.
 *  - O administrador pode desligar a IA por organização.
 */
import { env } from "@/lib/env";

export type AiMessage = {
  role: "contact" | "seller" | "system";
  content: string;
  at: Date;
};

export type AiContext = {
  organizationName: string;
  sellerName: string;
  contactName: string;
  /** Ordem cronológica; o serviço já limita a quantidade. */
  messages: AiMessage[];
  quickReplies: { title: string; content: string }[];
  businessHours?: string;
};

export type SuggestionResult = {
  text: string;
  /** `true` quando o modelo indicou não haver contexto suficiente. */
  insufficientContext: boolean;
  provider: string;
};

export type SummaryResult = {
  reason: string;
  request: string;
  importantInfo: string[];
  pending: string[];
  nextAction: string;
  provider: string;
};

export type ClassificationResult = {
  suggestedTags: string[];
  suggestedPriority: "low" | "normal" | "high" | "urgent";
  suggestedTeam?: string;
  suggestedClosingReason?: string;
  provider: string;
};

export interface AiProvider {
  readonly name: string;
  suggestReply(context: AiContext): Promise<SuggestionResult>;
  summarize(context: AiContext): Promise<SummaryResult>;
  classify(context: AiContext): Promise<ClassificationResult>;
}

/* ------------------------------------------------------------------ *
 * Privacidade: mascara dados sensíveis antes de enviar ao modelo
 * ------------------------------------------------------------------ */

export function redact(text: string): string {
  return text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF oculto]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[CNPJ oculto]")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, "[e-mail oculto]")
    .replace(/\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[telefone oculto]")
    .replace(/\b\d{13,19}\b/g, "[número oculto]");
}

const SYSTEM_PROMPT = `Você é um assistente de atendimento comercial no WhatsApp, integrado ao sistema PRICALL.

REGRAS OBRIGATÓRIAS:
- Escreva no idioma usado pelo cliente. Se ele escreve em português, responda em português do Brasil.
- Tom profissional, cordial e objetivo. Frases curtas, adequadas ao WhatsApp.
- NUNCA invente preços, prazos, condições comerciais, políticas de troca ou disponibilidade de produto. Se a informação não estiver no contexto, diga que vai confirmar.
- NUNCA cite dados de outros clientes.
- NUNCA prometa ações que a empresa não configurou.
- Não use conteúdo ofensivo, discriminatório ou constrangedor.
- Se o contexto for insuficiente para responder com segurança, comece a resposta exatamente com "[CONTEXTO_INSUFICIENTE]" e explique em uma frase o que falta.
- Sua saída é apenas uma SUGESTÃO. Um vendedor humano vai revisar antes de enviar.`;

/* ------------------------------------------------------------------ *
 * Provedor de demonstração (sem chamada externa)
 * ------------------------------------------------------------------ */

export class MockAiProvider implements AiProvider {
  readonly name = "mock";

  async suggestReply(context: AiContext): Promise<SuggestionResult> {
    const lastContact = [...context.messages]
      .reverse()
      .find((m) => m.role === "contact");

    if (!lastContact) {
      return {
        text: "Não há mensagem do cliente para responder ainda.",
        insufficientContext: true,
        provider: this.name,
      };
    }

    const first = context.contactName.split(" ")[0];
    const text = context.messages.length < 2
      ? `Olá, ${first}! Aqui é ${context.sellerName}, da ${context.organizationName}. Recebi sua mensagem e já vou verificar. Pode me contar um pouco mais sobre o que você precisa?`
      : `${first}, obrigado por aguardar. Entendi seu pedido e estou confirmando os detalhes internamente. Assim que tiver a informação exata, te retorno por aqui.`;

    return { text, insufficientContext: false, provider: this.name };
  }

  async summarize(context: AiContext): Promise<SummaryResult> {
    const contactMessages = context.messages.filter((m) => m.role === "contact");
    return {
      reason: contactMessages[0]?.content.slice(0, 160) ?? "Contato inicial.",
      request:
        contactMessages.at(-1)?.content.slice(0, 160) ??
        "Sem pedido explícito registrado.",
      importantInfo: [
        `Cliente: ${context.contactName}`,
        `${contactMessages.length} mensagem(ns) recebida(s).`,
      ],
      pending:
        context.messages.at(-1)?.role === "contact"
          ? ["Cliente aguarda resposta."]
          : [],
      nextAction:
        context.messages.at(-1)?.role === "contact"
          ? "Responder o cliente."
          : "Acompanhar o retorno do cliente.",
      provider: this.name,
    };
  }

  async classify(context: AiContext): Promise<ClassificationResult> {
    const text = context.messages
      .map((m) => m.content.toLowerCase())
      .join(" ");
    const suggestedTags: string[] = [];
    if (/or[çc]amento|pre[çc]o|valor|quanto custa/.test(text)) {
      suggestedTags.push("Orçamento");
    }
    if (/urgente|hoje|agora|imediato/.test(text)) suggestedTags.push("Urgente");
    if (/reclama|problema|defeito|n[aã]o funciona/.test(text)) {
      suggestedTags.push("Reclamação");
    }
    if (context.messages.length <= 2) suggestedTags.push("Novo cliente");

    const urgent = /urgente|agora|imediato/.test(text);
    return {
      suggestedTags,
      suggestedPriority: urgent
        ? "high"
        : suggestedTags.includes("Reclamação")
          ? "high"
          : "normal",
      provider: this.name,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Provedor Anthropic (Claude)
 * ------------------------------------------------------------------ */

export class AnthropicAiProvider implements AiProvider {
  readonly name = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = env.ai.model,
  ) {}

  private async call(
    userPrompt: string,
    maxTokens = env.ai.maxTokens,
  ): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      // Nunca propaga corpo bruto: pode conter eco do prompt.
      throw new Error(`Serviço de IA indisponível (HTTP ${response.status}).`);
    }
    const json = (await response.json()) as {
      content?: { type: string; text?: string }[];
    };
    return (json.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();
  }

  async suggestReply(context: AiContext): Promise<SuggestionResult> {
    const text = await this.call(
      `${renderContext(context)}

Escreva UMA sugestão de resposta para a última mensagem do cliente. Responda apenas com o texto da mensagem, sem aspas e sem comentários.`,
    );
    const insufficient = text.startsWith("[CONTEXTO_INSUFICIENTE]");
    return {
      text: insufficient ? text.replace("[CONTEXTO_INSUFICIENTE]", "").trim() : text,
      insufficientContext: insufficient,
      provider: this.name,
    };
  }

  async summarize(context: AiContext): Promise<SummaryResult> {
    const raw = await this.call(
      `${renderContext(context)}

Resuma o atendimento. Responda SOMENTE com JSON válido no formato:
{"reason":"","request":"","importantInfo":[],"pending":[],"nextAction":""}`,
      800,
    );
    const parsed = parseJson<Omit<SummaryResult, "provider">>(raw);
    return {
      reason: parsed?.reason ?? "Não foi possível resumir.",
      request: parsed?.request ?? "",
      importantInfo: parsed?.importantInfo ?? [],
      pending: parsed?.pending ?? [],
      nextAction: parsed?.nextAction ?? "",
      provider: this.name,
    };
  }

  async classify(context: AiContext): Promise<ClassificationResult> {
    const raw = await this.call(
      `${renderContext(context)}

Classifique o atendimento. Responda SOMENTE com JSON válido:
{"suggestedTags":[],"suggestedPriority":"low|normal|high|urgent","suggestedTeam":"","suggestedClosingReason":""}`,
      400,
    );
    const parsed = parseJson<Omit<ClassificationResult, "provider">>(raw);
    return {
      suggestedTags: parsed?.suggestedTags ?? [],
      suggestedPriority: parsed?.suggestedPriority ?? "normal",
      suggestedTeam: parsed?.suggestedTeam || undefined,
      suggestedClosingReason: parsed?.suggestedClosingReason || undefined,
      provider: this.name,
    };
  }
}

function renderContext(context: AiContext): string {
  const history = context.messages
    .map((m) => {
      const who =
        m.role === "contact"
          ? `Cliente (${context.contactName})`
          : m.role === "seller"
            ? `Vendedor (${context.sellerName})`
            : "Sistema";
      return `${who}: ${redact(m.content)}`;
    })
    .join("\n");

  const templates = context.quickReplies
    .slice(0, 12)
    .map((q) => `- ${q.title}: ${redact(q.content)}`)
    .join("\n");

  return [
    `Empresa: ${context.organizationName}`,
    `Vendedor: ${context.sellerName}`,
    `Cliente: ${context.contactName}`,
    context.businessHours ? `Horário de atendimento: ${context.businessHours}` : "",
    "",
    "Histórico da conversa (mais antigo primeiro):",
    history || "(sem mensagens)",
    "",
    templates ? `Respostas rápidas cadastradas pela empresa:\n${templates}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseJson<T>(raw: string): T | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

/** Retorna o provedor configurado; cai no mock quando não há chave. */
export function getAiProvider(): AiProvider {
  if (env.ai.provider === "anthropic" && env.ai.apiKey) {
    return new AnthropicAiProvider(env.ai.apiKey);
  }
  return new MockAiProvider();
}
