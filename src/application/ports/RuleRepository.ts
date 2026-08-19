import { FirewallRule, NewFirewallRule, RuleType } from "../../domain/entities/FirewallRule";

export interface RuleRepository {
  add(rules: NewFirewallRule[]): Promise<FirewallRule[]>;
  removeByIds(ids: number[]): Promise<{ removed: FirewallRule[]; missingIds: number[] }>;
  getAll(type?: RuleType): Promise<FirewallRule[]>;
  updateStatus(ids: number[], active: boolean): Promise<{ updated: FirewallRule[]; missingIds: number[] }>;
}
