import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEYS = ["ENV", "PORT", "DB_CONNECTION_INTERVAL", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"] as const;

const SECRET_USER = "weird_user";
const SECRET_PASSWORD = "s3cr3t-P@ss!";
const INTERVAL_MS = 2000;

const VALID_ENV = {
  ENV: "dev",
  PORT: "3000",
  DB_CONNECTION_INTERVAL: String(INTERVAL_MS),
  DB_HOST: "db.internal",
  DB_PORT: "5432",
  DB_USER: SECRET_USER,
  DB_PASSWORD: SECRET_PASSWORD,
  DB_NAME: "firewall_dev",
};

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value !== undefined) process.env[key] = value;
  }
}

// Fakes for "pg" and the Logger, defined via vi.hoisted() so they're
// available inside the hoisted vi.mock() factories below and reused (not
// re-created) across every vi.resetModules() call — this is what lets each
// test get a fresh connection.ts Singleton while still controlling/reading
// the same mock state across it.
const pgMock = vi.hoisted(() => {
  const state: {
    poolConfigs: Array<{ host: string; port: number; user: string; password: string; database: string }>;
    endCalls: number;
    queryImpl: () => Promise<unknown>;
    queryTimestamps: number[];
  } = {
    poolConfigs: [],
    endCalls: 0,
    queryImpl: async () => {
      throw new Error("queryImpl not configured for this test");
    },
    queryTimestamps: [],
  };

  class FakePool {
    query = vi.fn(async (..._args: unknown[]) => {
      state.queryTimestamps.push(Date.now());
      return state.queryImpl();
    });
    end = vi.fn(async () => {
      state.endCalls += 1;
    });

    constructor(cfg: { host: string; port: number; user: string; password: string; database: string }) {
      state.poolConfigs.push(cfg);
    }
  }

  return { state, FakePool };
});

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("pg", () => ({ Pool: pgMock.FakePool }));
vi.mock("../../../../../../src/main/Logger", () => ({ logger: loggerMock }));

async function loadConnectionModule() {
  return import("../../../../../../src/adapters/outbound/persistence/postgres/connection");
}

function allLoggedText(): string {
  const calls = [...loggerMock.info.mock.calls, ...loggerMock.warn.mock.calls, ...loggerMock.error.mock.calls];
  return calls.map((args) => args.map((a) => String(a)).join(" ")).join("\n");
}

