export type RuleType = "ip" | "domain" | "port";

export type RuleMode = "blacklist" | "whitelist";

export type RuleValue = string | number;

export interface FirewallRule {
  id: number;
  type: RuleType;
  mode: RuleMode;
  value: RuleValue;
  active: boolean;
}

export type NewFirewallRule = Omit<FirewallRule, "id" | "active">;
