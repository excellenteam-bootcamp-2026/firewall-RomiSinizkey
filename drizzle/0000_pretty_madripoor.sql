CREATE TABLE "firewall_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"mode" text NOT NULL,
	"value" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "firewall_rules_type_check" CHECK ("firewall_rules"."type" IN ('ip', 'domain', 'port')),
	CONSTRAINT "firewall_rules_mode_check" CHECK ("firewall_rules"."mode" IN ('blacklist', 'whitelist'))
);
