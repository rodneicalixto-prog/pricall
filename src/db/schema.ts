/**
 * PRICALL — esquema do banco de dados (PostgreSQL / Supabase).
 *
 * Regra de ouro: toda tabela organizacional carrega `organization_id`.
 * O isolamento multiempresa é aplicado em duas camadas:
 *   1. Camada de dados (este arquivo + drizzle/policies.sql — RLS no Postgres).
 *   2. Camada de serviço (src/server/services/* — todo acesso passa por um
 *      `AuthContext` que injeta o organization_id do usuário autenticado).
 * Nunca confiar apenas em filtros do frontend.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const organizationStatus = pgEnum("organization_status", [
  "trial",
  "active",
  "suspended",
  "cancelled",
]);

export const userRole = pgEnum("user_role", ["admin", "supervisor", "seller"]);

export const availabilityStatus = pgEnum("availability_status", [
  "online",
  "away",
  "offline",
]);

export const connectionProvider = pgEnum("connection_provider", [
  "mock",
  "cloud_api",
  "evolution",
]);

export const connectionStatus = pgEnum("connection_status", [
  "pending",
  "connected",
  "error",
  "disabled",
]);

/** Alcance do número conectado: da empresa toda, de um setor, ou de um usuário. */
export const connectionScope = pgEnum("connection_scope", [
  "organization",
  "team",
  "user",
]);

export const conversationStatus = pgEnum("conversation_status", [
  "unassigned",
  "waiting",
  "in_progress",
  "waiting_customer",
  "scheduled",
  "closed",
]);

export const conversationPriority = pgEnum("conversation_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const senderType = pgEnum("sender_type", [
  "contact",
  "seller",
  "system",
  "ai",
]);

export const messageType = pgEnum("message_type", [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "location",
  "template",
  "system",
]);

export const messageDirection = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const messageStatus = pgEnum("message_status", [
  "received",
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
]);

export const followupStatus = pgEnum("followup_status", [
  "pending",
  "completed",
  "cancelled",
  "overdue",
]);

export const assignmentStrategy = pgEnum("assignment_strategy", [
  "manual",
  "round_robin",
  "least_active",
  "team_based",
  "first_available",
]);

export const integrationProcessingStatus = pgEnum(
  "integration_processing_status",
  ["received", "processing", "processed", "failed", "ignored"],
);

export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

export const calendarEventStatus = pgEnum("calendar_event_status", [
  "scheduled",
  "done",
  "cancelled",
]);

/* ------------------------------------------------------------------ *
 * Organizações
 * ------------------------------------------------------------------ */

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    segment: text("segment"),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    /** { mon: [{start:"08:00",end:"18:00"}], ... , holidays: [] } */
    businessHours: jsonb("business_hours")
      .$type<BusinessHours>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: organizationStatus("status").notNull().default("trial"),
    /** Personalização: cor principal, logo, nome da central, etc. */
    branding: jsonb("branding")
      .$type<OrganizationBranding>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Preferências gerais: IA habilitada, retenção de dados, SLA, etc. */
    settings: jsonb("settings")
      .$type<OrganizationSettings>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("organizations_slug_key").on(t.slug)],
);

