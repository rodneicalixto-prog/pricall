/**
 * Adaptador de demonstração.
 *
 * Simula envio, entrega, leitura e falha sem nenhuma credencial externa.
 * Todo registro criado por ele carrega `isDemo = true`, para nunca se
 * misturar com dados reais.
 */
import { randomUUID } from "node:crypto";
import type {
  ConnectionCheck,
  NormalizedEvent,
  OutboundMessage,
  SendResult,
  WhatsappProvider,
} from "./provider";
import { isWithinServiceWindow } from "./provider";

export type MockOptions = {
  /** Probabilidade (0–1) de o envio falhar, para exercitar o retry na UI. */
  failureRate?: number;
  /** Simula latência de rede em ms. */
  latencyMs?: number;
  channelKey?: string;
};

export class MockWhatsappProvider implements WhatsappProvider {
  readonly name = "mock" as const;
  private readonly options: Required<MockOptions>;

  constructor(options: MockOptions = {}) {
    this.options = {
      failureRate: options.failureRate ?? 0,
      latencyMs: options.latencyMs ?? 120,
      channelKey: options.channelKey ?? "demo",
    };
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (this.options.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.options.latencyMs));
    }

    if (!message.to || message.to.replace(/\D/g, "").length < 10) {
      return {
        ok: false,
        errorCode: "invalid_number",
        message: "Número de destino inválido.",
        retryable: false,
      };
    }

    if (Math.random() < this.options.failureRate) {
      return {
        ok: false,
        errorCode: "unavailable",
        message: "Falha simulada de envio (modo demonstração).",
        retryable: true,
      };
    }

    return {
      ok: true,
      whatsappMessageId: `demo.${randomUUID()}`,
      providerStatus: "accepted",
    };
  }

  parseWebhook(payload: unknown): NormalizedEvent[] {
    // No modo demonstração os eventos já chegam normalizados.
    if (!payload || typeof payload !== "object") return [];
    const candidate = payload as Partial<NormalizedEvent> & {
      timestamp?: string | Date;
    };
    if (candidate.kind !== "message" && candidate.kind !== "status") return [];
    return [
      {
        ...(candidate as NormalizedEvent),
        timestamp: candidate.timestamp
          ? new Date(candidate.timestamp)
          : new Date(),
      } as NormalizedEvent,
    ];
  }

  verifySignature(): boolean {
    // Em demonstração não há assinatura; o endpoint exige sessão autenticada.
    return true;
  }

  async checkConnection(): Promise<ConnectionCheck> {
    return {
      ok: true,
      detail: "Modo demonstração ativo. Nenhuma credencial externa em uso.",
      displayPhoneNumber: "+55 (11) 90000-0000",
    };
  }

  requiresTemplate(lastInboundAt: Date | null): boolean {
    // Mesma regra do provedor real, para o comportamento ser fiel.
    return !isWithinServiceWindow(lastInboundAt);
  }
}
