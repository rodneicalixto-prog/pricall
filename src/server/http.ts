/**
 * Utilitários compartilhados pelos route handlers:
 * resolução de sessão, respostas JSON padronizadas e tratamento de erro.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, errors } from "@/lib/errors";
import { describeError } from "@/lib/audit";
import { env } from "@/lib/env";
import { getAuthContext, type AuthContext } from "@/lib/auth/session";
import { checkRateLimit, clientIp, type RateLimitRule } from "@/lib/rate-limit";

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, init);
}

export function jsonError(error: unknown) {
  if (error instanceof AppError) {
    return NextResponse.json<ApiFailure>(
      {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details },
      },
      { status: error.status },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json<ApiFailure>(
      {
        ok: false,
        error: {
          code: "validation",
          message: "Verifique os campos informados.",
          details: error.issues.map((i) => ({
            campo: i.path.join("."),
            mensagem: i.message,
          })),
        },
      },
      { status: 422 },
    );
  }

  // Log completo no servidor, mensagem genérica para o cliente.
  console.error("[pricall] erro não tratado:", describeError(error));
  if (!env.isProduction && error instanceof Error) console.error(error.stack);

  return NextResponse.json<ApiFailure>(
    {
      ok: false,
      error: { code: "internal", message: "Não foi possível concluir a operação." },
    },
    { status: 500 },
  );
}

/**
 * Envolve um handler com tratamento de erro uniforme.
 * O tipo do corpo não é fixado: um mesmo endpoint pode responder formatos
 * diferentes conforme a ação recebida.
 */
export function handler(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((error) => jsonError(error));
}

/** Exige sessão válida; lança 401 quando não houver. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) throw errors.unauthenticated();
  return auth;
}

/** Aplica rate limit por IP (e por identificador extra, quando fornecido). */
export function enforceRateLimit(
  request: Request,
  rule: RateLimitRule,
  scope: string,
  identifier?: string,
) {
  const key = `${scope}:${identifier ?? ""}:${clientIp(request)}`;
  const result = checkRateLimit(key, rule);
  if (!result.allowed) {
    throw errors.rateLimited(
      `Muitas tentativas. Tente novamente em ${result.retryAfterSeconds} segundo(s).`,
    );
  }
}

/** Lê e valida o corpo JSON da requisição. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw errors.validation("Corpo da requisição inválido.");
  }
  return schema.parse(raw);
}

/** Lê e valida os parâmetros de query. */
export function parseQuery<S extends z.ZodType>(
  request: Request,
  schema: S,
): z.infer<S> {
  const url = new URL(request.url);
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0]!;
  }
  return schema.parse(raw);
}

/** Metadados da requisição para auditoria. */
export function requestMeta(request: Request) {
  return {
    ipAddress: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  };
}
