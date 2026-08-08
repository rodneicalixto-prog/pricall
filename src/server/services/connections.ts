/**
 * Conexões de WhatsApp: número principal da empresa, números por setor,
 * números individuais de vendedores e ramais.
 *
 * O segredo nunca é gravado: apenas a referência (`env:NOME_DA_VARIAVEL`).
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  conversations,
  integrationEvents,
  messages,
  organizations,
  teams,
  users,
  whatsappConnections,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";
import { errors } from "@/lib/errors";
import { publish } from "@/lib/realtime/bus";
import { providerFor, resolveSecret } from "@/modules/whatsapp";
import { daysAgo } from "./team";

export async function listConnections(auth: AuthContext) {
  requirePermission(auth, "integrations.view");
  const db = await getDb();

  const rows = await db
    .select({
      id: whatsappConnections.id,
      label: whatsappConnections.label,
      provider: whatsappConnections.provider,
      scope: whatsappConnections.scope,
      teamId: whatsappConnections.teamId,
      teamName: teams.name,
      ownerUserId: whatsappConnections.ownerUserId,
      ownerName: users.name,
      extension: whatsappConnections.extension,
      displayPhoneNumber: whatsappConnections.displayPhoneNumber,
      phoneNumberId: whatsappConnections.phoneNumberId,
      instanceName: whatsappConnections.instanceName,
      apiBaseUrl: whatsappConnections.apiBaseUrl,
      status: whatsappConnections.status,
      webhookVerified: whatsappConnections.webhookVerified,
      isDemo: whatsappConnections.isDemo,
      isDefault: whatsappConnections.isDefault,
      lastWebhookAt: whatsappConnections.lastWebhookAt,
      lastErrorAt: whatsappConnections.lastErrorAt,
      lastErrorMessage: whatsappConnections.lastErrorMessage,
      /** Indica se o segredo referenciado está presente no ambiente. */
      tokenReference: whatsappConnections.tokenReference,
    })
    .from(whatsappConnections)
    .leftJoin(teams, eq(teams.id, whatsappConnections.teamId))
    .leftJoin(users, eq(users.id, whatsappConnections.ownerUserId))
    .where(eq(whatsappConnections.organizationId, auth.organizationId))
    .orderBy(desc(whatsappConnections.isDefault), whatsappConnections.label);

  // Nunca devolve o segredo — só se ele está resolvido ou não.
  return rows.map(({ tokenReference, ...row }) => ({
    ...row,
    lastWebhookAt: row.lastWebhookAt?.toISOString() ?? null,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    secretReference: tokenReference,
    secretConfigured: Boolean(resolveSecret(tokenReference)),
  }));
}

export type CreateConnectionInput = {
  label: string;
  provider: "mock" | "cloud_api" | "evolution";
  scope: "organization" | "team" | "user";
  displayPhoneNumber: string;
  teamId?: string | null;
  ownerUserId?: string | null;
  extension?: string | null;
  phoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
  apiBaseUrl?: string | null;
  instanceName?: string | null;
  /** Referência ao segredo, no formato `env:WHATSAPP_ACCESS_TOKEN`. */
  tokenReference?: string | null;
  webhookSecretReference?: string | null;
  isDefault?: boolean;
};

export async function createConnection(
  auth: AuthContext,
  input: CreateConnectionInput,
) {
  requirePermission(auth, "integrations.manage");
  const db = await getDb();

  validateSecretReference(input.tokenReference);
  validateSecretReference(input.webhookSecretReference);

  if (input.scope === "team" && !input.teamId) {
    throw errors.validation("Escolha o setor deste número.");
  }
  if (input.scope === "user" && !input.ownerUserId) {
    throw errors.validation("Escolha o vendedor dono deste número.");
  }
  if (input.provider === "cloud_api" && !input.phoneNumberId) {
    throw errors.validation(
      "Informe o identificador do número (phone_number_id) da Cloud API.",
    );
  }
  if (input.provider === "evolution" && (!input.apiBaseUrl || !input.instanceName)) {
    throw errors.validation("Informe a URL e o nome da instância da Evolution.");
  }

  if (input.isDefault) await clearDefault(auth.organizationId);

  const [connection] = await db
    .insert(whatsappConnections)
    .values({
      organizationId: auth.organizationId,
      label: input.label.trim(),
      provider: input.provider,
      scope: input.scope,
      teamId: input.scope === "team" ? input.teamId! : null,
      ownerUserId: input.scope === "user" ? input.ownerUserId! : null,
      extension: input.extension?.trim() || null,
      displayPhoneNumber: input.displayPhoneNumber.trim(),
      phoneNumberId: input.phoneNumberId?.trim() || null,
      whatsappBusinessAccountId: input.whatsappBusinessAccountId?.trim() || null,
      apiBaseUrl: input.apiBaseUrl?.trim() || null,
      instanceName: input.instanceName?.trim() || null,
      tokenReference: input.tokenReference?.trim() || null,
      webhookSecretReference: input.webhookSecretReference?.trim() || null,
      status: input.provider === "mock" ? "connected" : "pending",
      isDemo: input.provider === "mock",
      isDefault: input.isDefault ?? false,
    })
    .returning();

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "integration.connection_created",
    entityType: "whatsapp_connection",
    entityId: connection.id,
    metadata: {
      provedor: input.provider,
      alcance: input.scope,
      // A referência é registrada; o segredo, nunca.
      referenciaSegredo: input.tokenReference ?? null,
    },
  });

  return connection;
}

