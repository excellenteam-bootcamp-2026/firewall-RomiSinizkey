import { Pool } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { config } from "../../../../main/env";
import { logger } from "../../../../main/Logger";

// Implementation decision (not a PDF requirement): a fixed, bounded attempt
// count for Stop-and-Wait, rather than an unconfigurable/unbounded loop.
export const MAX_CONNECTION_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential Backoff (Issue #33, optional): the delay before retrying a
// failed attempt doubles each time, starting from DB_CONNECTION_INTERVAL.
// `failedAttempt` is the 1-based attempt number that just failed, so the
// first retry (after attempt 1) waits exactly the configured interval, the
// second retry waits double that, and so on.
export function computeBackoffDelayMs(initialDelayMs: number, failedAttempt: number): number {
  return initialDelayMs * 2 ** (failedAttempt - 1);
}

function connectionLabel(): string {
  return `${config.database.host}:${config.database.port}/${config.database.database}`;
}

class PostgresConnection {
  private static instance: PostgresConnection | null = null;

  private pool: Pool | null = null;
  private db: NodePgDatabase | null = null;

  // Holds the in-flight connect sequence so concurrent connect() calls share
  // it instead of starting parallel attempts. Cleared in a `finally` so a
  // failed sequence never permanently caches a rejected Promise — a later
  // explicit connect() call always starts a fresh sequence.
  private connectingPromise: Promise<NodePgDatabase> | null = null;

  private constructor() {}

  static getInstance(): PostgresConnection {
    if (!PostgresConnection.instance) {
      PostgresConnection.instance = new PostgresConnection();
    }
    return PostgresConnection.instance;
  }

  async connect(): Promise<NodePgDatabase> {
    if (this.db) {
      return this.db;
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = this.connectWithRetry();

    try {
      this.db = await this.connectingPromise;
      return this.db;
    } finally {
      this.connectingPromise = null;
    }
  }

  getDb(): NodePgDatabase {
    if (!this.db) {
      throw new Error("PostgreSQL connection has not been established yet. Call connect() first.");
    }
    return this.db;
  }

  async shutdown(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
    this.pool = null;
    this.db = null;
    this.connectingPromise = null;
  }

  private getOrCreatePool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: config.database.database,
      });
    }
    return this.pool;
  }

  private async connectWithRetry(): Promise<NodePgDatabase> {
    const pool = this.getOrCreatePool();

    for (let attempt = 1; attempt <= MAX_CONNECTION_ATTEMPTS; attempt++) {
      logger.info(`[postgres] connection attempt ${attempt}/${MAX_CONNECTION_ATTEMPTS} (${connectionLabel()})`);

      try {
        // eslint-disable-next-line no-await-in-loop -- Stop-and-Wait requires attempts to run sequentially, never in parallel.
        await pool.query("SELECT 1");
        logger.info(`[postgres] connection established (${connectionLabel()})`);
        return drizzle(pool);
      } catch (err) {
        if (attempt === MAX_CONNECTION_ATTEMPTS) {
          logger.error(`[postgres] connection failed after ${MAX_CONNECTION_ATTEMPTS} attempts (${connectionLabel()})`);
          this.pool = null;
          // eslint-disable-next-line no-await-in-loop
          await pool.end().catch(() => undefined);
          throw new Error(`Failed to connect to PostgreSQL after ${MAX_CONNECTION_ATTEMPTS} attempts.`);
        }

        const delayMs = computeBackoffDelayMs(config.dbConnectionIntervalMs, attempt);
        logger.warn(
          `[postgres] connection attempt ${attempt} failed, retrying in ${delayMs}ms (Exponential Backoff)`,
        );
        // eslint-disable-next-line no-await-in-loop -- the retry delay must be fully awaited before the next attempt.
        await sleep(delayMs);
      }
    }

    // Unreachable — the loop above always either returns or throws on its
    // final iteration. Present only so TypeScript sees every path returns.
    throw new Error(`Failed to connect to PostgreSQL after ${MAX_CONNECTION_ATTEMPTS} attempts.`);
  }
}

export const postgresConnection = PostgresConnection.getInstance();
export { PostgresConnection };
