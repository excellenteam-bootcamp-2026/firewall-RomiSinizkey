import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { EventEmitter } from "events";
import util from "util";
import fs from "fs";
import path from "path";

const ENV_KEYS = [
  "ENV",
  "PORT",
  "DB_CONNECTION_INTERVAL",
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
] as const;

// One shared DB_* group — the same variable names are valid regardless of
// which ENV value the tests below override onto this base fixture.
const VALID_ENV = {
  ENV: "dev",
  PORT: "3000",
  DB_CONNECTION_INTERVAL: "2000",
  DB_HOST: "localhost",
  DB_PORT: "5432",
  DB_USER: "user",
  DB_PASSWORD: "password",
  DB_NAME: "firewall_dev",
};

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value !== undefined) process.env[key] = value;
  }
}

const LOG_FILE_PATH = path.join(process.cwd(), "logs", "app.log");
const MESSAGE = Symbol.for("message");
const LEVEL = Symbol.for("level");

// Captured once, at file-load time, before any test can possibly have
// patched console.log - this is the one reference every restoration check
// below compares against, so a leaked patch from an earlier test is
// actually detectable instead of comparing a value against itself.
const nativeConsoleLog = console.log;

// Fakes + mock state for winston.createLogger/transports.Console/transports.File.
// Defined via vi.hoisted() so they're available inside the hoisted vi.mock()
// factory below, and re-used (not re-created) across every vi.resetModules()
// call, which is what lets us get a *fresh* Logger singleton per test while
// still inspecting/controlling the *same* winston mock across all of them.
const winstonMock = vi.hoisted(() => {
  class FakeConsoleTransport {
    options?: unknown;
    constructor(options?: unknown) {
      this.options = options;
    }
  }
  class FakeFileTransport {
    filename: string;
    constructor(options: { filename: string }) {
      this.filename = options.filename;
    }
  }

  const state: {
    createLoggerCalls: Array<{ level?: string; format?: unknown; transports?: unknown[] }>;
    lastLogger: (EventEmitter & Record<string, unknown>) | null;
    shouldThrowSync: boolean;
  } = {
    createLoggerCalls: [],
    lastLogger: null,
    shouldThrowSync: false,
  };

  function mockCreateLogger(options: { level?: string; format?: unknown; transports?: unknown[] }) {
    state.createLoggerCalls.push(options);
    if (state.shouldThrowSync) {
      throw new Error("simulated synchronous winston init failure");
    }
    const fake = new EventEmitter() as EventEmitter & Record<string, unknown>;
    fake.info = vi.fn();
    fake.warn = vi.fn();
    fake.error = vi.fn();
    fake.debug = vi.fn();
    state.lastLogger = fake;
    return fake;
  }

  return { FakeConsoleTransport, FakeFileTransport, state, mockCreateLogger };
});

// Only createLogger and the two transport constructors are faked - format
// (timestamp/colorize/printf/errors/json/combine) stays the real winston
// implementation, so format-related assertions below exercise real behavior.
// Faking the transports specifically prevents the real File transport's
// constructor from ever touching the filesystem (it auto-creates its parent
// directory as a side effect of being constructed - see file.js).
vi.mock("winston", async () => {
  const actual = await vi.importActual<typeof import("winston")>("winston");
  const fakeNamespace = {
    ...actual,
    createLogger: winstonMock.mockCreateLogger,
    transports: {
      ...actual.transports,
      Console: winstonMock.FakeConsoleTransport,
      File: winstonMock.FakeFileTransport,
    },
  };
  return { ...fakeNamespace, default: fakeNamespace };
});

async function loadLogger() {
  return import("../../../src/main/Logger");
}

