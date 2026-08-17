import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetRulesUseCase } from "../../../../src/application/use-cases/GetRulesUseCase";
import { RuleRepository } from "../../../../src/application/ports/RuleRepository";
import { ValidationError } from "../../../../src/application/errors/AppError";
import { FirewallRule } from "../../../../src/domain/entities/FirewallRule";

function createMockRepository(): RuleRepository {
  return {
    add: vi.fn(),
    removeByIds: vi.fn(),
    getAll: vi.fn(),
    updateStatus: vi.fn(),
  };
}

function rule(overrides: Partial<FirewallRule>): FirewallRule {
  return {
    id: 1,
    type: "ip",
    mode: "blacklist",
    value: "1.1.1.1",
    active: true,
    ...overrides,
  };
}

describe("GetRulesUseCase", () => {
  let repository: RuleRepository;
  let useCase: GetRulesUseCase;

  beforeEach(() => {
    repository = createMockRepository();
    useCase = new GetRulesUseCase(repository);
  });

  describe("no type given", () => {
    it("calls repository.getAll() with no arguments", () => {
      vi.mocked(repository.getAll).mockReturnValue([]);

      useCase.execute();

      expect(repository.getAll).toHaveBeenCalledTimes(1);
      expect(repository.getAll).toHaveBeenCalledWith();
    });

    it("groups mixed rules into ips/domains/ports, each split by mode", () => {
      const rules: FirewallRule[] = [
        rule({ id: 1, type: "ip", mode: "blacklist", value: "1.1.1.1" }),
        rule({ id: 2, type: "ip", mode: "whitelist", value: "2.2.2.2" }),
        rule({ id: 3, type: "domain", mode: "blacklist", value: "bad.com" }),
        rule({ id: 4, type: "domain", mode: "whitelist", value: "good.com" }),
        rule({ id: 5, type: "port", mode: "blacklist", value: 22 }),
        rule({ id: 6, type: "port", mode: "whitelist", value: 443 }),
      ];
      vi.mocked(repository.getAll).mockReturnValue(rules);

      const result = useCase.execute();

      expect(result).toEqual({
        ips: { blacklist: [rules[0]], whitelist: [rules[1]] },
        domains: { blacklist: [rules[2]], whitelist: [rules[3]] },
        ports: { blacklist: [rules[4]], whitelist: [rules[5]] },
      });
    });

    it("returns all three keys with empty blacklist/whitelist arrays when repository is empty", () => {
      vi.mocked(repository.getAll).mockReturnValue([]);

      const result = useCase.execute();

      expect(result).toEqual({
        ips: { blacklist: [], whitelist: [] },
        domains: { blacklist: [], whitelist: [] },
        ports: { blacklist: [], whitelist: [] },
      });
    });
  });

  describe("valid type given", () => {
    it("calls repository.getAll(type) with that exact type", () => {
      vi.mocked(repository.getAll).mockReturnValue([]);

      useCase.execute("ip");

      expect(repository.getAll).toHaveBeenCalledTimes(1);
      expect(repository.getAll).toHaveBeenCalledWith("ip");
    });

    it("returns only the matching key, grouped by mode, with no other keys", () => {
      const rules: FirewallRule[] = [
        rule({ id: 1, type: "ip", mode: "blacklist", value: "1.1.1.1" }),
        rule({ id: 2, type: "ip", mode: "whitelist", value: "2.2.2.2" }),
      ];
      vi.mocked(repository.getAll).mockReturnValue(rules);

      const result = useCase.execute("ip");

      expect(Object.keys(result)).toEqual(["ips"]);
      expect(result).toEqual({
        ips: { blacklist: [rules[0]], whitelist: [rules[1]] },
      });
    });
  });

  describe("invalid type", () => {
    it("throws ValidationError and does not call repository.getAll", () => {
      expect(() => useCase.execute("url")).toThrow(ValidationError);
      expect(repository.getAll).not.toHaveBeenCalled();
    });
  });

  describe("result reflects the mock's return value, not fabricated data", () => {
    it("includes the exact fake rule returned by the mock", () => {
      const fakeRule = rule({ id: 99, type: "domain", mode: "whitelist", value: "trusted.com" });
      vi.mocked(repository.getAll).mockReturnValue([fakeRule]);

      const result = useCase.execute("domain");

      expect(result.domains?.whitelist).toEqual([fakeRule]);
      expect(result.domains?.blacklist).toEqual([]);
    });
  });
});