describe("PostgresConnection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    pgMock.state.poolConfigs = [];
    pgMock.state.endCalls = 0;
    pgMock.state.queryTimestamps = [];
    pgMock.state.queryImpl = async () => {
      throw new Error("queryImpl not configured for this test");
    };
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    loggerMock.debug.mockClear();
    setEnv(VALID_ENV);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  it("getInstance() returns the same Singleton instance", async () => {
    const { PostgresConnection } = await loadConnectionModule();

    expect(PostgresConnection.getInstance()).toBe(PostgresConnection.getInstance());
  });

  it("constructs the Pool only once across a sequence with retries", async () => {
    const { postgresConnection } = await loadConnectionModule();
    let calls = 0;
    pgMock.state.queryImpl = async () => {
      calls += 1;
      if (calls < 3) throw new Error("connection refused");
      return { rows: [] };
    };

    const connectPromise = postgresConnection.connect();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
    await connectPromise;

    expect(pgMock.state.poolConfigs).toHaveLength(1);
    expect(pgMock.state.poolConfigs[0]).toEqual({
      host: "db.internal",
      port: 5432,
      user: SECRET_USER,
      password: SECRET_PASSWORD,
      database: "firewall_dev",
    });
  });

  it("returns the Drizzle database instance on a successful first attempt", async () => {
    const { postgresConnection } = await loadConnectionModule();
    pgMock.state.queryImpl = async () => ({ rows: [] });

    const db = await postgresConnection.connect();

    expect(db).toBeDefined();
    expect(pgMock.state.queryTimestamps).toHaveLength(1);
  });

  it("waits the configured interval before retrying after a failed attempt", async () => {
    const { postgresConnection } = await loadConnectionModule();
    let calls = 0;
    pgMock.state.queryImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error("connection refused");
      return { rows: [] };
    };

    const connectPromise = postgresConnection.connect();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    await connectPromise;

    expect(pgMock.state.queryTimestamps).toHaveLength(2);
    expect(pgMock.state.queryTimestamps[1] - pgMock.state.queryTimestamps[0]).toBeGreaterThanOrEqual(INTERVAL_MS);
  });

  it("succeeds after earlier failures within the attempt limit", async () => {
    const { postgresConnection } = await loadConnectionModule();
    let calls = 0;
    pgMock.state.queryImpl = async () => {
      calls += 1;
      if (calls < 4) throw new Error("connection refused");
      return { rows: [] };
    };

    const connectPromise = postgresConnection.connect();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);
    const db = await connectPromise;

    expect(db).toBeDefined();
    expect(calls).toBe(4);
  });

  it("never runs two attempts in parallel — each waits for the previous one to settle", async () => {
    const { postgresConnection } = await loadConnectionModule();
    let calls = 0;
    pgMock.state.queryImpl = async () => {
      calls += 1;
      if (calls < 3) throw new Error("connection refused");
      return { rows: [] };
    };

    const connectPromise = postgresConnection.connect();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    await connectPromise;

    for (let i = 1; i < pgMock.state.queryTimestamps.length; i++) {
      expect(pgMock.state.queryTimestamps[i] - pgMock.state.queryTimestamps[i - 1]).toBeGreaterThanOrEqual(
        INTERVAL_MS,
      );
    }
  });

  it("throws a final error after all 5 attempts fail", async () => {
    const { postgresConnection, MAX_CONNECTION_ATTEMPTS } = await loadConnectionModule();
    expect(MAX_CONNECTION_ATTEMPTS).toBe(5);
    pgMock.state.queryImpl = async () => {
      throw new Error("connection refused");
    };

    const connectPromise = postgresConnection.connect();
    connectPromise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * MAX_CONNECTION_ATTEMPTS);

    await expect(connectPromise).rejects.toThrow();
    expect(pgMock.state.queryTimestamps).toHaveLength(MAX_CONNECTION_ATTEMPTS);
  });

  it("schedules no delay after the fifth failure", async () => {
    const { postgresConnection, MAX_CONNECTION_ATTEMPTS } = await loadConnectionModule();
    pgMock.state.queryImpl = async () => {
      throw new Error("connection refused");
    };

    const connectPromise = postgresConnection.connect();
    connectPromise.catch(() => undefined);
    // Exactly 4 delays occur between 5 attempts; advancing by only that much
    // (not a 5th interval) must already be enough for the promise to settle.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * (MAX_CONNECTION_ATTEMPTS - 1));

    await expect(connectPromise).rejects.toThrow();
  });

  it("does not log that another retry will happen on the final failure", async () => {
    const { postgresConnection, MAX_CONNECTION_ATTEMPTS } = await loadConnectionModule();
    pgMock.state.queryImpl = async () => {
      throw new Error("connection refused");
    };

    const connectPromise = postgresConnection.connect();
    connectPromise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * MAX_CONNECTION_ATTEMPTS);
    await expect(connectPromise).rejects.toThrow();

    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledTimes(MAX_CONNECTION_ATTEMPTS - 1);
  });

  it("closes and resets the Pool on final failure", async () => {
    const { postgresConnection, MAX_CONNECTION_ATTEMPTS } = await loadConnectionModule();
    pgMock.state.queryImpl = async () => {
      throw new Error("connection refused");
    };

    const connectPromise = postgresConnection.connect();
    connectPromise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * MAX_CONNECTION_ATTEMPTS);
    await expect(connectPromise).rejects.toThrow();

    expect(pgMock.state.endCalls).toBe(1);
  });

  it("concurrent connect() calls share the same in-flight work, not separate pools", async () => {
    const { postgresConnection } = await loadConnectionModule();
    let calls = 0;
    pgMock.state.queryImpl = async () => {
      calls += 1;
      if (calls < 2) throw new Error("connection refused");
      return { rows: [] };
    };

    const first = postgresConnection.connect();
    const second = postgresConnection.connect();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    const [dbFirst, dbSecond] = await Promise.all([first, second]);

    expect(dbFirst).toBe(dbSecond);
    expect(pgMock.state.poolConfigs).toHaveLength(1);
  });

  it("allows a new connect() sequence to succeed after an earlier sequence fully failed", async () => {
    const { postgresConnection, MAX_CONNECTION_ATTEMPTS } = await loadConnectionModule();
    pgMock.state.queryImpl = async () => {
      throw new Error("connection refused");
    };

    const firstAttempt = postgresConnection.connect();
    firstAttempt.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * MAX_CONNECTION_ATTEMPTS);
    await expect(firstAttempt).rejects.toThrow();

    pgMock.state.queryImpl = async () => ({ rows: [] });
    const db = await postgresConnection.connect();

    expect(db).toBeDefined();
    expect(pgMock.state.poolConfigs).toHaveLength(2);
  });

  it("shutdown() calls pool.end()", async () => {
    const { postgresConnection } = await loadConnectionModule();
    pgMock.state.queryImpl = async () => ({ rows: [] });
    await postgresConnection.connect();

    await postgresConnection.shutdown();

    expect(pgMock.state.endCalls).toBe(1);
  });

  it("calling shutdown() more than once is safe", async () => {
    const { postgresConnection } = await loadConnectionModule();
    pgMock.state.queryImpl = async () => ({ rows: [] });
    await postgresConnection.connect();

    await postgresConnection.shutdown();
    await expect(postgresConnection.shutdown()).resolves.not.toThrow();

    expect(pgMock.state.endCalls).toBe(1);
  });

  it("never logs the mocked username or password", async () => {
    const { postgresConnection, MAX_CONNECTION_ATTEMPTS } = await loadConnectionModule();
    let calls = 0;
    pgMock.state.queryImpl = async () => {
      calls += 1;
      if (calls < 3) throw new Error("connection refused");
      return { rows: [] };
    };

    const connectPromise = postgresConnection.connect();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * MAX_CONNECTION_ATTEMPTS);
    await connectPromise;

    const logged = allLoggedText();
    expect(logged).not.toContain(SECRET_USER);
    expect(logged).not.toContain(SECRET_PASSWORD);
  });

  it("uses the DB_* group under ENV=dev", async () => {
    setEnv(VALID_ENV);
    const { postgresConnection } = await loadConnectionModule();
    pgMock.state.queryImpl = async () => ({ rows: [] });

    await postgresConnection.connect();

    expect(pgMock.state.poolConfigs[0].host).toBe("db.internal");
  });

  it("uses the same DB_* variable names under ENV=production", async () => {
    setEnv({ ...VALID_ENV, ENV: "production", DB_HOST: "prod.internal" });
    const { postgresConnection } = await loadConnectionModule();
    pgMock.state.queryImpl = async () => ({ rows: [] });

    await postgresConnection.connect();

    expect(pgMock.state.poolConfigs[0].host).toBe("prod.internal");
  });
});
