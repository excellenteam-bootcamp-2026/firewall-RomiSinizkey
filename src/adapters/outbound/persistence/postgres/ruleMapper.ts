import { firewallRules } from "./schema";
import { FirewallRule, NewFirewallRule } from "../../../../domain/entities/FirewallRule";
import { assertValidMode, assertValidPorts, assertValidRuleType } from "../../../../application/validation/ruleValidation";

export type FirewallRuleRow = typeof firewallRules.$inferSelect;
export type NewFirewallRuleRow = typeof firewallRules.$inferInsert;

function parsePortValue(text: string): number {
  const port = Number(text);
  assertValidPorts([port]);
  return port;
}

export function toDomainRule(row: FirewallRuleRow): FirewallRule {
  assertValidRuleType(row.type);
  assertValidMode(row.mode);

  return {
    id: row.id,
    type: row.type,
    mode: row.mode,
    value: row.type === "port" ? parsePortValue(row.value) : row.value,
    active: row.active,
  };
}

export function toInsertRow(rule: NewFirewallRule): NewFirewallRuleRow {
  return {
    type: rule.type,
    mode: rule.mode,
    value: String(rule.value),
    active: true,
  };
}
