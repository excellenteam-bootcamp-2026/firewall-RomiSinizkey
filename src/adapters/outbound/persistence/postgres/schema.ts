import { sql } from "drizzle-orm";
import { boolean, check, pgTable, serial, text } from "drizzle-orm/pg-core";

export const firewallRules = pgTable(
  "firewall_rules",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    mode: text("mode").notNull(),
    value: text("value").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    check("firewall_rules_type_check", sql`${table.type} IN ('ip', 'domain', 'port')`),
    check("firewall_rules_mode_check", sql`${table.mode} IN ('blacklist', 'whitelist')`),
  ],
);