/* ------------------------------------------------------------------ *
 * Usuários, sessões e autenticação
 * ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
    role: userRole("role").notNull().default("seller"),
    passwordHash: text("password_hash"),
    availabilityStatus: availabilityStatus("availability_status")
      .notNull()
      .default("offline"),
    isActive: boolean("is_active").notNull().default(true),
    /** Limite de atendimentos simultâneos usado pelas regras de distribuição. */
    maxConcurrentConversations: integer("max_concurrent_conversations")
      .notNull()
      .default(20),
    /** Horário de funcionamento individual (sobrepõe o da empresa quando definido). */
    businessHours: jsonb("business_hours").$type<BusinessHours | null>(),
    preferences: jsonb("preferences")
      .$type<UserPreferences>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    mfaSecret: text("mfa_secret"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_key").on(sql`lower(${t.email})`),
    index("users_organization_id_idx").on(t.organizationId),
    index("users_role_idx").on(t.organizationId, t.role),
    index("users_is_active_idx").on(t.organizationId, t.isActive),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** SHA-256 do token — o valor puro só existe no cookie do navegador. */
    tokenHash: text("token_hash").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

/** Tentativas de login/recuperação — usado para bloqueio temporário. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    ipAddress: text("ip_address"),
    successful: boolean("successful").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("login_attempts_identifier_idx").on(t.identifier, t.createdAt)],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("password_reset_tokens_hash_key").on(t.tokenHash)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("seller"),
    teamId: uuid("team_id"),
    tokenHash: text("token_hash").notNull(),
    status: invitationStatus("status").notNull().default("pending"),
    invitedBy: uuid("invited_by").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_key").on(t.tokenHash),
    index("invitations_organization_idx").on(t.organizationId, t.status),
  ],
);

/* ------------------------------------------------------------------ *
 * Equipes / setores
 * ------------------------------------------------------------------ */

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").notNull().default("#16A34A"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("teams_organization_id_idx").on(t.organizationId, t.isActive)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Supervisor do setor: enxerga a fila inteira daquele setor. */
    isSupervisor: boolean("is_supervisor").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("team_members_team_user_key").on(t.teamId, t.userId),
    index("team_members_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ *
 * Conexões de WhatsApp (números principais, por setor e ramais)
 * ------------------------------------------------------------------ */

export const whatsappConnections = pgTable(
  "whatsapp_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    provider: connectionProvider("provider").notNull().default("mock"),
    scope: connectionScope("scope").notNull().default("organization"),
    /** Número principal do setor, quando scope = 'team'. */
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** Número individual do vendedor, quando scope = 'user'. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Ramal de atendimento individualizado dentro do número principal. */
    extension: text("extension"),
    displayPhoneNumber: text("display_phone_number").notNull(),
    phoneNumberId: text("phone_number_id"),
    whatsappBusinessAccountId: text("whatsapp_business_account_id"),
    /** Endpoint da Evolution API, quando provider = 'evolution'. */
    apiBaseUrl: text("api_base_url"),
    instanceName: text("instance_name"),
    status: connectionStatus("status").notNull().default("pending"),
    /**
     * SOMENTE a referência ao segredo (ex.: nome da variável de ambiente ou
     * chave no cofre). Token em texto aberto nunca é persistido.
     */
    tokenReference: text("token_reference"),
    webhookVerified: boolean("webhook_verified").notNull().default(false),
    /** Segredo por conexão usado para validar a assinatura do webhook. */
    webhookSecretReference: text("webhook_secret_reference"),
    isDemo: boolean("is_demo").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("whatsapp_connections_org_idx").on(t.organizationId, t.status),
    uniqueIndex("whatsapp_connections_phone_number_id_key")
      .on(t.phoneNumberId)
      .where(sql`${t.phoneNumberId} is not null`),
    index("whatsapp_connections_owner_idx").on(t.ownerUserId),
    index("whatsapp_connections_team_idx").on(t.teamId),
  ],
);

/* ------------------------------------------------------------------ *
 * Contatos
 * ------------------------------------------------------------------ */

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    whatsappId: text("whatsapp_id").notNull(),
    phone: text("phone").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    companyName: text("company_name"),
    city: text("city"),
    source: text("source").notNull().default("whatsapp"),
    notes: text("notes"),
    profilePictureUrl: text("profile_picture_url"),
    isBlocked: boolean("is_blocked").notNull().default(false),
    blockedReason: text("blocked_reason"),
    isDemo: boolean("is_demo").notNull().default(false),
    firstContactAt: timestamp("first_contact_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("contacts_org_whatsapp_id_key").on(t.organizationId, t.whatsappId),
    index("contacts_org_phone_idx").on(t.organizationId, t.phone),
    index("contacts_org_name_idx").on(t.organizationId, t.name),
  ],
);

