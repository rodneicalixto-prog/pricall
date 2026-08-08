/**
 * Fábrica de provedores de WhatsApp.
 *
 * As credenciais são resolvidas aqui, a partir de variáveis de ambiente ou de
 * um cofre. O banco guarda somente a *referência* (`token_reference`) — o
 * segredo em si nunca é persistido nem enviado ao frontend.
 */
import type { WhatsappConnection } from "@/db/schema";
import { env } from "@/lib/env";
import { CloudApiProvider } from "./cloud-api";
import { EvolutionProvider } from "./evolution";
import { MockWhatsappProvider } from "./mock";
import type { ProviderCredentials, WhatsappProvider } from "./provider";

export * from "./provider";
export { CloudApiProvider, EvolutionProvider, MockWhatsappProvider };

/**
 * Resolve um segredo a partir de sua referência.
 * Formatos aceitos:
 *   - `env:NOME_DA_VARIAVEL`  → lê de process.env
 *   - `default`               → usa a credencial padrão do ambiente
 */
export function resolveSecret(reference: string | null | undefined): string | undefined {
  if (!reference) return undefined;
  if (reference.startsWith("env:")) {
    const name = reference.slice(4).trim();
    // Só variáveis com prefixo conhecido, para não expor o ambiente inteiro.
    if (!/^(WHATSAPP|EVOLUTION)_[A-Z0-9_]+$/.test(name)) return undefined;
    const value = process.env[name];
    return value && value.trim().length > 0 ? value.trim() : undefined;
  }
  return undefined;
}

export function credentialsFor(
  connection: Pick<
    WhatsappConnection,
    | "provider"
    | "phoneNumberId"
    | "whatsappBusinessAccountId"
    | "apiBaseUrl"
    | "instanceName"
    | "tokenReference"
    | "webhookSecretReference"
  >,
): ProviderCredentials {
  if (connection.provider === "cloud_api") {
    return {
      accessToken:
        resolveSecret(connection.tokenReference) ?? env.whatsapp.accessToken,
      phoneNumberId: connection.phoneNumberId ?? env.whatsapp.phoneNumberId,
      businessAccountId:
        connection.whatsappBusinessAccountId ?? env.whatsapp.businessAccountId,
      appSecret:
        resolveSecret(connection.webhookSecretReference) ??
        env.whatsapp.appSecret,
      verifyToken: env.whatsapp.verifyToken,
    };
  }
  if (connection.provider === "evolution") {
    return {
      apiBaseUrl: connection.apiBaseUrl ?? env.evolution.baseUrl,
      instanceName: connection.instanceName ?? env.evolution.instance,
      apiKey: resolveSecret(connection.tokenReference) ?? env.evolution.apiKey,
    };
  }
  return {};
}

export function providerFor(
  connection: Pick<
    WhatsappConnection,
    | "provider"
    | "phoneNumberId"
    | "whatsappBusinessAccountId"
    | "apiBaseUrl"
    | "instanceName"
    | "tokenReference"
    | "webhookSecretReference"
  >,
): WhatsappProvider {
  const credentials = credentialsFor(connection);
  switch (connection.provider) {
    case "cloud_api":
      return new CloudApiProvider(credentials);
    case "evolution":
      return new EvolutionProvider(credentials);
    default:
      return new MockWhatsappProvider();
  }
}

/** Provedor usado para interpretar um webhook antes de conhecer a conexão. */
/**
 * Identifica o provedor pelo formato do envelope recebido no webhook. Devolve
 * `null` quando não reconhece.
 *
 * O padrão aqui já foi `mock`, e isso era uma falha de segurança: o provedor
 * de demonstração aceita eventos já normalizados e não verifica assinatura
 * nenhuma, então qualquer envelope estranho — de qualquer origem na internet —
 * entrava por ele. Formato desconhecido agora é recusado pela rota.
 */
export function detectProvider(
  payload: unknown,
): "cloud_api" | "evolution" | "mock" | null {
  if (!payload || typeof payload !== "object") return null;
  if ("object" in payload && "entry" in payload) return "cloud_api";
  if ("event" in payload && "instance" in payload) return "evolution";
  // Envelope já normalizado: existe só em demonstração, e a rota recusa este
  // caminho em produção.
  if ("kind" in payload) return "mock";
  return null;
}

export function providerByName(
  name: "mock" | "cloud_api" | "evolution",
  credentials: ProviderCredentials = {},
): WhatsappProvider {
  switch (name) {
    case "cloud_api":
      return new CloudApiProvider(credentials);
    case "evolution":
      return new EvolutionProvider(credentials);
    default:
      return new MockWhatsappProvider();
  }
}
