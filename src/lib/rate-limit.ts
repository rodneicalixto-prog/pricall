/**
 * Rate limiting por janela deslizante.
 *
 * Implementação em memória (suficiente para um processo). Para múltiplas
 * instâncias, troque `store` por Redis/Upstash mantendo a mesma assinatura —
 * os chamadores não mudam.
 */

type Bucket = { hits: number[]; blockedUntil?: number };

const store = new Map<string, Bucket>();
let lastSweep = Date.now();

export type RateLimitRule = {
  /** Quantidade máxima de eventos na janela. */
  limit: number;
  /** Tamanho da janela em segundos. */
  windowSeconds: number;
  /** Bloqueio adicional após estourar o limite, em segundos. */
  blockSeconds?: number;
};

/** Limites padrão por ação sensível. */
export const RATE_LIMITS = {
  login: { limit: 5, windowSeconds: 300, blockSeconds: 900 },
  register: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 3, windowSeconds: 900, blockSeconds: 900 },
  sendMessage: { limit: 60, windowSeconds: 60 },
  upload: { limit: 20, windowSeconds: 300 },
  search: { limit: 120, windowSeconds: 60 },
  export: { limit: 5, windowSeconds: 300 },
  import: { limit: 5, windowSeconds: 3600 },
  invite: { limit: 20, windowSeconds: 3600 },
  webhook: { limit: 600, windowSeconds: 60 },
  ai: { limit: 30, windowSeconds: 300 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function checkRateLimit(
  key: string,
  rule: RateLimitRule,
): RateLimitResult {
  sweep();
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const bucket = store.get(key) ?? { hits: [] };

  if (bucket.blockedUntil && bucket.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1000),
    };
  }

  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= rule.limit) {
    if (rule.blockSeconds) bucket.blockedUntil = now + rule.blockSeconds * 1000;
    store.set(key, bucket);
    const retry = rule.blockSeconds
      ? rule.blockSeconds
      : Math.ceil((windowMs - (now - bucket.hits[0])) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(retry, 1) };
  }

  bucket.hits.push(now);
  store.set(key, bucket);
  return {
    allowed: true,
    remaining: rule.limit - bucket.hits.length,
    retryAfterSeconds: 0,
  };
}

/** Zera o contador de uma chave (ex.: após login bem-sucedido). */
export function resetRateLimit(key: string) {
  store.delete(key);
}

function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of store) {
    const stale =
      bucket.hits.every((t) => now - t > 3_600_000) &&
      (!bucket.blockedUntil || bucket.blockedUntil < now);
    if (stale) store.delete(key);
  }
}

/** Extrai o IP da requisição respeitando proxies conhecidos. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "desconhecido"
  );
}
