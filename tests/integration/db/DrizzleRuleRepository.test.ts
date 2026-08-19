import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { DrizzleRuleRepository } from "../../../src/adapters/outbound/persistence/postgres/DrizzleRuleRepository";
import { NewFirewallRule } from "../../../src/domain/entities/FirewallRule";
import {
  hasTestDatabaseConfig,
  getTestDb,
  runTestMigrations,
  cleanupFirewallRules,
  closeTestDb,
} from "./testDatabase";

// Runs against a real, isolated PostgreSQL database (TEST_DB_NAME, guarded to
// end with "_test" — see testDatabase.ts). Skips entirely when no test
// database is configured, so `npm test` stays DB-free by default and only
// exercises this file where TEST_DB_* is actually set (locally, opt-in, or in
// CI's Postgres service).

function ipRule(value = "10.0.0.1"): NewFirewallRule {
  return { type: "ip", mode: "blacklist", value };
}

function domainRule(value = "example.com"): NewFirewallRule {
  return { type: "domain", mode: "whitelist", value };
}

function portRule(value = 8080): NewFirewallRule {
  return { type: "port", mode: "blacklist", value };
}

describe.skipIf(!hasTestDatabaseConfig)("DrizzleRuleRepository (integration, real PostgreSQL)", () => {
  let repository: DrizzleRuleRepository;

  beforeAll(async () => {
    await runTestMigrations();
  }, 30000);

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanupFirewallRules();
    repository = new DrizzleRuleRepository(getTestDb());
  });

  describe("add", () => {
    it("inserts an IP rule and returns it with a generated id and active: true", async () => {
      const [created] = await repository.add([ipRule("203.0.113.5")]);

      expect(created).toMatchObject({
        type: "ip",
        mode: "blacklist",
        value: "203.0.113.5",
        active: true,
      });
      expect(typeof created.id).toBe("number");
    });

    it("inserts a domain rule, keeping the value a string", async () => {
      const [created] = await repository.add([domainRule("example.com")]);

      expect(created.value).toBe("example.com");
      expect(typeof created.value).toBe("string");
    });

    it("inserts a port rule and the stored text round-trips as a number", async () => {
      const [created] = await repository.add([portRule(8080)]);

      expect(created.value).toBe(8080);
      expect(typeof created.value).toBe("number");
    });

    it("inserts multiple rules in one call, returned in ascending id order", async () => {
      const created = await repository.add([ipRule("1.1.1.1"), domainRule("a.com"), portRule(22)]);

      expect(created).toHaveLength(3);
      expect(created.map((rule) => rule.id)).toEqual(
        [...created.map((rule) => rule.id)].sort((a, b) => a - b)
      );
    });

    it("returns [] for an empty array without issuing invalid SQL", async () => {
      await expect(repository.add([])).resolves.toEqual([]);
    });
  });

  describe("getAll", () => {
    it("returns all rules in ascending id order when called with no type", async () => {
      await repository.add([ipRule("1.1.1.1"), domainRule("a.com"), portRule(22)]);

      const all = await repository.getAll();

      expect(all).toHaveLength(3);
      expect(all.map((rule) => rule.id)).toEqual([...all.map((rule) => rule.id)].sort((a, b) => a - b));
    });

    it("filters to only the requested type", async () => {
      await repository.add([ipRule("1.1.1.1"), domainRule("a.com"), portRule(22)]);

      const ips = await repository.getAll("ip");

      expect(ips).toHaveLength(1);
      expect(ips[0].type).toBe("ip");
    });

    it("returns [] when the filter matches nothing", async () => {
      await repository.add([ipRule()]);

      expect(await repository.getAll("port")).toEqual([]);
    });
  });

  describe("removeByIds", () => {
    it("removes the requested rule; a follow-up getAll() confirms it is gone", async () => {
      const [created] = await repository.add([ipRule()]);

      const result = await repository.removeByIds([created.id]);

      expect(result).toEqual({ removed: [created], missingIds: [] });
      expect(await repository.getAll()).toEqual([]);
    });

    it("removes multiple requested rules, leaving others untouched", async () => {
      const [a, , c] = await repository.add([ipRule("1.1.1.1"), domainRule("a.com"), portRule(22)]);

      const result = await repository.removeByIds([a.id, c.id]);

      expect(result.removed.map((rule) => rule.id).sort()).toEqual([a.id, c.id].sort());
      const remaining = await repository.getAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).not.toBe(a.id);
      expect(remaining[0].id).not.toBe(c.id);
    });

    it("deletes nothing when one requested id does not exist (atomic, transactional rollback)", async () => {
      const [created] = await repository.add([ipRule()]);

      const result = await repository.removeByIds([created.id, 999999]);

      expect(result).toEqual({ removed: [], missingIds: [999999] });
      expect(await repository.getAll()).toEqual([created]);
    });

    it("returns { removed: [], missingIds: [] } for an empty array without issuing invalid SQL", async () => {
      await expect(repository.removeByIds([])).resolves.toEqual({ removed: [], missingIds: [] });
    });

    it("does not duplicate a row in the result when the same existing id is requested twice", async () => {
      const [created] = await repository.add([ipRule()]);

      const result = await repository.removeByIds([created.id, created.id]);

      expect(result).toEqual({ removed: [created], missingIds: [] });
    });

    it("repeats a missing id once per occurrence in the request, matching InMemoryRuleRepository", async () => {
      const result = await repository.removeByIds([999999, 999999]);

      expect(result).toEqual({ removed: [], missingIds: [999999, 999999] });
    });
  });

  describe("updateStatus", () => {
    it("flips active and persists it", async () => {
      const [created] = await repository.add([ipRule()]);

      const result = await repository.updateStatus([created.id], false);

      expect(result).toEqual({ updated: [{ ...created, active: false }], missingIds: [] });
      const all = await repository.getAll();
      expect(all[0].active).toBe(false);
    });

    it("updates nothing when one requested id does not exist (atomic, transactional rollback)", async () => {
      const [created] = await repository.add([ipRule()]);

      const result = await repository.updateStatus([created.id, 999999], false);

      expect(result).toEqual({ updated: [], missingIds: [999999] });
      const all = await repository.getAll();
      expect(all[0].active).toBe(true);
    });

    it("returns { updated: [], missingIds: [] } for an empty array without issuing invalid SQL", async () => {
      await expect(repository.updateStatus([], true)).resolves.toEqual({ updated: [], missingIds: [] });
    });
  });
});
