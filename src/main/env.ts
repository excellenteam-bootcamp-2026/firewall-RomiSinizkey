import { z } from "zod";

const envSchema = z.object({
  ENV: z.enum(["dev", "production"]),
  PORT: z.coerce.number().int().min(1).max(65535),
  DB_CONNECTION_INTERVAL: z.coerce.number().int().positive(),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
});

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
}

// One shared variable group for every environment. Which real values this
// resolves to is decided externally, by whichever .env (or injected
// environment) the process is actually started with — ENV only controls
// environment-specific application behavior (e.g. logging), not which set
// of database variables gets read.
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${formatIssues(parsed.error.issues)}`);
}

const env = parsed.data;

export const config = Object.freeze({
  env: env.ENV,
  port: env.PORT,
  dbConnectionIntervalMs: env.DB_CONNECTION_INTERVAL,
  database: Object.freeze({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  }),
});
