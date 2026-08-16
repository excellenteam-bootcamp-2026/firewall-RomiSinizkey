import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEYS = ["ENV", "PORT", "DEV_DATABASE_URI", "PRODUCTION_DATABASE_URI"] as const;

const VALID_ENV = {
  ENV: "dev",
  PORT: "3000",
  DEV_DATABASE_URI: "postgres://user:password@localhost:5432/firewall_dev",
  PRODUCTION_DATABASE_URI: "postgres://user:password@localhost:5432/firewall_prod",
};

// Deletes the 4 known keys first, then applies only the given overrides, so a
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

  it("resolves config.databaseUri to the dev URI when ENV=dev", async () => {
    setEnv(VALID_ENV);

    const config = await loadConfig();

    expect(config.env).toBe("dev");
    expect(config.port).toBe(3000);
    expect(config.databaseUri).toBe(VALID_ENV.DEV_DATABASE_URI);
  });

  it("resolves config.databaseUri to the production URI when ENV=production", async () => {
    setEnv({ ...VALID_ENV, ENV: "production" });

    const config = await loadConfig();

    expect(config.env).toBe("production");
    expect(config.databaseUri).toBe(VALID_ENV.PRODUCTION_DATABASE_URI);
  });

  it("only exposes env, port, and the selected databaseUri (not both raw URIs)", async () => {
    setEnv(VALID_ENV);

    const config = await loadConfig();

    expect(Object.keys(config).sort()).toEqual(["databaseUri", "env", "port"]);
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

  it("throws when DEV_DATABASE_URI is missing", async () => {
    setEnv({ ...VALID_ENV, DEV_DATABASE_URI: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when PRODUCTION_DATABASE_URI is missing", async () => {
    setEnv({ ...VALID_ENV, PRODUCTION_DATABASE_URI: undefined });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when a database URI is not a valid URL", async () => {
    setEnv({ ...VALID_ENV, DEV_DATABASE_URI: "not-a-url" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when a database URI has no explicit port", async () => {
    setEnv({ ...VALID_ENV, DEV_DATABASE_URI: "postgres://user:password@localhost/firewall_dev" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws when a database URI has no hostname", async () => {
    setEnv({ ...VALID_ENV, DEV_DATABASE_URI: "postgres:///firewall_dev" });

    await expect(loadConfig()).rejects.toThrow();
  });

  it("does not restrict the database URI to a postgres:// protocol", async () => {
    setEnv({ ...VALID_ENV, DEV_DATABASE_URI: "mysql://user:password@localhost:3306/firewall_dev" });

    const config = await loadConfig();

    expect(config.databaseUri).toBe("mysql://user:password@localhost:3306/firewall_dev");
  });

  it("exports a frozen config object", async () => {
    setEnv(VALID_ENV);

    const config = await loadConfig();

    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      (config as unknown as { port: number }).port = 9999;
    }).toThrow(TypeError);
  });
});
