import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRuleRepository } from "../../../../../../src/adapters/outbound/persistence/memory/InMemoryRuleRepository";
import { NewFirewallRule } from "../../../../../../src/domain/entities/FirewallRule";

function ipRule(value = "10.0.0.1"): NewFirewallRule {
  return { type: "ip", mode: "blacklist", value };
}

function domainRule(value = "example.com"): NewFirewallRule {
  return { type: "domain", mode: "whitelist", value };
}

function portRule(value = 8080): NewFirewallRule {
  return { type: "port", mode: "blacklist", value };
}

describe("InMemoryRuleRepository", () => {
  let repository: InMemoryRuleRepository;

  beforeEach(() => {
    repository = new InMemoryRuleRepository();
  });

  describe("initial state and instance isolation", () => {
    it("starts empty", async () => {
      expect(await repository.getAll()).toEqual([]);
    });

    it("gives a fresh instance its own empty storage and its own ID counter starting at 1", async () => {
      const repoA = new InMemoryRuleRepository();
      await repoA.add([ipRule()]);

      const repoB = new InMemoryRuleRepository();
      const [createdInB] = await repoB.add([domainRule()]);

      expect(createdInB.id).toBe(1);
      expect(await repoB.getAll()).toEqual([createdInB]);
      expect(await repoB.getAll()).not.toContainEqual(expect.objectContaining({ type: "ip" }));
    });
  });

  describe("add", () => {
    it("generates a numeric ID and defaults active to true", async () => {
      const [created] = await repository.add([ipRule()]);

      expect(typeof created.id).toBe("number");
      expect(created.active).toBe(true);
    });

    it("generates unique sequential IDs for multiple rules added in one call", async () => {
      const created = await repository.add([ipRule(), domainRule(), portRule()]);

      expect(created.map((rule) => rule.id)).toEqual([1, 2, 3]);
    });

    it("keeps IDs sequential across separate add() calls", async () => {
      const [first] = await repository.add([ipRule()]);
      const [second] = await repository.add([domainRule()]);

      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
    });
  });

  describe("getAll", () => {
    it("returns all stored rules when called with no type", async () => {
      const created = await repository.add([ipRule(), domainRule(), portRule()]);

      expect(await repository.getAll()).toEqual(created);
    });

    it("returns a defensive copy of the rules array itself (not a deep copy of each rule object)", async () => {
      await repository.add([ipRule()]);

      const first = await repository.getAll();
      first.push(domainRule() as never);

      const second = await repository.getAll();
      expect(second).toHaveLength(1);
    });

    it("filters to only ip rules when called with type 'ip'", async () => {
      await repository.add([ipRule(), domainRule(), portRule()]);

      const result = await repository.getAll("ip");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("ip");
    });

    it("filters to only domain rules when called with type 'domain'", async () => {
      await repository.add([ipRule(), domainRule(), portRule()]);

      const result = await repository.getAll("domain");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("domain");
    });

    it("filters to only port rules when called with type 'port'", async () => {
      await repository.add([ipRule(), domainRule(), portRule()]);

      const result = await repository.getAll("port");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("port");
    });

    it("returns an empty array when the type filter matches nothing", async () => {
      await repository.add([ipRule()]);

      expect(await repository.getAll("port")).toEqual([]);
    });
  });

  describe("removeByIds", () => {
    it("returns the removed rules and removes them from storage on success", async () => {
      const [ruleOne, ruleTwo] = await repository.add([ipRule(), domainRule()]);

      const result = await repository.removeByIds([ruleOne.id]);

      expect(result).toEqual({ removed: [ruleOne], missingIds: [] });
      expect(await repository.getAll()).toEqual([ruleTwo]);
    });

    it("removes all requested rules when multiple valid IDs are given", async () => {
      const [ruleOne, , ruleThree] = await repository.add([ipRule(), domainRule(), portRule()]);

      const result = await repository.removeByIds([ruleOne.id, ruleThree.id]);

      expect(result.removed).toEqual(expect.arrayContaining([ruleOne, ruleThree]));
      expect(result.removed).toHaveLength(2);
      expect((await repository.getAll()).map((rule) => rule.id)).toEqual([2]);
    });

    it("removes nothing when the ID list includes a missing ID (atomic)", async () => {
      const [ruleOne, ruleTwo] = await repository.add([ipRule(), domainRule()]);

      const result = await repository.removeByIds([ruleOne.id, 99]);

      expect(result).toEqual({ removed: [], missingIds: [99] });
      expect(await repository.getAll()).toEqual([ruleOne, ruleTwo]);
    });

    // Edge-case characterization of the repository only: the application layer
    // (AddRulesUseCase / ruleValidation) already rejects an empty ids array before
    // it would ever reach the repository. This test documents what the repository
    // itself does if called directly with [], not a required API behavior.
    it("does nothing and reports no missing IDs when called with an empty array", async () => {
      const [ruleOne] = await repository.add([ipRule()]);

      const result = await repository.removeByIds([]);

      expect(result).toEqual({ removed: [], missingIds: [] });
      expect(await repository.getAll()).toEqual([ruleOne]);
    });
  });

  describe("updateStatus", () => {
    it("changes active for the requested rule on success", async () => {
      const [ruleOne, ruleTwo] = await repository.add([ipRule(), domainRule()]);

      const result = await repository.updateStatus([ruleOne.id], false);

      expect(result.missingIds).toEqual([]);
      expect(result.updated).toEqual([{ ...ruleOne, active: false }]);
      expect(await repository.getAll()).toEqual([
        { ...ruleOne, active: false },
        ruleTwo,
      ]);
    });

    it("updates all requested rules when multiple valid IDs are given", async () => {
      const [ruleOne, ruleTwo, ruleThree] = await repository.add([ipRule(), domainRule(), portRule()]);

      const result = await repository.updateStatus([ruleOne.id, ruleTwo.id], false);

      expect(result.updated.every((rule) => rule.active === false)).toBe(true);
      expect(result.updated.map((rule) => rule.id)).toEqual(
        expect.arrayContaining([ruleOne.id, ruleTwo.id])
      );
      expect((await repository.getAll()).find((rule) => rule.id === ruleThree.id)?.active).toBe(true);
    });

    it("changes nothing when the ID list includes a missing ID (atomic)", async () => {
      const [ruleOne, ruleTwo] = await repository.add([ipRule(), domainRule()]);

      const result = await repository.updateStatus([ruleOne.id, 99], false);

      expect(result).toEqual({ updated: [], missingIds: [99] });
      expect(await repository.getAll()).toEqual([ruleOne, ruleTwo]);
    });

    it("can flip active back to true", async () => {
      const [ruleOne] = await repository.add([ipRule()]);
      await repository.updateStatus([ruleOne.id], false);

      const result = await repository.updateStatus([ruleOne.id], true);

      expect(result.updated).toEqual([{ ...ruleOne, active: true }]);
    });
  });

  // Characterization only: the repository currently has no duplicate-rule
  // prevention, so adding the same { type, mode, value } twice creates two
  // separate entries with different IDs. This is not asserted as correct
  // behavior — Issue #19 (Project 6, domain hardening) is expected to change
  // this by introducing a type+mode+value identity check. No prevention logic
  // is implemented here.
  describe("current duplicate behavior", () => {
    it("currently allows adding the same { type, mode, value } twice as separate rules", async () => {
      const [first] = await repository.add([ipRule("10.0.0.1")]);
      const [second] = await repository.add([ipRule("10.0.0.1")]);

      expect(first.id).not.toBe(second.id);
      expect(await repository.getAll()).toHaveLength(2);
    });
  });
});
