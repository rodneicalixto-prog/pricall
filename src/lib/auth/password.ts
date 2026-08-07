/**
 * Hash de senha com scrypt (Node crypto) — sem dependência nativa.
 * Formato armazenado: `scrypt$N$r$p$saltBase64$hashBase64`.
 */
import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Regras mínimas de senha; retorna a lista de problemas encontrados. */
export function validatePasswordStrength(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push("A senha deve ter ao menos 8 caracteres.");
  if (!/[a-zA-Z]/.test(password)) problems.push("A senha deve conter letras.");
  if (!/[0-9]/.test(password)) problems.push("A senha deve conter números.");
  return problems;
}
