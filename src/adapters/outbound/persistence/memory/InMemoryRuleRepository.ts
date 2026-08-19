import { FirewallRule, NewFirewallRule, RuleType } from "../../../../domain/entities/FirewallRule";
import { RuleRepository } from "../../../../application/ports/RuleRepository";

export class InMemoryRuleRepository implements RuleRepository {
  private rules: FirewallRule[] = [];
  private nextId = 1;

  async add(newRules: NewFirewallRule[]): Promise<FirewallRule[]> {
    const created = newRules.map((rule) => ({ ...rule, id: this.nextId++, active: true }));
    this.rules.push(...created);
    return created;
  }

  async removeByIds(ids: number[]): Promise<{ removed: FirewallRule[]; missingIds: number[] }> {
    const idSet = new Set(ids);
    const existingIds = new Set(this.rules.map((rule) => rule.id));
    const missingIds = ids.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      return { removed: [], missingIds };
    }

    const removed = this.rules.filter((rule) => idSet.has(rule.id));
    this.rules = this.rules.filter((rule) => !idSet.has(rule.id));

    return { removed, missingIds };
  }

  async getAll(type?: RuleType): Promise<FirewallRule[]> {
    return type ? this.rules.filter((rule) => rule.type === type) : [...this.rules];
  }

  async updateStatus(ids: number[], active: boolean): Promise<{ updated: FirewallRule[]; missingIds: number[] }> {
    const idSet = new Set(ids);
    const existingIds = new Set(this.rules.map((rule) => rule.id));
    const missingIds = ids.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      return { updated: [], missingIds };
    }

    const updated: FirewallRule[] = [];
    for (const rule of this.rules) {
      if (idSet.has(rule.id)) {
        rule.active = active;
        updated.push(rule);
      }
    }

    return { updated, missingIds };
  }
}
