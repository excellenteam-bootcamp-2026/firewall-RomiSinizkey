import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { config } from "./env";
import { logger } from "./Logger";

// Production-safe migration entry point: uses drizzle-orm's own migrator, not the
// drizzle-kit CLI, so it has no drizzle-kit dependency at runtime (drizzle-kit stays a
// devDependency and is never installed in the production image). Opens a short-lived
// pool of its own — separate from the app's long-lived Singleton in connection.ts — and
// always closes it, whether the migration succeeds or fails.
async function runMigrations(): Promise<void> {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
  });

  try {
    const db = drizzle(pool);
    logger.info("[migrate] running database migrations...");
    await migrate(db, { migrationsFolder: "./drizzle" });
    logger.info("[migrate] migrations complete");
  } finally {
    await pool.end();
  }
}

runMigrations().catch((err) => {
  logger.error("[migrate] migration failed", { err });
  process.exit(1);
});