describe("Logger.ts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    winstonMock.state.createLoggerCalls.length = 0;
    winstonMock.state.lastLogger = null;
    winstonMock.state.shouldThrowSync = false;

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    // console.log is reassigned by Logger.ts as a plain property (not through
    // vi.spyOn), so vi.restoreAllMocks() alone would not undo that patch.
    console.log = nativeConsoleLog;
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Only the log file itself must not exist. An empty logs/ directory is
    // harmless, untracked by Git, and may legitimately pre-exist from a
    // manual production smoke test - the mocked File transport (see
    // winstonMock above) never touches the real filesystem, so this checks
    // that the tests themselves created nothing persistent.
    expect(fs.existsSync(LOG_FILE_PATH)).toBe(false);
  });

  it("getInstance() always returns the same instance (explicit Singleton)", async () => {
    setEnv(VALID_ENV);
    const { Logger } = await loadLogger();

    const first = Logger.getInstance();
    const second = Logger.getInstance();

    expect(first).toBe(second);
  });

  it("calls winston.createLogger exactly once, even across multiple getInstance() calls", async () => {
    setEnv(VALID_ENV);
    const { Logger } = await loadLogger();

    Logger.getInstance();
    Logger.getInstance();
    Logger.getInstance();

    expect(winstonMock.state.createLoggerCalls.length).toBe(1);
  });

  it("configures a Console transport at level 'silly' in dev", async () => {
    setEnv({ ...VALID_ENV, ENV: "dev" });
    const { Logger } = await loadLogger();

    Logger.getInstance();

    const call = winstonMock.state.createLoggerCalls[0];
    expect(call.level).toBe("silly");
    expect(call.transports?.[0]).toBeInstanceOf(winstonMock.FakeConsoleTransport);
  });

  it("configures a File transport at logs/app.log, level 'info', in production", async () => {
    setEnv({ ...VALID_ENV, ENV: "production" });
    const { Logger } = await loadLogger();

    Logger.getInstance();

    const call = winstonMock.state.createLoggerCalls[0];
    expect(call.level).toBe("info");
    const transport = call.transports?.[0] as InstanceType<typeof winstonMock.FakeFileTransport>;
    expect(transport).toBeInstanceOf(winstonMock.FakeFileTransport);
    expect(transport.filename).toBe(LOG_FILE_PATH);
  });

  it("dev format renders a readable line with timestamp, level, and message", async () => {
    setEnv({ ...VALID_ENV, ENV: "dev" });
    const { Logger } = await loadLogger();
    Logger.getInstance();

    const format = winstonMock.state.createLoggerCalls[0].format as { transform: (info: unknown) => Record<symbol, unknown> };
    // The real Logger (winston.Logger) always sets info[LEVEL] before running
    // the format chain; colorize() depends on it, so it must be set here too
    // to exercise the same path a real log call would take.
    const out = format.transform({ level: "info", message: "hello world", [LEVEL]: "info" });

    const rendered = String(out[MESSAGE]);
    expect(rendered).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(rendered).toMatch(/info/i);
    expect(rendered).toContain("hello world");
  });

  it("prod format renders JSON with timestamp, level, message, metadata, and an Error stack", async () => {
    setEnv({ ...VALID_ENV, ENV: "production" });
    const { Logger } = await loadLogger();
    Logger.getInstance();

    const format = winstonMock.state.createLoggerCalls[0].format as { transform: (info: unknown) => Record<symbol, unknown> };
    const err = new Error("boom");
    const out = format.transform({ level: "error", message: err, requestId: "abc-123", [LEVEL]: "error" });
    const parsed = JSON.parse(String(out[MESSAGE]));

    expect(parsed.level).toBe("error");
    expect(parsed.message).toBe("boom");
    expect(typeof parsed.timestamp).toBe("string");
    expect(typeof parsed.stack).toBe("string");
    expect(parsed.requestId).toBe("abc-123");
  });

  it("redirects console.log through the Logger using util.format for multi-argument input", async () => {
    setEnv({ ...VALID_ENV, ENV: "dev" });
    await loadLogger();

    const err = new Error("bad thing");
    console.log("value:", 42, err);

    const expected = util.format("value:", 42, err);
    expect(winstonMock.state.lastLogger?.info).toHaveBeenCalledWith(expected);
  });

  it("never calls the original console.log from inside the Logger's own writes (no recursion)", async () => {
    setEnv({ ...VALID_ENV, ENV: "dev" });
    const nativeLogSpy = vi.fn();
    console.log = nativeLogSpy;

    const { logger } = await loadLogger();
    logger.info("direct call, not through console.log");

    expect(nativeLogSpy).not.toHaveBeenCalled();
  });

  it("leaves console.log functionally native and emits one diagnostic when winston.createLogger throws synchronously", async () => {
    setEnv({ ...VALID_ENV, ENV: "dev" });
    winstonMock.state.shouldThrowSync = true;

    // fallBackToNativeConsole restores console.log via a bound copy captured
    // at construction time (this.nativeConsole.log = console.log.bind(...)),
    // the same pattern winston's own Console transport uses - so it is never
    // strictly === the pre-construction reference. Assert it still forwards
    // to the original function instead of comparing identity.
    const nativeLogSpy = vi.fn();
    console.log = nativeLogSpy;

    const { Logger } = await loadLogger();
    Logger.getInstance();

    console.log("still native");
    expect(nativeLogSpy).toHaveBeenCalledWith("still native");
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("falls back to native console when the winston logger emits an asynchronous 'error' event", async () => {
    setEnv({ ...VALID_ENV, ENV: "dev" });
    const nativeLogSpy = vi.fn();
    console.log = nativeLogSpy;

    const { logger } = await loadLogger();
    expect(console.log).not.toBe(nativeLogSpy); // sanity: the patch is active

    winstonMock.state.lastLogger?.emit("error", new Error("disk full"));

    console.log("after fallback");
    expect(nativeLogSpy).toHaveBeenCalledWith("after fallback");
    expect(console.error).toHaveBeenCalledTimes(1);

    logger.info("still works after fallback");
    expect(console.info).toHaveBeenCalledWith("still works after fallback");
  });

  it("does not emit a duplicate diagnostic if the transport 'error' event fires more than once", async () => {
    setEnv({ ...VALID_ENV, ENV: "dev" });
    await loadLogger();

    winstonMock.state.lastLogger?.emit("error", new Error("first failure"));
    winstonMock.state.lastLogger?.emit("error", new Error("second failure"));

    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("continues serving info/warn/error/debug through native console after fallback", async () => {
    setEnv({ ...VALID_ENV, ENV: "production" });
    const { logger } = await loadLogger();

    winstonMock.state.lastLogger?.emit("error", new Error("write failed"));

    logger.info("info after fallback");
    logger.warn("warn after fallback");
    logger.error("error after fallback");
    logger.debug("debug after fallback");

    expect(console.info).toHaveBeenCalledWith("info after fallback");
    expect(console.warn).toHaveBeenCalledWith("warn after fallback");
    expect(console.error).toHaveBeenCalledWith("error after fallback");
    expect(console.debug).toHaveBeenCalledWith("debug after fallback");
  });

  it("restores console.log to the native function between tests (no cross-test leakage)", () => {
    expect(console.log).toBe(nativeConsoleLog);
  });
});
