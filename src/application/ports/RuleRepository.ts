import { FirewallRule, NewFirewallRule, RuleType } from "../../domain/entities/FirewallRule";

export interface RuleRepository {
  add(rules: NewFirewallRule[]): FirewallRule[];
  removeByIds(ids: number[]): { removed: FirewallRule[]; missingIds: number[] };
  getAll(type?: RuleType): FirewallRule[];
  updateStatus(ids: number[], active: boolean): { updated: FirewallRule[]; missingIds: number[] };
}
