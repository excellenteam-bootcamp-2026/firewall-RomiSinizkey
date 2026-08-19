import path from "node:path";
import { Pool } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { firewallRules } from "../../../src/adapters/outbound/persistence/postgres/schema";

// Test-only, fully decoupled from src/main/env.ts and PostgresConnection: this
// module never reads DB_* (the app's dev/prod config) and never imports
// connection.ts, so there is no code path by which these tests could reach
// firewall_dev or any non-test database.

export interface TestDatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function readTestDatabaseConfig(): TestDatabaseConfig | undefined {
  const { TEST_DB_HOST, TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD, TEST_DB_NAME } = process.env;

  if (!TEST_DB_NAME) {
    return undefined;
  }

  // Safeguard: fail before anything (migration, cleanup, a query) ever runs
  // if the configured database doesn't look like a disposable test database.
  if (!TEST_DB_NAME.endsWith("_test")) {
    throw new Error(
      `Refusing to run PostgreSQL integration tests: TEST_DB_NAME ("${TEST_DB_NAME}") must end with ` +
        '"_test". This guard exists to make it impossible for these tests to accidentally target a ' +
        "development or production database."
    );
  }

  return {
    host: TEST_DB_HOST ?? "localhost",
    port: TEST_DB_PORT ? Number(TEST_DB_PORT) : 5432,
    user: TEST_DB_USER ?? "postgres",
    password: TEST_DB_PASSWORD ?? "",
    database: TEST_DB_NAME,
  };
}

// Evaluated once at import time, so misconfiguration is caught immediately
// rather than partway through a test run.
const testDatabaseConfig = readTestDatabaseConfig();

export const hasTestDatabaseConfig = testDatabaseConfig !== undefined;

let pool: Pool | undefined;
let db: NodePgDatabase | undefined;

export function getTestDb(): NodePgDatabase {
  if (!testDatabaseConfig) {
    throw new Error(
      "getTestDb() was called without a guarded TEST_DB_* configuration (TEST_DB_NAME is unset)."
    );
  }
  if (!db) {
    pool = new Pool(testDatabaseConfig);
    db = drizzle(pool);
  }
  return db;
}

export async function runTestMigrations(): Promise<void> {
  const database = getTestDb();
  await migrate(database, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
}

export async function cleanupFirewallRules(): Promise<void> {
  const database = getTestDb();
  await database.delete(firewallRules);
}

export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
  }
  pool = undefined;
  db = undefined;
}
