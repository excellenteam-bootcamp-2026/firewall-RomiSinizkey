import { FirewallRule, RuleType } from "../../domain/entities/FirewallRule";
import { RuleRepository } from "../ports/RuleRepository";
import { assertValidRuleType } from "../validation/ruleValidation";

export interface RulesByMode {
  blacklist: FirewallRule[];
  whitelist: FirewallRule[];
}

export type GetRulesResult = Partial<Record<"ips" | "domains" | "ports", RulesByMode>>;

const RESPONSE_KEY_BY_TYPE: Record<RuleType, "ips" | "domains" | "ports"> = {
  ip: "ips",
  domain: "domains",
  port: "ports",
};

function groupByMode(rules: FirewallRule[]): RulesByMode {
  return {
    blacklist: rules.filter((rule) => rule.mode === "blacklist"),
    whitelist: rules.filter((rule) => rule.mode === "whitelist"),
  };
}

export class GetRulesUseCase {
  constructor(private readonly repository: RuleRepository) {}

  execute(rawType?: unknown): GetRulesResult {
    if (rawType !== undefined) {
      assertValidRuleType(rawType);
      const rules = this.repository.getAll(rawType);
      return { [RESPONSE_KEY_BY_TYPE[rawType]]: groupByMode(rules) };
    }

    const all = this.repository.getAll();
    return {
      ips: groupByMode(all.filter((rule) => rule.type === "ip")),
      domains: groupByMode(all.filter((rule) => rule.type === "domain")),
      ports: groupByMode(all.filter((rule) => rule.type === "port")),
    };
  }
}