export async function updateConnection(
  auth: AuthContext,
  connectionId: string,
  input: Partial<CreateConnectionInput> & { status?: "connected" | "disabled" },
) {
  requirePermission(auth, "integrations.manage");
  const db = await getDb();

  validateSecretReference(input.tokenReference);
  validateSecretReference(input.webhookSecretReference);

  if (input.isDefault) await clearDefault(auth.organizationId);

  const [connection] = await db
    .update(whatsappConnections)
    .set({
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.displayPhoneNumber !== undefined
        ? { displayPhoneNumber: input.displayPhoneNumber.trim() }
        : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
      ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.extension !== undefined ? { extension: input.extension } : {}),
      ...(input.phoneNumberId !== undefined
        ? { phoneNumberId: input.phoneNumberId }
        : {}),
      ...(input.apiBaseUrl !== undefined ? { apiBaseUrl: input.apiBaseUrl } : {}),
      ...(input.instanceName !== undefined ? { instanceName: input.instanceName } : {}),
      ...(input.tokenReference !== undefined
        ? { tokenReference: input.tokenReference }
        : {}),
      ...(input.webhookSecretReference !== undefined
        ? { webhookSecretReference: input.webhookSecretReference }
        : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappConnections.id, connectionId),
        eq(whatsappConnections.organizationId, auth.organizationId),
      ),
    )
    .returning();

  if (!connection) throw errors.notFound("Conexão não encontrada.");

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "integration.connection_updated",
    entityType: "whatsapp_connection",
    entityId: connectionId,
    metadata: { campos: Object.keys(input) },
  });

  await publish(auth.organizationId, {
    type: "connection.status",
    connectionId,
    status: connection.status,
  });

  return connection;
}

async function clearDefault(organizationId: string) {
  const db = await getDb();
  await db
    .update(whatsappConnections)
    .set({ isDefault: false })
    .where(eq(whatsappConnections.organizationId, organizationId));
}

function validateSecretReference(reference?: string | null) {
  if (!reference) return;
  if (!reference.startsWith("env:")) {
    throw errors.validation(
      'A referência ao segredo deve usar o formato "env:NOME_DA_VARIAVEL". O token em si nunca é armazenado.',
    );
  }
  const name = reference.slice(4).trim();
  if (!/^(WHATSAPP|EVOLUTION)_[A-Z0-9_]+$/.test(name)) {
    throw errors.validation(
      "O nome da variável deve começar com WHATSAPP_ ou EVOLUTION_ e usar apenas letras maiúsculas, números e sublinhado.",
    );
  }
}

