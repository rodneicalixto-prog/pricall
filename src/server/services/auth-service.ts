/**
 * Cadastro de empresa, login, recuperação de senha e sessões.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  loginAttempts,
  organizations,
  passwordResetTokens,
  users,
  type UserRole,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { DEFAULT_BUSINESS_HOURS } from "@/lib/business-hours";
import { env } from "@/lib/env";
import { errors } from "@/lib/errors";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  hashToken,
  revokeAllSessions,
  setSessionCookie,
} from "@/lib/auth/session";
import { normalizePhone } from "@/lib/phone";

export type RegisterInput = {
  organizationName: string;
  responsibleName: string;
  email: string;
  phone: string;
  password: string;
  segment: string;
  sellerCount: string;
  acceptedTerms: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function registerOrganization(input: RegisterInput) {
  if (!input.acceptedTerms) {
    throw errors.validation(
      "É necessário aceitar os termos de uso e a política de privacidade.",
    );
  }
  const passwordProblems = validatePasswordStrength(input.password);
  if (passwordProblems.length > 0) {
    throw errors.validation(passwordProblems.join(" "));
  }

  const db = await getDb();
  const email = input.email.trim().toLowerCase();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (existing.length > 0) {
    throw errors.conflict("Já existe uma conta com este e-mail.");
  }

  const slug = await uniqueSlug(input.organizationName);
  const passwordHash = await hashPassword(input.password);

  const [organization] = await db
    .insert(organizations)
    .values({
      name: input.organizationName.trim(),
      slug,
      segment: input.segment,
      timezone: "America/Sao_Paulo",
      businessHours: DEFAULT_BUSINESS_HOURS,
      status: "trial",
      branding: { primaryColor: "#16A34A", inboxName: "Central de atendimento" },
      settings: {
        aiEnabled: true,
        aiSummaryEnabled: true,
        demoMode: env.demoModeEnabled,
        slaFirstResponseMinutes: 10,
        slaStaleConversationMinutes: 30,
        assignOutsideBusinessHours: false,
        maskPhoneForSellers: false,
        dataRetentionDays: 365,
      },
    })
    .returning();

  const [admin] = await db
    .insert(users)
    .values({
      organizationId: organization.id,
      name: input.responsibleName.trim(),
      email,
      phone: input.phone ? normalizePhone(input.phone) : null,
      role: "admin",
      passwordHash,
      availabilityStatus: "online",
      isActive: true,
    })
    .returning();

  await seedOrganizationDefaults(organization.id, admin.id);

  await recordAudit({
    organizationId: organization.id,
    userId: admin.id,
    action: "organization.created",
    entityType: "organization",
    entityId: organization.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: {
      segmento: input.segment,
      vendedoresEstimados: input.sellerCount,
      aceiteTermos: true,
      aceiteEm: new Date().toISOString(),
    },
  });

  const session = await createSession({
    userId: admin.id,
    organizationId: organization.id,
    remember: false,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  await setSessionCookie(session.token, session.expiresAt);

  return { organization, user: admin };
}

/** Marcadores, respostas rápidas e regra de distribuição iniciais. */
async function seedOrganizationDefaults(organizationId: string, adminId: string) {
  const db = await getDb();
  const { tags, quickReplies, assignmentRules, kanbanBoards, kanbanColumns } =
    await import("@/db/schema");

  await db.insert(tags).values(
    [
      ["Novo cliente", "#2563EB"],
      ["Urgente", "#DC2626"],
      ["Orçamento", "#F59E0B"],
      ["Retornar depois", "#64748B"],
      ["Cliente recorrente", "#16A34A"],
      ["Suporte", "#0EA5E9"],
      ["Reclamação", "#DC2626"],
      ["Possível venda", "#166534"],
    ].map(([name, color]) => ({ organizationId, name, color })),
  );

  await db.insert(quickReplies).values([
    {
      organizationId,
      title: "Saudação inicial",
      shortcut: "/ola",
      content:
        "Olá, {{nome_cliente}}! Aqui é {{nome_vendedor}}, da {{nome_empresa}}. Como posso te ajudar hoje?",
      category: "Abertura",
      createdBy: adminId,
    },
    {
      organizationId,
      title: "Aguardar um instante",
      shortcut: "/aguarde",
      content:
        "{{primeiro_nome_cliente}}, só um instante que já verifico essa informação para você.",
      category: "Atendimento",
      createdBy: adminId,
    },
    {
      organizationId,
      title: "Horário de atendimento",
      shortcut: "/horario",
      content:
        "Nosso horário de atendimento é {{horario_atendimento}}. Fora desse período, respondemos assim que voltarmos.",
      category: "Informações",
      createdBy: adminId,
    },
    {
      organizationId,
      title: "Encerramento",
      shortcut: "/obrigado",
      content:
        "Obrigado pelo contato, {{primeiro_nome_cliente}}! Qualquer coisa é só chamar aqui. — {{nome_vendedor}}, {{nome_empresa}}",
      category: "Encerramento",
      createdBy: adminId,
    },
  ]);

  await db.insert(assignmentRules).values({
    organizationId,
    name: "Regra padrão",
    strategy: "manual",
    priority: 100,
    isActive: true,
    configuration: { requireOnline: true, fallbackStrategy: "manual" },
  });

  // Kanban pessoal inicial do administrador.
  const [board] = await db
    .insert(kanbanBoards)
    .values({
      organizationId,
      userId: adminId,
      name: "Meu funil",
      description: "Quadro pessoal de acompanhamento comercial.",
      position: 0,
    })
    .returning();

  await db.insert(kanbanColumns).values([
    { organizationId, boardId: board.id, name: "Novos", color: "#2563EB", position: 0 },
    { organizationId, boardId: board.id, name: "Em contato", color: "#F59E0B", position: 1 },
    { organizationId, boardId: board.id, name: "Proposta enviada", color: "#0EA5E9", position: 2 },
    { organizationId, boardId: board.id, name: "Fechado", color: "#16A34A", position: 3 },
  ]);
}

