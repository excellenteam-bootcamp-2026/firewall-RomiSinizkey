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

// Deletes the known keys first, then applies only the given overrides, so a
// developer's real shell-level env vars (or a locally loaded .env) can never
// leak into a test — every test's process.env state is fully explicit.
function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value !== undefined) process.env[key] = value;
  }
}

async function loadConfig() {
  const { config } = await import("../../../src/main/env");
  return config;
}

describe("env.ts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("resolves config.database from the single DB_* group when ENV=dev", async () => {
    setEnv(VALID_ENV);

    const config = await loadConfig();

    expect(config.env).toBe("dev");
    expect(config.port).toBe(3000);
    expect(config.dbConnectionIntervalMs).toBe(2000);
    expect(config.database).toEqual({
      host: "localhost",
      port: 5432,
      user: "app_user",
      password: "s3cret-P@ss",
      database: "firewall_dev",
    });
  });

  it("resolves config.database from the same DB_* variable names when ENV=production", async () => {
    setEnv({ ...VALID_ENV, ENV: "production" });

    const config = await loadConfig();

    expect(config.env).toBe("production");
    expect(config.database).toEqual({
      host: "localhost",
      port: 5432,
      user: "app_user",
      password: "s3cret-P@ss",
      database: "firewall_dev",
    });
  });

  it("only exposes env, port, dbConnectionIntervalMs, database, and rabbitmq", async () => {
    setEnv(VALID_ENV);

    const config = await loadConfig();

    expect(Object.keys(config).sort()).toEqual([
      "database",
      "dbConnectionIntervalMs",
      "env",
      "port",
      "rabbitmq",
    ]);
    expect(Object.keys(config.database).sort()).toEqual(["database", "host", "password", "port", "user"]);
    expect(Object.keys(config.rabbitmq).sort()).toEqual(["exchange", "queue", "routingPrefix", "url"]);
  });

  it("resolves config.rabbitmq from the CLOUDAMQP_URL/RABBITMQ_* group", async () => {
    setEnv(VALID_ENV);

    const config = await loadConfig();

    expect(config.rabbitmq).toEqual({
      url: "amqps://user:pass@host/vhost",
      exchange: "firewall.commands",
      queue: "romi.firewall.commands",
      routingPrefix: "romi",
    });
  });

  it("throws when ENV is missing", async () => {
    setEnv({ ...VALID_ENV, ENV: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when ENV is an invalid value", async () => {
    setEnv({ ...VALID_ENV, ENV: "staging" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when PORT is missing", async () => {
    setEnv({ ...VALID_ENV, PORT: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when PORT is out of range", async () => {
    setEnv({ ...VALID_ENV, PORT: "70000" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when PORT is not an integer", async () => {
    setEnv({ ...VALID_ENV, PORT: "3000.5" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when DB_CONNECTION_INTERVAL is missing", async () => {
    setEnv({ ...VALID_ENV, DB_CONNECTION_INTERVAL: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when DB_CONNECTION_INTERVAL is not a positive integer", async () => {
    setEnv({ ...VALID_ENV, DB_CONNECTION_INTERVAL: "0" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when DB_HOST is missing", async () => {
    setEnv({ ...VALID_ENV, DB_HOST: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when DB_PORT is out of range", async () => {
    setEnv({ ...VALID_ENV, DB_PORT: "70000" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when DB_USER is missing", async () => {
    setEnv({ ...VALID_ENV, DB_USER: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when DB_PASSWORD is missing", async () => {
    setEnv({ ...VALID_ENV, DB_PASSWORD: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when DB_NAME is missing", async () => {
    setEnv({ ...VALID_ENV, DB_NAME: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when CLOUDAMQP_URL is missing", async () => {
    setEnv({ ...VALID_ENV, CLOUDAMQP_URL: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when CLOUDAMQP_URL is blank", async () => {
    setEnv({ ...VALID_ENV, CLOUDAMQP_URL: "" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when RABBITMQ_EXCHANGE is missing", async () => {
    setEnv({ ...VALID_ENV, RABBITMQ_EXCHANGE: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when RABBITMQ_EXCHANGE is blank", async () => {
    setEnv({ ...VALID_ENV, RABBITMQ_EXCHANGE: "" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when RABBITMQ_QUEUE is missing", async () => {
    setEnv({ ...VALID_ENV, RABBITMQ_QUEUE: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when RABBITMQ_QUEUE is blank", async () => {
    setEnv({ ...VALID_ENV, RABBITMQ_QUEUE: "" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when RABBITMQ_ROUTING_PREFIX is missing", async () => {
    setEnv({ ...VALID_ENV, RABBITMQ_ROUTING_PREFIX: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when RABBITMQ_ROUTING_PREFIX is blank", async () => {
    setEnv({ ...VALID_ENV, RABBITMQ_ROUTING_PREFIX: "" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("a validation-failure error never contains the configured password value", async () => {
    // DB_HOST is what's invalid here; DB_PASSWORD is still a valid, real-looking
    // secret in process.env at the time env.ts throws — the error message must
    // not echo it regardless of which field actually failed.
    setEnv({ ...VALID_ENV, DB_HOST: undefined });

    try {
      await loadConfig();
      expect.unreachable("expected loadConfig() to throw");
    } catch (err) {
      expect(String(err)).not.toContain(VALID_ENV.DB_PASSWORD);
      expect(String(err)).not.toContain(VALID_ENV.DB_USER);
    }
  });

  it("exports a frozen config object and a frozen database sub-object", async () => {
    setEnv(VALID_ENV);

    const config = await loadConfig();

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);

    expect(() => {
      (config as unknown as { port: number }).port = 9999;
    }).toThrow(TypeError);

    expect(() => {
      (config.database as unknown as { host: string }).host = "changed";
    }).toThrow(TypeError);
  });

  it("exports a frozen rabbitmq sub-object", async () => {
    setEnv(VALID_ENV);

    const config = await loadConfig();

    expect(Object.isFrozen(config.rabbitmq)).toBe(true);

    expect(() => {
      (config.rabbitmq as unknown as { url: string }).url = "changed";
    }).toThrow(TypeError);
  });
});
