"use client";

/**
 * Cliente HTTP da interface.
 * Padroniza o formato de erro e traduz falhas de rede em mensagens claras.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      headers: {
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(
      "offline",
      "Você está offline. As atualizações serão retomadas quando a conexão voltar.",
      0,
    );
  }

  if (response.status === 401) {
    throw new ApiError("unauthenticated", "Sua sessão expirou. Entre novamente.", 401);
  }

  let payload: Envelope<T>;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError(
      "internal",
      "Não foi possível interpretar a resposta do servidor.",
      response.status,
    );
  }

  if (!payload.ok) {
    throw new ApiError(
      payload.error.code,
      payload.error.message,
      response.status,
      payload.error.details,
    );
  }
  return payload.data;
}

export const mensagemDeErro = (erro: unknown): string =>
  erro instanceof ApiError
    ? erro.message
    : erro instanceof Error
      ? erro.message
      : "Não foi possível concluir a operação.";
