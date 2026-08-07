/** Normalização, formatação e mascaramento de telefones brasileiros. */

/** Mantém apenas dígitos e garante o DDI 55 quando o número é do Brasil. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D+/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith("55")) return digits;
  // 10 ou 11 dígitos = número nacional sem DDI.
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/** `5511987654321` -> `+55 (11) 98765-4321` */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const middle = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
    const last = rest.length === 9 ? rest.slice(5) : rest.slice(4);
    return `+55 (${ddd}) ${middle}-${last}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const rest = digits.slice(2);
    const middle = rest.length === 9 ? rest.slice(0, 5) : rest.slice(0, 4);
    const last = rest.length === 9 ? rest.slice(5) : rest.slice(4);
    return `(${ddd}) ${middle}-${last}`;
  }
  return raw;
}

/**
 * Mascara o miolo do número, preservando DDI/DDD e os 2 últimos dígitos.
 * `+55 (11) 98765-4321` -> `+55 (11) ••••-••21`
 */
export function maskPhone(raw: string): string {
  const formatted = formatPhone(raw);
  const digitsOnly = raw.replace(/\D+/g, "");
  if (digitsOnly.length < 6) return "••••";

  const tail = digitsOnly.slice(-2);
  // Substitui todos os dígitos após o DDD, exceto os dois últimos.
  let seenDigits = 0;
  const prefixDigits = formatted.startsWith("+55") ? 4 : 2; // DDI+DDD ou DDD
  const total = digitsOnly.length;

  let out = "";
  for (const ch of formatted) {
    if (!/\d/.test(ch)) {
      out += ch;
      continue;
    }
    seenDigits += 1;
    if (seenDigits <= prefixDigits) out += ch;
    else if (seenDigits > total - 2) out += tail[seenDigits - (total - 1)] ?? ch;
    else out += "•";
  }
  return out;
}

export function isValidPhone(raw: string): boolean {
  const digits = normalizePhone(raw);
  return digits.length >= 12 && digits.length <= 15;
}
