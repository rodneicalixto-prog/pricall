/**
 * Permissões por perfil (admin / supervisor / vendedor).
 *
 * Este módulo é a fonte única de verdade sobre "quem pode o quê". O frontend
 * usa as mesmas funções para esconder botões, mas a decisão que vale é a do
 * servidor: todo serviço em src/server/services chama estas funções.
 */
import type { AuthContext } from "./session";
import { errors } from "@/lib/errors";
import type { UserRole } from "@/db/schema";

export type Permission =
  | "organization.manage"
  | "users.manage"
  | "users.view"
  | "teams.manage"
  | "integrations.manage"
  | "integrations.view"
  | "assignment_rules.manage"
  | "quick_replies.manage"
  | "tags.manage"
  | "reports.view_all"
  | "reports.view_team"
  | "reports.view_own"
  | "reports.export"
  | "reports.import"
  | "conversations.view_all"
  | "conversations.view_team"
  | "conversations.view_own"
  | "conversations.assign_others"
  | "conversations.transfer"
  | "conversations.close"
  | "contacts.view_full_phone"
  | "contacts.block"
  | "audit.view"
  | "health.view"
  | "health.retry_events";

const PERMISSIONS_BY_ROLE: Record<UserRole, Permission[]> = {
  admin: [
    "organization.manage",
    "users.manage",
    "users.view",
    "teams.manage",
    "integrations.manage",
    "integrations.view",
    "assignment_rules.manage",
    "quick_replies.manage",
    "tags.manage",
    "reports.view_all",
    "reports.view_team",
    "reports.view_own",
    "reports.export",
    "reports.import",
    "conversations.view_all",
    "conversations.view_team",
    "conversations.view_own",
    "conversations.assign_others",
    "conversations.transfer",
    "conversations.close",
    "contacts.view_full_phone",
    "contacts.block",
    "audit.view",
    "health.view",
    "health.retry_events",
  ],
  supervisor: [
    "users.view",
    "integrations.view",
    "quick_replies.manage",
    "tags.manage",
    "reports.view_team",
    "reports.view_own",
    "reports.export",
    "conversations.view_team",
    "conversations.view_own",
    "conversations.assign_others",
    "conversations.transfer",
    "conversations.close",
    "contacts.view_full_phone",
    "contacts.block",
    "health.view",
  ],
  seller: [
    "reports.view_own",
    "conversations.view_own",
    "conversations.transfer",
    "conversations.close",
  ],
};

export function can(auth: AuthContext, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[auth.role].includes(permission);
}

export function requirePermission(auth: AuthContext, permission: Permission) {
  if (!can(auth, permission)) throw errors.forbidden();
}

export function permissionsOf(role: UserRole): Permission[] {
  return [...PERMISSIONS_BY_ROLE[role]];
}

/**
 * Alcance de leitura de conversas do usuário.
 *  - `all`  : administrador — a empresa inteira.
 *  - `team` : supervisor — as equipes que supervisiona (+ as suas conversas).
 *  - `own`  : vendedor — as próprias conversas e a fila não atribuída.
 */
export type ConversationScope =
  | { kind: "all" }
  | { kind: "team"; teamIds: string[]; userId: string }
  | { kind: "own"; userId: string; teamIds: string[] };

export function conversationScopeOf(auth: AuthContext): ConversationScope {
  if (auth.role === "admin") return { kind: "all" };
  if (auth.role === "supervisor") {
    // Um supervisor sem equipe atribuída enxerga apenas o que é seu.
    const teamIds =
      auth.supervisedTeamIds.length > 0 ? auth.supervisedTeamIds : auth.teamIds;
    return { kind: "team", teamIds, userId: auth.userId };
  }
  return { kind: "own", userId: auth.userId, teamIds: auth.teamIds };
}

/** Vendedor não enxerga o telefone completo, salvo configuração da empresa. */
export function shouldMaskPhone(
  auth: AuthContext,
  maskEnabled: boolean,
): boolean {
  if (!maskEnabled) return false;
  return !can(auth, "contacts.view_full_phone");
}
