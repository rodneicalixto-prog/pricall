/**
 * Infraestrutura dos testes de integração.
 *
 * Cada arquivo de teste roda contra um banco PGlite próprio, criado em disco e
 * descartado no fim. Nada de mock de banco: o mesmo SQL de produção é exercido.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

let diretorioDados: string | null = null;

/** Prepara um banco isolado e aplica as migrações. Chame no `beforeAll`. */
export async function prepararBanco(): Promise<void> {
  diretorioDados = path.resolve(
    process.cwd(),
    `.pgdata-test/${randomUUID().slice(0, 8)}`,
  );
  // NODE_ENV é somente-leitura na tipagem do Node; atribuição via índice.
  (process.env as Record<string, string>).NODE_ENV = "test";
  process.env.DATABASE_DRIVER = "pglite";
  process.env.PGLITE_DATA_DIR = diretorioDados;
  process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-32-caracteres!!";
  process.env.DEMO_MODE_ENABLED = "true";

  await mkdir(diretorioDados, { recursive: true });

  const { runMigrations } = await import("@/db/migrate");
  await runMigrations();
}

/** Fecha a conexão e apaga o diretório do banco. Chame no `afterAll`. */
export async function limparBanco(): Promise<void> {
  const { closeDb } = await import("@/db");
  await closeDb();
  if (diretorioDados) {
    await rm(diretorioDados, { recursive: true, force: true }).catch(() => {});
    diretorioDados = null;
  }
}

/* ------------------------------------------------------------------ *
 * Construtores de dados
 * ------------------------------------------------------------------ */

export type Cenario = Awaited<ReturnType<typeof criarCenario>>;

/** Cria uma organização completa: admin, supervisor, dois vendedores, equipe e conexão. */
export async function criarCenario(sufixo = "a") {
  const { getDb } = await import("@/db");
  const schema = await import("@/db/schema");
  const { hashPassword } = await import("@/lib/auth/password");
  const { DEFAULT_BUSINESS_HOURS } = await import("@/lib/business-hours");
  const db = await getDb();

  const senha = await hashPassword("pricall123");

  const [organizacao] = await db
    .insert(schema.organizations)
    .values({
      name: `Empresa ${sufixo}`,
      slug: `empresa-${sufixo}-${randomUUID().slice(0, 6)}`,
      segment: "Testes",
      timezone: "America/Sao_Paulo",
      businessHours: DEFAULT_BUSINESS_HOURS,
      status: "active",
      settings: {
        aiEnabled: true,
        demoMode: true,
        slaStaleConversationMinutes: 30,
        assignOutsideBusinessHours: true,
        maskPhoneForSellers: false,
      },
      onboardingCompletedAt: new Date(),
    })
    .returning();

  const organizationId = organizacao.id;

  const [equipe] = await db
    .insert(schema.teams)
    .values({ organizationId, name: "Vendas" })
    .returning();

  const inserirUsuario = async (
    nome: string,
    papel: "admin" | "supervisor" | "seller",
  ) => {
    const [usuario] = await db
      .insert(schema.users)
      .values({
        organizationId,
        name: nome,
        email: `${nome.toLowerCase()}.${randomUUID().slice(0, 6)}@teste.local`,
        role: papel,
        passwordHash: senha,
        availabilityStatus: "online",
        isActive: true,
        lastActivityAt: new Date(),
      })
      .returning();
    return usuario;
  };

  const admin = await inserirUsuario("Admin", "admin");
  const supervisor = await inserirUsuario("Supervisor", "supervisor");
  const vendedor1 = await inserirUsuario("Vendedor1", "seller");
  const vendedor2 = await inserirUsuario("Vendedor2", "seller");

  await db.insert(schema.teamMembers).values([
    { organizationId, teamId: equipe.id, userId: supervisor.id, isSupervisor: true },
    { organizationId, teamId: equipe.id, userId: vendedor1.id },
    { organizationId, teamId: equipe.id, userId: vendedor2.id },
  ]);

  const instancia = `inst-${sufixo}-${randomUUID().slice(0, 6)}`;
  const [conexao] = await db
    .insert(schema.whatsappConnections)
    .values({
      organizationId,
      label: "Número de teste",
      provider: "mock",
      scope: "organization",
      displayPhoneNumber: "+55 (11) 3000-0000",
      instanceName: instancia,
      status: "connected",
      isDemo: true,
      isDefault: true,
    })
    .returning();

  await db.insert(schema.assignmentRules).values({
    organizationId,
    name: "Manual",
    strategy: "manual",
    priority: 100,
    isActive: true,
    configuration: { requireOnline: true },
  });

  const [marcador] = await db
    .insert(schema.tags)
    .values({ organizationId, name: "Urgente", color: "#DC2626" })
    .returning();

  return {
    organizationId,
    equipe,
    admin,
    supervisor,
    vendedor1,
    vendedor2,
    conexao,
    instancia,
    marcador,
    auth: (usuario: typeof admin, teamIds: string[] = [], supervisionadas: string[] = []) =>
      contextoAuth(usuario, teamIds, supervisionadas),
  };
}

/** Monta um AuthContext sem passar pelo login (atalho para os testes). */
export function contextoAuth(
  usuario: {
    id: string;
    organizationId: string;
    role: "admin" | "supervisor" | "seller";
    name: string;
    email: string;
  },
  teamIds: string[] = [],
  supervisedTeamIds: string[] = [],
) {
  return {
    userId: usuario.id,
    organizationId: usuario.organizationId,
    role: usuario.role,
    name: usuario.name,
    email: usuario.email,
    avatarUrl: null,
    sessionId: `sessao-${usuario.id}`,
    teamIds,
    supervisedTeamIds,
  };
}

/** Dispara um evento de mensagem recebida, como faria o webhook. */
export async function receberMensagem(
  instancia: string,
  telefone: string,
  texto: string,
  opcoes: { nome?: string; idExterno?: string; idMensagem?: string } = {},
) {
  const { ingestEvents } = await import("@/server/services/inbound");
  const idExterno = opcoes.idExterno ?? `evt.${randomUUID()}`;
  const idMensagem = opcoes.idMensagem ?? `msg.${randomUUID()}`;

  return ingestEvents(
    "mock",
    [
      {
        kind: "message",
        externalEventId: idExterno,
        channelKey: instancia,
        whatsappMessageId: idMensagem,
        from: telefone,
        contactName: opcoes.nome ?? "Cliente Teste",
        messageType: "text",
        text: texto,
        timestamp: new Date(),
      },
    ],
    { teste: true },
  );
}

/** Dispara uma atualização de status, como faria o webhook. */
export async function atualizarStatus(
  instancia: string,
  idMensagem: string,
  status: "sent" | "delivered" | "read" | "failed",
  idExterno?: string,
) {
  const { ingestEvents } = await import("@/server/services/inbound");
  return ingestEvents(
    "mock",
    [
      {
        kind: "status",
        externalEventId: idExterno ?? `evt.${randomUUID()}`,
        channelKey: instancia,
        whatsappMessageId: idMensagem,
        status,
        timestamp: new Date(),
      },
    ],
    { teste: true },
  );
}