/** Testa a conexão e atualiza o status registrado. */
export async function testConnection(auth: AuthContext, connectionId: string) {
  requirePermission(auth, "integrations.manage");
  const db = await getDb();

  const [connection] = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(
        eq(whatsappConnections.id, connectionId),
        eq(whatsappConnections.organizationId, auth.organizationId),
      ),
    )
    .limit(1);
  if (!connection) throw errors.notFound("Conexão não encontrada.");

  const provider = providerFor(connection);
  const check = await provider.checkConnection();

  await db
    .update(whatsappConnections)
    .set({
      status: check.ok ? "connected" : "error",
      lastErrorAt: check.ok ? null : new Date(),
      lastErrorMessage: check.ok ? null : check.detail,
      ...(check.displayPhoneNumber
        ? { displayPhoneNumber: check.displayPhoneNumber }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(whatsappConnections.id, connectionId));

  /**
   * Um número real conectado encerra a demonstração.
   *
   * O selo "Modo demonstração" avisa que nada na tela é de verdade — deixá-lo
   * aceso depois que a central começou a atender cliente é pior do que não
   * tê-lo: passa a mentir. Desligar aqui, e não num interruptor, evita
   * depender de alguém lembrar.
   */
  if (check.ok && !connection.isDemo) {
    await db
      .update(organizations)
      .set({
        settings: sql`coalesce(${organizations.settings}, '{}'::jsonb) || '{"demoMode": false}'::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizations.id, auth.organizationId),
          // Só escreve quando ainda está ligado, para não sujar o updatedAt.
          sql`coalesce(${organizations.settings} ->> 'demoMode', 'false') = 'true'`,
        ),
      );
  }

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "integration.connection_tested",
    entityType: "whatsapp_connection",
    entityId: connectionId,
    metadata: { resultado: check.ok ? "ok" : "falha", detalhe: check.detail },
  });

  await publish(auth.organizationId, {
    type: "connection.status",
    connectionId,
    status: check.ok ? "connected" : "error",
  });

  return check;
}

/* ------------------------------------------------------------------ *
 * Painel de integridade
 * ------------------------------------------------------------------ */

export async function getHealthDashboard(auth: AuthContext) {
  requirePermission(auth, "health.view");
  const db = await getDb();
  const since = daysAgo(7);

  const connections = await listConnections(auth);

  const [eventStats] = await db
    .select({
      received: sql<number>`count(*)::int`,
      processed: sql<number>`count(*) filter (where ${integrationEvents.processingStatus} = 'processed')::int`,
      failed: sql<number>`count(*) filter (where ${integrationEvents.processingStatus} = 'failed')::int`,
      ignored: sql<number>`count(*) filter (where ${integrationEvents.processingStatus} = 'ignored')::int`,
      pending: sql<number>`count(*) filter (where ${integrationEvents.processingStatus} in ('received','processing'))::int`,
    })
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.organizationId, auth.organizationId),
        gte(integrationEvents.receivedAt, since),
      ),
    );

  const [messageStats] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${messages.direction} = 'outbound')::int`,
      delivered: sql<number>`count(*) filter (where ${messages.status} in ('delivered','read'))::int`,
      failed: sql<number>`count(*) filter (where ${messages.status} = 'failed')::int`,
      received: sql<number>`count(*) filter (where ${messages.direction} = 'inbound')::int`,
    })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, auth.organizationId),
        gte(messages.createdAt, since),
      ),
    );

  const recentErrors = await db
    .select({
      id: integrationEvents.id,
      provider: integrationEvents.provider,
      eventType: integrationEvents.eventType,
      errorMessage: integrationEvents.errorMessage,
      attemptCount: integrationEvents.attemptCount,
      receivedAt: integrationEvents.receivedAt,
      processingStatus: integrationEvents.processingStatus,
    })
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.organizationId, auth.organizationId),
        eq(integrationEvents.processingStatus, "failed"),
      ),
    )
    .orderBy(desc(integrationEvents.receivedAt))
    .limit(20);

  const openConversations = Number(
    await db.$count(
      conversations,
      and(
        eq(conversations.organizationId, auth.organizationId),
        sql`${conversations.status} <> 'closed'`,
      ),
    ),
  );

  return {
    connections,
    events: {
      received: Number(eventStats?.received ?? 0),
      processed: Number(eventStats?.processed ?? 0),
      failed: Number(eventStats?.failed ?? 0),
      ignored: Number(eventStats?.ignored ?? 0),
      pending: Number(eventStats?.pending ?? 0),
    },
    messages: {
      sent: Number(messageStats?.sent ?? 0),
      delivered: Number(messageStats?.delivered ?? 0),
      failed: Number(messageStats?.failed ?? 0),
      received: Number(messageStats?.received ?? 0),
    },
    openConversations,
    recentErrors: recentErrors.map((e) => ({
      ...e,
      receivedAt: e.receivedAt.toISOString(),
      // Mensagem já sanitizada na gravação; corta o tamanho para a UI.
      errorMessage: e.errorMessage?.slice(0, 300) ?? null,
    })),
  };
}

/** Conexão a ser usada por padrão ao criar conversas de demonstração. */
export async function getDefaultConnection(organizationId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(whatsappConnections)
    .where(eq(whatsappConnections.organizationId, organizationId))
    .orderBy(desc(whatsappConnections.isDefault), whatsappConnections.createdAt)
    .limit(1);
  return row ?? null;
}
