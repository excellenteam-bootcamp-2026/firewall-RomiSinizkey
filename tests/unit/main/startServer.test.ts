import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEYS = [
  "ENV",
  "PORT",
  "DB_CONNECTION_INTERVAL",
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "CLOUDAMQP_URL",
  "RABBITMQ_EXCHANGE",
  "RABBITMQ_QUEUE",
  "RABBITMQ_ROUTING_PREFIX",
] as const;

const VALID_ENV = {
  ENV: "dev",
  PORT: "3000",
  DB_CONNECTION_INTERVAL: "2000",
  DB_HOST: "localhost",
  DB_PORT: "5432",
  DB_USER: "app_user",
  DB_PASSWORD: "s3cret-P@ss",
  DB_NAME: "firewall_dev",
  CLOUDAMQP_URL: "amqps://user:pass@host/vhost",
  RABBITMQ_EXCHANGE: "firewall.commands",
  RABBITMQ_QUEUE: "romi.firewall.commands",
  RABBITMQ_ROUTING_PREFIX: "romi",
};

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value !== undefined) process.env[key] = value;
  }
}

// Fakes, defined via vi.hoisted() so they're available inside the hoisted
// vi.mock() factories below and reused (not re-created) across every
// vi.resetModules() call — this is what lets each test get a fresh
// startServer.ts module while still controlling/reading the same mock state.
const fakes = vi.hoisted(() => {
  const state: {
    callOrder: string[];
    connectImpl: () => Promise<unknown>;
    shutdownCalls: number;
    fakeDb: { marker: string };
    lastRepositoryDb: unknown;
    lastCreateAppRepository: unknown;
    closeImpl: (cb: (err?: Error) => void) => void;
    closeCalls: number;
  } = {
    callOrder: [],
    connectImpl: async () => {
      throw new Error("connectImpl not configured for this test");
    },
    shutdownCalls: 0,
    fakeDb: { marker: "fake-db" },
    lastRepositoryDb: undefined,
    lastCreateAppRepository: undefined,
    closeImpl: (cb) => cb(),
    closeCalls: 0,
  };

  class FakeDrizzleRuleRepository {
    constructor(db: unknown) {
      state.lastRepositoryDb = db;
    }
  }

  class FakeHttpServer {
    close = vi.fn((cb: (err?: Error) => void) => {
      state.closeCalls += 1;
      state.closeImpl(cb);
    });
  }

  const postgresConnection = {
    connect: vi.fn(async () => {
      state.callOrder.push("connect");
      return state.connectImpl();
    }),
    shutdown: vi.fn(async () => {
      state.callOrder.push("shutdown");
      state.shutdownCalls += 1;
    }),
  };

  const createApp = vi.fn((repository: unknown) => {
    state.callOrder.push("createApp");
    state.lastCreateAppRepository = repository;
    return {
      listen: vi.fn((_port: number, cb: () => void) => {
        state.callOrder.push("listen");
        cb();
        return new FakeHttpServer();
      }),
    };
  });

  const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return { state, FakeDrizzleRuleRepository, postgresConnection, createApp, loggerMock };
});

vi.mock("../../../src/adapters/outbound/persistence/postgres/connection", () => ({
  postgresConnection: fakes.postgresConnection,
}));
vi.mock("../../../src/adapters/outbound/persistence/postgres/DrizzleRuleRepository", () => ({
  DrizzleRuleRepository: fakes.FakeDrizzleRuleRepository,
}));
vi.mock("../../../src/adapters/inbound/http/app", () => ({ createApp: fakes.createApp }));
vi.mock("../../../src/main/Logger", () => ({ logger: fakes.loggerMock }));

async function loadStartServer() {
  return import("../../../src/main/startServer");
}