async function uniqueSlug(name: string): Promise<string> {
  const db = await getDb();
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "empresa";

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const found = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, candidate))
      .limit(1);
    if (found.length === 0) return candidate;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
}

/* ------------------------------------------------------------------ *
 * Login
 * ------------------------------------------------------------------ */

export type LoginInput = {
  email: string;
  password: string;
  remember?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function login(input: LoginInput) {
  const db = await getDb();
  const email = input.email.trim().toLowerCase();

  await assertNotLockedOut(email);

  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  const user = rows[0];

  // Mesmo sem usuário, gasta tempo semelhante para não vazar existência de conta.
  const valid = await verifyPassword(input.password, user?.passwordHash ?? null);

  if (!user || !valid || !user.isActive) {
    await db.insert(loginAttempts).values({
      identifier: email,
      ipAddress: input.ipAddress ?? null,
      successful: false,
    });
    await recordAudit({
      organizationId: user?.organizationId ?? null,
      userId: user?.id ?? null,
      action: "auth.login_failed",
      entityType: "user",
      entityId: user?.id ?? null,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: { email },
    });
    if (user && !user.isActive) {
      throw errors.forbidden(
        "Este usuário está desativado. Fale com o administrador da sua empresa.",
      );
    }
    throw errors.validation("E-mail ou senha incorretos.");
  }

  await db.insert(loginAttempts).values({
    identifier: email,
    ipAddress: input.ipAddress ?? null,
    successful: true,
  });

  // Rotação de sessão: nova sessão a cada login.
  const session = await createSession({
    userId: user.id,
    organizationId: user.organizationId,
    remember: input.remember,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  await setSessionCookie(session.token, session.expiresAt);

  await db
    .update(users)
    .set({ availabilityStatus: "online", lastActivityAt: new Date() })
    .where(eq(users.id, user.id));

  await recordAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { user, organizationId: user.organizationId };
}

async function assertNotLockedOut(email: string) {
  const db = await getDb();
  const windowStart = new Date(Date.now() - env.loginLockoutMinutes * 60_000);

  const recent = await db
    .select({ successful: loginAttempts.successful, createdAt: loginAttempts.createdAt })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, email),
        gt(loginAttempts.createdAt, windowStart),
      ),
    )
    .orderBy(desc(loginAttempts.createdAt))
    .limit(env.loginMaxAttempts + 1);

  // Um login bem-sucedido dentro da janela zera a contagem.
  const failuresSinceSuccess: typeof recent = [];
  for (const attempt of recent) {
    if (attempt.successful) break;
    failuresSinceSuccess.push(attempt);
  }

  if (failuresSinceSuccess.length >= env.loginMaxAttempts) {
    throw errors.rateLimited(
      `Muitas tentativas de acesso. Sua conta está bloqueada por ${env.loginLockoutMinutes} minutos.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Recuperação de senha
 * ------------------------------------------------------------------ */

/**
 * Cria um token de recuperação. A resposta ao usuário é sempre a mesma,
 * exista a conta ou não (evita enumeração de e-mails).
 * Em ambiente sem provedor de e-mail configurado, o token é logado no
 * servidor para permitir o teste do fluxo.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      organizationId: users.organizationId,
      isActive: users.isActive,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  const user = rows[0];
  if (!user || !user.isActive) return;

  const token = randomBytes(32).toString("base64url");
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  await recordAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "auth.password_reset_requested",
    entityType: "user",
    entityId: user.id,
  });

  const link = `${env.appUrl}/redefinir-senha?token=${token}`;
  const { emailRecuperacaoSenha, sendMail } = await import("@/modules/mail");

  // Falha de e-mail não muda a resposta ao usuário: manter o retorno idêntico
  // exista ou não a conta é o que evita enumeração de e-mails cadastrados.
  await sendMail({ ...emailRecuperacaoSenha(link, user.name), to: normalized });
}

export async function resetPassword(token: string, newPassword: string) {
  const problems = validatePasswordStrength(newPassword);
  if (problems.length > 0) throw errors.validation(problems.join(" "));

  const db = await getDb();
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
    .limit(1);

  const record = rows[0];
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw errors.validation("Link de recuperação inválido ou expirado.");
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, record.userId));
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, record.id));

  // Troca de senha invalida todas as sessões abertas.
  await revokeAllSessions(record.userId);

  const [user] = await db
    .select({ organizationId: users.organizationId })
    .from(users)
    .where(eq(users.id, record.userId))
    .limit(1);

  await recordAudit({
    organizationId: user?.organizationId ?? null,
    userId: record.userId,
    action: "auth.password_reset_completed",
    entityType: "user",
    entityId: record.userId,
  });
}

export async function setAvailability(
  userId: string,
  status: "online" | "away" | "offline",
) {
  const db = await getDb();
  await db
    .update(users)
    .set({ availabilityStatus: status, lastActivityAt: new Date() })
    .where(eq(users.id, userId));
}

export type { UserRole };
