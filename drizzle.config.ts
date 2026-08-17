import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { config } from "./src/main/env";

export default defineConfig({
  schema: "./src/adapters/outbound/persistence/postgres/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: config.databaseUri,
  },
});