/** Registro de consentimentos (LGPD). */
export const contactConsents = pgTable(
  "contact_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    granted: boolean("granted").notNull(),
    source: text("source"),
    recordedBy: uuid("recorded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("contact_consents_contact_idx").on(t.contactId)],
);

/* ------------------------------------------------------------------ *
 * Conversas e mensagens
 * ------------------------------------------------------------------ */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    whatsappConnectionId: uuid("whatsapp_connection_id").references(
      () => whatsappConnections.id,
      { onDelete: "set null" },
    ),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedTeamId: uuid("assigned_team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    status: conversationStatus("status").notNull().default("unassigned"),
    priority: conversationPriority("priority").notNull().default("normal"),
    unreadCount: integer("unread_count").notNull().default(0),
    isFavorite: boolean("is_favorite").notNull().default(false),
    /** Recebida fora do horário de funcionamento. */
    outsideBusinessHours: boolean("outside_business_hours")
      .notNull()
      .default(false),
    isDemo: boolean("is_demo").notNull().default(false),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    closingReason: text("closing_reason"),
    outcome: text("outcome"),
    closingNote: text("closing_note"),
    /** Controle de concorrência otimista — incrementado a cada mutação. */
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversations_org_status_idx").on(t.organizationId, t.status),
    index("conversations_assigned_status_idx").on(t.assignedUserId, t.status),
    index("conversations_last_message_idx").on(
      t.organizationId,
      t.lastMessageAt,
    ),
    index("conversations_contact_idx").on(t.contactId),
    index("conversations_priority_idx").on(t.organizationId, t.priority),
    index("conversations_team_idx").on(t.assignedTeamId, t.status),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    whatsappMessageId: text("whatsapp_message_id"),
    senderType: senderType("sender_type").notNull(),
    senderUserId: uuid("sender_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    messageType: messageType("message_type").notNull().default("text"),
    content: text("content"),
    mediaUrl: text("media_url"),
    mediaMimeType: text("media_mime_type"),
    mediaFileName: text("media_file_name"),
    mediaSizeBytes: integer("media_size_bytes"),
    replyToMessageId: uuid("reply_to_message_id"),
    direction: messageDirection("direction").notNull(),
    status: messageStatus("status").notNull().default("queued"),
    failureReason: text("failure_reason"),
    /** Marca respostas que nasceram de uma sugestão da IA (auditoria). */
    aiSuggested: boolean("ai_suggested").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("messages_conversation_created_idx").on(
      t.conversationId,
      t.createdAt,
    ),
    uniqueIndex("messages_whatsapp_message_id_key")
      .on(t.whatsappMessageId)
      .where(sql`${t.whatsappMessageId} is not null`),
    index("messages_status_idx").on(t.organizationId, t.status),
    index("messages_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Marcadores
 * ------------------------------------------------------------------ */

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#16A34A"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("tags_org_name_key").on(t.organizationId, t.name)],
);

export const conversationTags = pgTable(
  "conversation_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("conversation_tags_conversation_tag_key").on(
      t.conversationId,
      t.tagId,
    ),
    index("conversation_tags_tag_idx").on(t.tagId),
  ],
);

/* ------------------------------------------------------------------ *
 * Respostas rápidas
 * ------------------------------------------------------------------ */

export const quickReplies = pgTable(
  "quick_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    shortcut: text("shortcut").notNull(),
    content: text("content").notNull(),
    category: text("category"),
    /** Vazio = liberado para todas as equipes. */
    allowedTeamIds: jsonb("allowed_team_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("quick_replies_org_shortcut_key").on(t.organizationId, t.shortcut),
    index("quick_replies_org_active_idx").on(t.organizationId, t.isActive),
  ],
);

/* ------------------------------------------------------------------ *
 * Agenda, lembretes e calendário
 * ------------------------------------------------------------------ */

export const scheduledFollowups = pgTable(
  "scheduled_followups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    note: text("note"),
    status: followupStatus("status").notNull().default("pending"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("scheduled_followups_user_status_idx").on(
      t.assignedUserId,
      t.status,
      t.scheduledAt,
    ),
    index("scheduled_followups_org_idx").on(t.organizationId, t.scheduledAt),
  ],
);

/** Agenda/calendário do vendedor — compromissos ligados ou não a uma conversa. */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: calendarEventStatus("status").notNull().default("scheduled"),
    remindMinutesBefore: integer("remind_minutes_before").default(30),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("calendar_events_user_start_idx").on(t.userId, t.startsAt),
    index("calendar_events_org_start_idx").on(t.organizationId, t.startsAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Kanban individual (ilimitado por usuário)
 * ------------------------------------------------------------------ */

export const kanbanBoards = pgTable(
  "kanban_boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Dono do quadro. Quadros são individuais por usuário, sem limite. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Quadro compartilhado com a equipe do dono (somente leitura). */
    isShared: boolean("is_shared").notNull().default(false),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("kanban_boards_user_idx").on(t.userId, t.position)],
);

export const kanbanColumns = pgTable(
  "kanban_columns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => kanbanBoards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#64748B"),
    position: integer("position").notNull().default(0),
    /** Ao mover um card para cá, aplicar este status na conversa vinculada. */
    appliesConversationStatus: conversationStatus("applies_conversation_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("kanban_columns_board_idx").on(t.boardId, t.position)],
);

export const kanbanCards = pgTable(
  "kanban_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => kanbanBoards.id, { onDelete: "cascade" }),
    columnId: uuid("column_id")
      .notNull()
      .references(() => kanbanColumns.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    notes: text("notes"),
    value: integer("value"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("kanban_cards_column_idx").on(t.columnId, t.position),
    unique("kanban_cards_board_conversation_key").on(
      t.boardId,
      t.conversationId,
    ),
  ],
);

/* ------------------------------------------------------------------ *
 * Notificações
 * ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    relatedConversationId: uuid("related_conversation_id").references(
      () => conversations.id,
      { onDelete: "cascade" },
    ),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_user_read_idx").on(t.userId, t.isRead, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Regras de distribuição
 * ------------------------------------------------------------------ */

export const assignmentRules = pgTable(
  "assignment_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Regra padrão"),
    strategy: assignmentStrategy("strategy").notNull().default("manual"),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    /** Menor número = avaliada primeiro. */
    priority: integer("priority").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    configuration: jsonb("configuration")
      .$type<AssignmentRuleConfiguration>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("assignment_rules_org_idx").on(
      t.organizationId,
      t.isActive,
      t.priority,
    ),
  ],
);

