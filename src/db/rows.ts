/**
 * Normaliza o retorno de `db.execute()` entre os drivers.
 * postgres-js devolve um array; PGlite devolve `{ rows: [...] }`.
 */
export function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
