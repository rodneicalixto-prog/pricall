/**
 * Cliente do banco de dados.
 *
 * O mesmo esquema PostgreSQL roda em dois drivers:
 *   - `postgres`: Postgres/Supabase real (produção e homologação).
 *   - `pglite`:   Postgres embutido em WASM, persistido em `PGLITE_DATA_DIR`.
 *                 Permite rodar o sistema completo — inclusive o modo
 *                 demonstração — sem nenhum serviço externo.
 *
 * A instância é memoizada no escopo global para sobreviver ao hot-reload do
 * Next.js em desenvolvimento.
 */
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Database = import("drizzle-orm/pglite").PgliteDatabase<
  typeof schema
> &
  Partial<{ $client: unknown }>;

type GlobalCache = {
  db?: Database;
  closer?: () => Promise<void>;
};

const globalCache = globalThis as unknown as { __pricall__?: GlobalCache };
globalCache.__pricall__ ??= {};

async function createDatabase(): Promise<Database> {
  if (env.databaseDriver === "postgres") {
    const [{ drizzle }, postgresModule] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres"),
    ]);
    const postgres = postgresModule.default;
    const client = postgres(env.databaseUrl!, {
      max: env.isProduction ? 10 : 3,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
    });
    globalCache.__pricall__!.closer = async () => {
      await client.end({ timeout: 5 });
    };
    // Os dois drivers expõem a mesma API tipada do Drizzle.
    return drizzle(client, { schema }) as unknown as Database;
  }

  const [{ PGlite }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);
  const client = new PGlite(env.pgliteDataDir);
  await client.waitReady;
  globalCache.__pricall__!.closer = async () => {
    await client.close();
  };
  return drizzle(client, { schema }) as unknown as Database;
}

let pending: Promise<Database> | null = null;

/** Obtém (ou cria) a conexão compartilhada com o banco. */
export async function getDb(): Promise<Database> {
  const cached = globalCache.__pricall__!.db;
  if (cached) return cached;
  pending ??= createDatabase().then((db) => {
    globalCache.__pricall__!.db = db;
    return db;
  });
  return pending;
}

/** Encerra a conexão. Usado em testes e no shutdown do processo. */
export async function closeDb(): Promise<void> {
  const closer = globalCache.__pricall__!.closer;
  globalCache.__pricall__!.db = undefined;
  globalCache.__pricall__!.closer = undefined;
  pending = null;
  if (closer) await closer();
}

export { schema };