/** Ponteiro do rodízio (round robin) por organização/equipe. */
export const assignmentCursors = pgTable(
  "assignment_cursors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scopeKey: text("scope_key").notNull(),
    lastUserId: uuid("last_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("assignment_cursors_org_scope_key").on(t.organizationId, t.scopeKey),
  ],
);

/* ------------------------------------------------------------------ *
 * Eventos, auditoria e integrações
 * ------------------------------------------------------------------ */

export const conversationEvents = pgTable(
  "conversation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    previousValue: jsonb("previous_value").$type<Record<string, unknown>>(),
    newValue: jsonb("new_value").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversation_events_conversation_idx").on(
      t.conversationId,
      t.createdAt,
    ),
    index("conversation_events_org_type_idx").on(t.organizationId, t.eventType),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_action_idx").on(t.action),
  ],
);

export const integrationEvents = pgTable(
  "integration_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id"),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    processingStatus: integrationProcessingStatus("processing_status")
      .notNull()
      .default("received"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorMessage: text("error_message"),
    /** Payload sanitizado (sem tokens) para diagnóstico e reprocessamento. */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("integration_events_provider_external_key")
      .on(t.provider, t.externalEventId)
      .where(sql`${t.externalEventId} is not null`),
    index("integration_events_status_idx").on(
      t.processingStatus,
      t.receivedAt,
    ),
    index("integration_events_org_idx").on(t.organizationId, t.receivedAt),
  ],
);

