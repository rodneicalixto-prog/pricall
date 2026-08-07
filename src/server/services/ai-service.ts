/**
 * Ponte entre a central de atendimento e o módulo de IA.
 * Monta o contexto mínimo, respeita a configuração da empresa e registra o uso.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/session";
import { recordAudit, recordConversationEvent } from "@/lib/audit";
import { describeBusinessHours } from "@/lib/business-hours";
import { errors } from "@/lib/errors";
import { getAiProvider, type AiContext } from "@/modules/ai";
import { assertConversationAccess } from "./conversations";
import { listQuickReplies } from "./catalog";
import { recentMessages } from "./messages";
import { getOrganization } from "./organization";

async function buildContext(
  auth: AuthContext,
  conversationId: string,
): Promise<AiContext> {
  const db = await getDb();
  const organization = await getOrganization(auth.organizationId);

  if (organization.settings?.aiEnabled === false) {
    throw errors.forbidden(
      "A inteligência artificial está desativada para esta empresa.",
    );
  }

  const conversation = await assertConversationAccess(auth, conversationId);
  const [contact] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(eq(contacts.id, conversation.contactId))
    .limit(1);

  const history = await recentMessages(conversationId, 25);
  const quickReplies = await listQuickReplies(auth);

  return {
    organizationName: organization.name,
    sellerName: auth.name,
    contactName: contact?.name ?? "Cliente",
    businessHours: describeBusinessHours(organization.businessHours),
    messages: history
      .filter((m) => m.content)
      .map((m) => ({
        role:
          m.senderType === "contact"
            ? ("contact" as const)
            : m.senderType === "system"
              ? ("system" as const)
              : ("seller" as const),
        content: m.content!,
        at: m.createdAt,
      })),
    quickReplies: quickReplies
      .slice(0, 12)
      .map((q) => ({ title: q.title, content: q.content })),
  };
}

export async function suggestReply(auth: AuthContext, conversationId: string) {
  const context = await buildContext(auth, conversationId);
  const provider = getAiProvider();
  const result = await provider.suggestReply(context);

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "ai.reply_suggested",
    entityType: "conversation",
    entityId: conversationId,
    metadata: { provedor: result.provider, contextoInsuficiente: result.insufficientContext },
  });

  return {
    ...result,
    // Reforço explícito para a UI: nunca envia sozinho.
    requiresHumanReview: true,
  };
}

export async function summarizeConversation(
  auth: AuthContext,
  conversationId: string,
) {
  const organization = await getOrganization(auth.organizationId);
  if (organization.settings?.aiSummaryEnabled === false) {
    throw errors.forbidden("O resumo por IA está desativado para esta empresa.");
  }

  const context = await buildContext(auth, conversationId);
  const provider = getAiProvider();
  const result = await provider.summarize(context);

  await recordConversationEvent({
    organizationId: auth.organizationId,
    conversationId,
    eventType: "ai_summary_generated",
    actorUserId: auth.userId,
    metadata: { provedor: result.provider },
  });

  return result;
}

export async function classifyConversation(
  auth: AuthContext,
  conversationId: string,
) {
  const context = await buildContext(auth, conversationId);
  const provider = getAiProvider();
  const result = await provider.classify(context);

  await recordAudit({
    organizationId: auth.organizationId,
    userId: auth.userId,
    action: "ai.classification_suggested",
    entityType: "conversation",
    entityId: conversationId,
    metadata: { provedor: result.provider },
  });

  // A confirmação é sempre humana: a API só devolve sugestões.
  return { ...result, requiresHumanConfirmation: true };
}
