import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { config } from "./src/main/env";

export default defineConfig({
  schema: "./src/adapters/outbound/persistence/postgres/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
      ssl: false,
  },
});