/** Presença: quem está com a conversa aberta / digitando. */
export const conversationViewers = pgTable(
  "conversation_viewers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isTyping: boolean("is_typing").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("conversation_viewers_conversation_user_key").on(
      t.conversationId,
      t.userId,
    ),
    index("conversation_viewers_expires_idx").on(t.expiresAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Tipos auxiliares dos campos JSONB
 * ------------------------------------------------------------------ */

export type BusinessHoursDay = { start: string; end: string }[];

export type BusinessHours = Partial<{
  sun: BusinessHoursDay;
  mon: BusinessHoursDay;
  tue: BusinessHoursDay;
  wed: BusinessHoursDay;
  thu: BusinessHoursDay;
  fri: BusinessHoursDay;
  sat: BusinessHoursDay;
}>;

export type OrganizationBranding = Partial<{
  primaryColor: string;
  logoUrl: string;
  inboxName: string;
}>;

export type OrganizationSettings = Partial<{
  aiEnabled: boolean;
  aiSummaryEnabled: boolean;
  demoMode: boolean;
  slaFirstResponseMinutes: number;
  slaStaleConversationMinutes: number;
  assignOutsideBusinessHours: boolean;
  dataRetentionDays: number;
  maskPhoneForSellers: boolean;
}>;

export type UserPreferences = Partial<{
  theme: "light" | "dark" | "system";
  density: "compact" | "comfortable";
  fontScale: number;
  reduceMotion: boolean;
  notificationSound: boolean;
  desktopNotifications: boolean;
  emailNotifications: boolean;
  mutedNotificationTypes: string[];
}>;

export type AssignmentRuleConfiguration = Partial<{
  requireOnline: boolean;
  keywords: string[];
  tagIds: string[];
  connectionIds: string[];
  maxConcurrent: number;
  fallbackStrategy: "manual" | "round_robin" | "least_active";
}>;

/* ------------------------------------------------------------------ *
 * Relations (usadas pelas consultas relacionais do Drizzle)
 * ------------------------------------------------------------------ */

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  teams: many(teams),
  contacts: many(contacts),
  conversations: many(conversations),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  teamMemberships: many(teamMembers),
  conversations: many(conversations),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [teams.organizationId],
    references: [organizations.id],
  }),
  members: many(teamMembers),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [contacts.organizationId],
    references: [organizations.id],
  }),
  conversations: many(conversations),
  consents: many(contactConsents),
}));

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [conversations.organizationId],
      references: [organizations.id],
    }),
    contact: one(contacts, {
      fields: [conversations.contactId],
      references: [contacts.id],
    }),
    assignedUser: one(users, {
      fields: [conversations.assignedUserId],
      references: [users.id],
    }),
    assignedTeam: one(teams, {
      fields: [conversations.assignedTeamId],
      references: [teams.id],
    }),
    connection: one(whatsappConnections, {
      fields: [conversations.whatsappConnectionId],
      references: [whatsappConnections.id],
    }),
    messages: many(messages),
    tags: many(conversationTags),
    events: many(conversationEvents),
  }),
);

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, {
    fields: [messages.senderUserId],
    references: [users.id],
  }),
}));

export const conversationTagsRelations = relations(
  conversationTags,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationTags.conversationId],
      references: [conversations.id],
    }),
    tag: one(tags, { fields: [conversationTags.tagId], references: [tags.id] }),
  }),
);

export const kanbanBoardsRelations = relations(
  kanbanBoards,
  ({ one, many }) => ({
    owner: one(users, {
      fields: [kanbanBoards.userId],
      references: [users.id],
    }),
    columns: many(kanbanColumns),
    cards: many(kanbanCards),
  }),
);

export const kanbanColumnsRelations = relations(
  kanbanColumns,
  ({ one, many }) => ({
    board: one(kanbanBoards, {
      fields: [kanbanColumns.boardId],
      references: [kanbanBoards.id],
    }),
    cards: many(kanbanCards),
  }),
);

export const kanbanCardsRelations = relations(kanbanCards, ({ one }) => ({
  board: one(kanbanBoards, {
    fields: [kanbanCards.boardId],
    references: [kanbanBoards.id],
  }),
  column: one(kanbanColumns, {
    fields: [kanbanCards.columnId],
    references: [kanbanColumns.id],
  }),
  conversation: one(conversations, {
    fields: [kanbanCards.conversationId],
    references: [conversations.id],
  }),
}));

/* ------------------------------------------------------------------ *
 * Tipos inferidos
 * ------------------------------------------------------------------ */

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type WhatsappConnection = typeof whatsappConnections.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type QuickReply = typeof quickReplies.$inferSelect;
export type ScheduledFollowup = typeof scheduledFollowups.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type KanbanBoard = typeof kanbanBoards.$inferSelect;
export type KanbanColumn = typeof kanbanColumns.$inferSelect;
export type KanbanCard = typeof kanbanCards.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AssignmentRule = typeof assignmentRules.$inferSelect;
export type ConversationEvent = typeof conversationEvents.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type IntegrationEvent = typeof integrationEvents.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;

export type UserRole = (typeof userRole.enumValues)[number];
export type ConversationStatusValue =
  (typeof conversationStatus.enumValues)[number];
export type ConversationPriorityValue =
  (typeof conversationPriority.enumValues)[number];
export type MessageStatusValue = (typeof messageStatus.enumValues)[number];
export type AssignmentStrategyValue =
  (typeof assignmentStrategy.enumValues)[number];
