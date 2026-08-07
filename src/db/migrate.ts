/**
 * Aplica as migrações do Drizzle no driver ativo (Postgres ou PGlite).
 * Uso: `npm run db:migrate`
 */
import path from "node:path";
import { env } from "@/lib/env";
import { closeDb, getDb } from "./index";

export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  const db = await getDb();

  if (env.databaseDriver === "postgres") {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db as never, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder });
  }
}

const invokedDirectly =
  process.argv[1]?.endsWith("migrate.ts") ||
  process.argv[1]?.endsWith("migrate.js");

if (invokedDirectly) {
  runMigrations()
    .then(async () => {
      console.log(
        `[pricall] migrações aplicadas (driver: ${env.databaseDriver}).`,
      );
      await closeDb();
    })
    .catch(async (error) => {
      console.error("[pricall] falha ao aplicar migrações:", error);
      await closeDb().catch(() => {});
      process.exit(1);
    });
}
