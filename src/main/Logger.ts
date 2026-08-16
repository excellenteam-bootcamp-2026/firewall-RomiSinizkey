import util from "util";
import path from "path";
import winston from "winston";
import { config } from "./env";

export const LOG_FILE_PATH = path.join(process.cwd(), "logs", "app.log");

type Level = "error" | "warn" | "info" | "debug";

const devFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

function buildWinstonLogger(): winston.Logger {
  if (config.env === "dev") {
    return winston.createLogger({
      level: "silly",
      format: devFormat,
      transports: [new winston.transports.Console()],
    });
  }

  return winston.createLogger({
    level: "info",
    format: prodFormat,
    transports: [new winston.transports.File({ filename: LOG_FILE_PATH })],
  });
}

class Logger {
  private static instance: Logger | null = null;

  // null once Winston fails to init or a transport reports a runtime error;
  // from then on every call falls back to the preserved native console methods.
  private winstonLogger: winston.Logger | null = null;
  private diagnosticEmitted = false;

  private readonly nativeConsole: {
    log: typeof console.log;
    error: typeof console.error;
    warn: typeof console.warn;
    info: typeof console.info;
    debug: typeof console.debug;
  };

  private constructor() {
    this.nativeConsole = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    };

    try {
      const winstonLogger = buildWinstonLogger();
      winstonLogger.on("error", (err) => this.fallBackToNativeConsole(err));
      this.winstonLogger = winstonLogger;
      // Patched last, and only on success: the transport above is already
      // fully constructed and writes through its own bound/raw stream, so
      // nothing inside it can call through this reassigned reference.
      console.log = (...args: unknown[]) => this.info(util.format(...args));
    } catch (err) {
      this.fallBackToNativeConsole(err);
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private fallBackToNativeConsole(err: unknown): void {
    console.log = this.nativeConsole.log;
    this.winstonLogger = null;

    if (!this.diagnosticEmitted) {
      this.diagnosticEmitted = true;
      this.nativeConsole.error(
        "[Logger] Winston failed to initialize or a transport reported an error; falling back to native console logging.",
        err,
      );
    }
  }

  private write(level: Level, message: string | Error, meta?: Record<string, unknown>): void {
    if (this.winstonLogger) {
      // Winston's LeveledLogMethod does accept Error via an `(message: any)`
      // overload, but TS can't select it through a dynamic `[level]` index.
      if (meta !== undefined) {
        this.winstonLogger[level](message as string, meta);
      } else {
        this.winstonLogger[level](message as string);
      }
      return;
    }
    if (meta !== undefined) {
      this.nativeConsole[level](message, meta);
    } else {
      this.nativeConsole[level](message);
    }
  }

  error(message: string | Error, meta?: Record<string, unknown>): void {
    this.write("error", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write("warn", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write("info", message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write("debug", message, meta);
  }
}

export const logger = Logger.getInstance();
export { Logger };
