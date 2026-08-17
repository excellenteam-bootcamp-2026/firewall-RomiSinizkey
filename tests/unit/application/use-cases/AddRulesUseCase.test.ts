import { describe, it, expect, vi, beforeEach } from "vitest";
import { AddRulesUseCase } from "../../../../src/application/use-cases/AddRulesUseCase";
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

describe("AddRulesUseCase", () => {
  let repository: RuleRepository;
  let useCase: AddRulesUseCase;

  beforeEach(() => {
    repository = createMockRepository();
    useCase = new AddRulesUseCase(repository);
  });

  describe("valid requests call repository.add with the correct shape", () => {
    it("passes type, mode, and value correctly for an IP request", () => {
      vi.mocked(repository.add).mockReturnValue([]);

      useCase.execute("ip", ["192.168.1.1"], "blacklist");

      expect(repository.add).toHaveBeenCalledTimes(1);
      expect(repository.add).toHaveBeenCalledWith([
        { type: "ip", mode: "blacklist", value: "192.168.1.1" },
      ]);
    });

    it("passes type, mode, and value correctly for a domain request", () => {
      vi.mocked(repository.add).mockReturnValue([]);

      useCase.execute("domain", ["example.com"], "whitelist");

      expect(repository.add).toHaveBeenCalledTimes(1);
      expect(repository.add).toHaveBeenCalledWith([
        { type: "domain", mode: "whitelist", value: "example.com" },
      ]);
    });

    it("passes type, mode, and value correctly for a port request", () => {
      vi.mocked(repository.add).mockReturnValue([]);

      useCase.execute("port", [8080], "blacklist");

      expect(repository.add).toHaveBeenCalledTimes(1);
      expect(repository.add).toHaveBeenCalledWith([
        { type: "port", mode: "blacklist", value: 8080 },
      ]);
    });

    it("passes multiple values in one call", () => {
      vi.mocked(repository.add).mockReturnValue([]);

      useCase.execute("ip", ["10.0.0.1", "10.0.0.2"], "blacklist");

      expect(repository.add).toHaveBeenCalledWith([
        { type: "ip", mode: "blacklist", value: "10.0.0.1" },
        { type: "ip", mode: "blacklist", value: "10.0.0.2" },
      ]);
    });
  });

  describe("the returned result is built from repository.add's return value", () => {
    it("maps whatever repository.add returns into the result's values", () => {
      const fakeRows: FirewallRule[] = [
        { id: 42, type: "ip", mode: "blacklist", value: "192.168.1.1", active: true },
      ];
      vi.mocked(repository.add).mockReturnValue(fakeRows);

      const result = useCase.execute("ip", ["192.168.1.1"], "blacklist");

      expect(result).toEqual({
        type: "ip",
        mode: "blacklist",
        status: "success",
        values: [{ id: 42, value: "192.168.1.1", active: true }],
      });
    });

    it("reflects a different return value from repository.add without hardcoding it", () => {
      const fakeRows: FirewallRule[] = [
        { id: 7, type: "port", mode: "whitelist", value: 443, active: true },
        { id: 8, type: "port", mode: "whitelist", value: 8443, active: true },
      ];
      vi.mocked(repository.add).mockReturnValue(fakeRows);

      const result = useCase.execute("port", [443, 8443], "whitelist");

      expect(result.values).toEqual([
        { id: 7, value: 443, active: true },
        { id: 8, value: 8443, active: true },
      ]);
    });
  });

  describe("invalid mode", () => {
    it("throws ValidationError and does not call repository.add", () => {
      expect(() => useCase.execute("ip", ["192.168.1.1"], "allow")).toThrow(ValidationError);
      expect(repository.add).not.toHaveBeenCalled();
    });
  });

  describe("empty or non-array values", () => {
    it("throws ValidationError for an empty array and does not call repository.add", () => {
      expect(() => useCase.execute("ip", [], "blacklist")).toThrow(ValidationError);
      expect(repository.add).not.toHaveBeenCalled();
    });

    it("throws ValidationError for a non-array and does not call repository.add", () => {
      expect(() => useCase.execute("ip", undefined, "blacklist")).toThrow(ValidationError);
      expect(repository.add).not.toHaveBeenCalled();
    });
  });

  describe("invalid value for the given type", () => {
    it("throws ValidationError for an invalid IP and does not call repository.add", () => {
      expect(() => useCase.execute("ip", ["not-an-ip"], "blacklist")).toThrow(ValidationError);
      expect(repository.add).not.toHaveBeenCalled();
    });

    it("throws ValidationError for an invalid domain and does not call repository.add", () => {
      expect(() => useCase.execute("domain", ["https://example.com"], "blacklist")).toThrow(
        ValidationError
      );
      expect(repository.add).not.toHaveBeenCalled();
    });

    it("throws ValidationError for an invalid port and does not call repository.add", () => {
      expect(() => useCase.execute("port", [70000], "blacklist")).toThrow(ValidationError);
      expect(repository.add).not.toHaveBeenCalled();
    });
  });

  describe("invalid rule type (known gap: not validated by this use case)", () => {
    it("throws TypeError, not ValidationError, and does not call repository.add", () => {
      // AddRulesUseCase does not call assertValidRuleType itself (unlike GetRulesUseCase).
      // It relies on validatorsByType[type] existing, so an unknown type currently
      // throws a TypeError ("validate is not a function") rather than a ValidationError.
      // This documents current behavior; it is not a fix.
      expect(() =>
        useCase.execute("bogus" as unknown as "ip", ["x"], "blacklist")
      ).toThrow(TypeError);
      expect(repository.add).not.toHaveBeenCalled();
    });
  });
});
