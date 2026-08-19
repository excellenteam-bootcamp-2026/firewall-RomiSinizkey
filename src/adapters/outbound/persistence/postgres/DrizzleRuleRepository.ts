import { asc, eq, inArray } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { firewallRules } from "./schema";
import { toDomainRule, toInsertRow } from "./ruleMapper";
import { FirewallRule, NewFirewallRule, RuleType } from "../../../../domain/entities/FirewallRule";
import { RuleRepository } from "../../../../application/ports/RuleRepository";

function byIdAscending(a: FirewallRule, b: FirewallRule): number {
  return a.id - b.id;
}

export class DrizzleRuleRepository implements RuleRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async add(rules: NewFirewallRule[]): Promise<FirewallRule[]> {
    if (rules.length === 0) {
      return [];
    }

    const rows = await this.db
      .insert(firewallRules)
      .values(rules.map(toInsertRow))
      .returning();

    return rows.map(toDomainRule).sort(byIdAscending);
  }

  async getAll(type?: RuleType): Promise<FirewallRule[]> {
    const rows = type
      ? await this.db
          .select()
          .from(firewallRules)
          .where(eq(firewallRules.type, type))
          .orderBy(asc(firewallRules.id))
      : await this.db.select().from(firewallRules).orderBy(asc(firewallRules.id));

    return rows.map(toDomainRule);
  }

  async removeByIds(ids: number[]): Promise<{ removed: FirewallRule[]; missingIds: number[] }> {
    if (ids.length === 0) {
      return { removed: [], missingIds: [] };
    }

    return this.db.transaction(async (tx) => {
      const uniqueIds = [...new Set(ids)];

      const locked = await tx
        .select()
        .from(firewallRules)
        .where(inArray(firewallRules.id, uniqueIds))
        .for("update");

      const existingIds = new Set(locked.map((row) => row.id));
      const missingIds = ids.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        return { removed: [], missingIds };
      }

      const deleted = await tx.delete(firewallRules).where(inArray(firewallRules.id, uniqueIds)).returning();

      return { removed: deleted.map(toDomainRule).sort(byIdAscending), missingIds: [] };
    });
  }

  async updateStatus(ids: number[], active: boolean): Promise<{ updated: FirewallRule[]; missingIds: number[] }> {
    if (ids.length === 0) {
      return { updated: [], missingIds: [] };
    }

    return this.db.transaction(async (tx) => {
      const uniqueIds = [...new Set(ids)];

      const locked = await tx
        .select()
        .from(firewallRules)
        .where(inArray(firewallRules.id, uniqueIds))
        .for("update");

      const existingIds = new Set(locked.map((row) => row.id));
      const missingIds = ids.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        return { updated: [], missingIds };
      }

      const updated = await tx
        .update(firewallRules)
        .set({ active })
        .where(inArray(firewallRules.id, uniqueIds))
        .returning();

      return { updated: updated.map(toDomainRule).sort(byIdAscending), missingIds: [] };
    });
  }
}
