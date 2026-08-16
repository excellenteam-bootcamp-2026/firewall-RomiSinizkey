import { z } from "zod";

function hasHostAndPort(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.length > 0 && url.port.length > 0;
  } catch {
    return false;
  }
}

const databaseUriSchema = z.url().refine(hasHostAndPort, {
  message: "must be a valid connection URI with an explicit host and port (e.g. scheme://host:5432/dbname)",
});

const envSchema = z.object({
  ENV: z.enum(["dev", "production"]),
  PORT: z.coerce.number().int().min(1).max(65535),
  DEV_DATABASE_URI: databaseUriSchema,
  PRODUCTION_DATABASE_URI: databaseUriSchema,
});

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${formatIssues(parsed.error.issues)}`);
}

const env = parsed.data;

const databaseUri = env.ENV === "dev" ? env.DEV_DATABASE_URI : env.PRODUCTION_DATABASE_URI;

export const config = Object.freeze({
  env: env.ENV,
  port: env.PORT,
  databaseUri,
});