describe("startServer", () => {
  const registeredForCleanup: Array<{ signalHandlers: { SIGINT: () => void; SIGTERM: () => void } }> = [];

  beforeEach(() => {
    vi.resetModules();
    fakes.state.callOrder = [];
    fakes.state.shutdownCalls = 0;
    fakes.state.closeCalls = 0;
    fakes.state.lastRepositoryDb = undefined;
    fakes.state.lastCreateAppRepository = undefined;
    fakes.state.closeImpl = (cb) => cb();
    fakes.state.connectImpl = async () => fakes.state.fakeDb;
    fakes.postgresConnection.connect.mockClear();
    fakes.postgresConnection.shutdown.mockClear();
    fakes.createApp.mockClear();
    fakes.loggerMock.info.mockClear();
    fakes.loggerMock.error.mockClear();
    setEnv(VALID_ENV);
  });

  afterEach(() => {
    // Remove only the exact SIGINT/SIGTERM handlers startServer() registered
    // for this test (never process.removeAllListeners) so unrelated process
    // listeners — including vitest's own — are left untouched.
    for (const started of registeredForCleanup) {
      process.removeListener("SIGINT", started.signalHandlers.SIGINT);
      process.removeListener("SIGTERM", started.signalHandlers.SIGTERM);
    }
    registeredForCleanup.length = 0;
  });

  it("awaits postgresConnection.connect() before createApp/listen run", async () => {
    const { startServer } = await loadStartServer();

    const result = await startServer();
    registeredForCleanup.push(result);

    expect(fakes.state.callOrder).toEqual(["connect", "createApp", "listen"]);
  });

  it("constructs DrizzleRuleRepository with the db resolved by connect(), and injects it into createApp", async () => {
    const { startServer } = await loadStartServer();

    const result = await startServer();
    registeredForCleanup.push(result);

    expect(fakes.state.lastRepositoryDb).toBe(fakes.state.fakeDb);
    expect(fakes.state.lastCreateAppRepository).toBeInstanceOf(fakes.FakeDrizzleRuleRepository);
  });

  it("does not call createApp or listen when the database connection fails", async () => {
    fakes.state.connectImpl = async () => {
      throw new Error("connection refused");
    };
    const { startServer } = await loadStartServer();

    await expect(startServer()).rejects.toThrow("connection refused");

    expect(fakes.createApp).not.toHaveBeenCalled();
  });

  it("does not produce an unhandled rejection when startup fails", async () => {
    fakes.state.connectImpl = async () => {
      throw new Error("connection refused");
    };
    const { startServer } = await loadStartServer();

    await expect(startServer()).rejects.toThrow();
  });

  it("shutdown() closes the HTTP server and the PostgreSQL pool", async () => {
    const { startServer } = await loadStartServer();
    const result = await startServer();
    registeredForCleanup.push(result);

    await result.shutdown();

    expect(fakes.state.closeCalls).toBe(1);
    expect(fakes.state.shutdownCalls).toBe(1);
  });

  it("calling shutdown() twice only closes resources once", async () => {
    const { startServer } = await loadStartServer();
    const result = await startServer();
    registeredForCleanup.push(result);

    await result.shutdown();
    await result.shutdown();

    expect(fakes.state.closeCalls).toBe(1);
    expect(fakes.state.shutdownCalls).toBe(1);
  });

  it("still closes the PostgreSQL pool even if httpServer.close() fails", async () => {
    fakes.state.closeImpl = (cb) => cb(new Error("close failed"));
    const { startServer } = await loadStartServer();
    const result = await startServer();
    registeredForCleanup.push(result);

    await expect(result.shutdown()).rejects.toThrow("close failed");

    expect(fakes.state.shutdownCalls).toBe(1);
  });

  it("SIGINT triggers the same shutdown behavior, closing both resources exactly once", async () => {
    const { startServer } = await loadStartServer();
    const result = await startServer();
    registeredForCleanup.push(result);

    process.emit("SIGINT");
    // shutdown() runs asynchronously off the signal handler; flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fakes.state.closeCalls).toBe(1);
    expect(fakes.state.shutdownCalls).toBe(1);
  });

  it("a second SIGINT after shutdown has already run does not close resources again", async () => {
    const { startServer } = await loadStartServer();
    const result = await startServer();
    registeredForCleanup.push(result);

    await result.shutdown();
    // process.once means this second emit is a no-op even without our own
    // guard, but this also proves no stray listener was left registered.
    process.emit("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fakes.state.closeCalls).toBe(1);
    expect(fakes.state.shutdownCalls).toBe(1);
  });
});
