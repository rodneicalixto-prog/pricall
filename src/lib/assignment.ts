/**
 * Motor de distribuição de conversas.
 *
 * A função `pickAssignee` é pura: recebe candidatos + contexto e devolve a
 * escolha. Isso a torna testável sem banco (ver tests/assignment.test.ts).
 * A busca dos candidatos e a gravação ficam em src/server/services/assignment.ts.
 */
import type {
  AssignmentRuleConfiguration,
  AssignmentStrategyValue,
} from "@/db/schema";

export type Candidate = {
  userId: string;
  name: string;
  isActive: boolean;
  availabilityStatus: "online" | "away" | "offline";
  /** Conversas em andamento no momento. */
  activeConversations: number;
  maxConcurrentConversations: number;
  teamIds: string[];
  /** Usado como desempate estável no rodízio. */
  createdAtMs: number;
};

export type AssignmentContext = {
  strategy: AssignmentStrategyValue;
  configuration?: AssignmentRuleConfiguration;
  /** Equipe alvo, quando a estratégia é por setor. */
  teamId?: string | null;
  /** Último usuário sorteado no rodízio (ponteiro persistido). */
  lastAssignedUserId?: string | null;
  /** Texto da primeira mensagem — usado por regras com palavras-chave. */
  messageText?: string | null;
};

export type AssignmentDecision = {
  userId: string | null;
  teamId: string | null;
  /** `first_available` não atribui: notifica e espera alguém assumir. */
  notifyCandidates: string[];
  reason: string;
};

/** Elimina quem não pode receber conversa, seja qual for a estratégia. */
export function eligibleCandidates(
  candidates: Candidate[],
  context: AssignmentContext,
): Candidate[] {
  const requireOnline = context.configuration?.requireOnline ?? true;
  const configuredMax = context.configuration?.maxConcurrent;

  return candidates.filter((candidate) => {
    if (!candidate.isActive) return false;
    if (requireOnline && candidate.availabilityStatus === "offline") return false;

    const limit = configuredMax ?? candidate.maxConcurrentConversations;
    if (limit > 0 && candidate.activeConversations >= limit) return false;

    if (context.teamId && !candidate.teamIds.includes(context.teamId)) {
      return false;
    }
    return true;
  });
}

export function pickAssignee(
  candidates: Candidate[],
  context: AssignmentContext,
): AssignmentDecision {
  const teamId = context.teamId ?? null;

  if (context.strategy === "manual") {
    return {
      userId: null,
      teamId,
      notifyCandidates: [],
      reason: "Distribuição manual: a conversa fica na fila 'Não atribuídos'.",
    };
  }

  const pool = eligibleCandidates(candidates, context);

  if (pool.length === 0) {
    const fallback = context.configuration?.fallbackStrategy;
    if (fallback && fallback !== "manual") {
      /**
       * A reserva relaxa apenas a restrição de setor: ninguém do setor está
       * livre, então a conversa vai para o restante da empresa. Disponibilidade
       * e limite de atendimentos simultâneos continuam valendo — atribuir a
       * alguém offline ou lotado é pior do que deixar a conversa na fila.
       */
      const contextoReserva: AssignmentContext = {
        ...context,
        strategy: fallback,
        teamId: null,
        configuration: { ...context.configuration, fallbackStrategy: undefined },
      };
      const decision = pickAssignee(candidates, contextoReserva);
      return {
        ...decision,
        // Mantém o registro da equipe de origem mesmo saindo do setor.
        teamId,
        reason: `${decision.reason} (regra de reserva: ${fallback})`,
      };
    }
    return {
      userId: null,
      teamId,
      notifyCandidates: [],
      reason:
        "Nenhum vendedor disponível no momento. A conversa aguarda na fila.",
    };
  }

  switch (context.strategy) {
    case "round_robin": {
      const ordered = [...pool].sort(byStableOrder);
      const lastIndex = context.lastAssignedUserId
        ? ordered.findIndex((c) => c.userId === context.lastAssignedUserId)
        : -1;
      const next = ordered[(lastIndex + 1) % ordered.length];
      return {
        userId: next.userId,
        teamId,
        notifyCandidates: [next.userId],
        reason: `Rodízio: próximo da fila é ${next.name}.`,
      };
    }

    case "least_active": {
      const ordered = [...pool].sort(
        (a, b) =>
          a.activeConversations - b.activeConversations || byStableOrder(a, b),
      );
      const next = ordered[0];
      return {
        userId: next.userId,
        teamId,
        notifyCandidates: [next.userId],
        reason: `Menor carga: ${next.name} com ${next.activeConversations} atendimento(s) ativo(s).`,
      };
    }

    case "team_based": {
      // Dentro do setor, usa menor carga como critério de desempate.
      const ordered = [...pool].sort(
        (a, b) =>
          a.activeConversations - b.activeConversations || byStableOrder(a, b),
      );
      const next = ordered[0];
      return {
        userId: next.userId,
        teamId,
        notifyCandidates: [next.userId],
        reason: `Distribuição por equipe: ${next.name}.`,
      };
    }

    case "first_available": {
      return {
        userId: null,
        teamId,
        notifyCandidates: pool.map((c) => c.userId),
        reason:
          "Primeiro disponível: vendedores notificados; a conversa é de quem assumir primeiro.",
      };
    }

    default:
      return {
        userId: null,
        teamId,
        notifyCandidates: [],
        reason: "Estratégia desconhecida; conversa mantida na fila.",
      };
  }
}

function byStableOrder(a: Candidate, b: Candidate): number {
  return a.createdAtMs - b.createdAtMs || a.userId.localeCompare(b.userId);
}

/**
 * Seleciona a regra aplicável entre as cadastradas.
 * A primeira regra ativa (menor `priority`) cujos filtros casam vence.
 */
export type RuleLike = {
  id: string;
  strategy: AssignmentStrategyValue;
  teamId: string | null;
  priority: number;
  isActive: boolean;
  configuration: AssignmentRuleConfiguration;
};

export function selectRule(
  rules: RuleLike[],
  input: { messageText?: string | null; connectionId?: string | null; tagIds?: string[] },
): RuleLike | null {
  const active = rules
    .filter((r) => r.isActive)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of active) {
    const cfg = rule.configuration ?? {};
    const keywords = cfg.keywords ?? [];
    const connectionIds = cfg.connectionIds ?? [];
    const tagIds = cfg.tagIds ?? [];

    if (keywords.length > 0) {
      const text = (input.messageText ?? "").toLowerCase();
      if (!keywords.some((k) => text.includes(k.toLowerCase()))) continue;
    }
    if (connectionIds.length > 0) {
      if (!input.connectionId || !connectionIds.includes(input.connectionId)) {
        continue;
      }
    }
    if (tagIds.length > 0) {
      const provided = input.tagIds ?? [];
      if (!tagIds.some((t) => provided.includes(t))) continue;
    }
    return rule;
  }
  return null;
}
