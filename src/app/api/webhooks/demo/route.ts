/**
 * Simulador do modo demonstração.
 *
 * Permite exercitar recebimento, entrega, leitura e falha sem credenciais
 * externas. Exige sessão autenticada e só age sobre conexões `mock`.
 */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, conversations, messages, whatsappConnections } from "@/db/schema";
import { errors } from "@/lib/errors";
import { handler, jsonOk, parseBody, requireAuth } from "@/server/http";
import { ingestEvents } from "@/server/services/inbound";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("incoming"),
    contactId: z.string().uuid().optional(),
    text: z.string().min(1).max(1000),
  }),
  z.object({
    action: z.literal("status"),
    messageId: z.string().uuid(),
    status: z.enum(["delivered", "read", "failed"]),
  }),
]);

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    const db = await getDb();
    const body = await parseBody(request, schema);

    const [connection] = await db
      .select()
      .from(whatsappConnections)
      .where(
        and(
          eq(whatsappConnections.organizationId, auth.organizationId),
          eq(whatsappConnections.provider, "mock"),
        ),
      )
      .orderBy(desc(whatsappConnections.isDefault))
      .limit(1);

    if (!connection) {
      throw errors.validation(
        "Nenhuma conexão em modo demonstração está configurada para esta empresa.",
      );
    }
    const channelKey = connection.instanceName ?? connection.id;

    if (body.action === "incoming") {
      const [contact] = body.contactId
        ? await db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.id, body.contactId),
                eq(contacts.organizationId, auth.organizationId),
              ),
            )
            .limit(1)
        : await db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.organizationId, auth.organizationId),
                eq(contacts.isDemo, true),
              ),
            )
            .orderBy(desc(contacts.lastContactAt))
            .limit(1);

      if (!contact) throw errors.notFound("Nenhum contato de demonstração disponível.");

      const result = await ingestEvents(
        "mock",
        [
          {
            kind: "message",
            externalEventId: `demo.${randomUUID()}`,
            channelKey,
            whatsappMessageId: `demo.${randomUUID()}`,
            from: contact.whatsappId,
            contactName: contact.name,
            messageType: "text",
            text: body.text,
            timestamp: new Date(),
          },
        ],
        { simulado: true },
      );
      return jsonOk({ simulated: "mensagem recebida", ...result });
    }

    const [message] = await db
      .select({
        whatsappMessageId: messages.whatsappMessageId,
        conversationId: messages.conversationId,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          eq(messages.id, body.messageId),
          eq(messages.organizationId, auth.organizationId),
        ),
      )
      .limit(1);

    if (!message?.whatsappMessageId) {
      throw errors.notFound("Mensagem sem identificador externo.");
    }

    const result = await ingestEvents(
      "mock",
      [
        {
          kind: "status",
          externalEventId: `demo.${randomUUID()}`,
          channelKey,
          whatsappMessageId: message.whatsappMessageId,
          status: body.status,
          failureReason:
            body.status === "failed"
              ? "Falha simulada de entrega (modo demonstração)."
              : undefined,
          timestamp: new Date(),
        },
      ],
      { simulado: true },
    );
    return jsonOk({ simulated: `status ${body.status}`, ...result });
  });
}
