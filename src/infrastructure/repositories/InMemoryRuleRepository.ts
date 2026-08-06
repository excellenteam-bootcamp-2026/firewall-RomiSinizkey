import { FirewallRule, NewFirewallRule, RuleType } from "../../domain/entities/FirewallRule";
import { RuleRepository } from "../../domain/ports/RuleRepository";

export class InMemoryRuleRepository implements RuleRepository {
  private rules: FirewallRule[] = [];
  private nextId = 1;

  add(newRules: NewFirewallRule[]): FirewallRule[] {
    const created = newRules.map((rule) => ({ ...rule, id: this.nextId++, active: true }));
    this.rules.push(...created);
    return created;
  }

  removeByIds(ids: number[]): { removed: FirewallRule[]; missingIds: number[] } {
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

  getAll(type?: RuleType): FirewallRule[] {
    return type ? this.rules.filter((rule) => rule.type === type) : [...this.rules];
  }

  updateStatus(ids: number[], active: boolean): { updated: FirewallRule[]; missingIds: number[] } {
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
