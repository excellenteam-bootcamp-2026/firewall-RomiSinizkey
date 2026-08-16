import { describe, it, expect, vi, beforeEach } from "vitest";
import { RemoveRulesUseCase } from "../../../../src/application/use-cases/RemoveRulesUseCase";
import { RuleRepository } from "../../../../src/domain/ports/RuleRepository";
import { NotFoundError, ValidationError } from "../../../../src/application/errors/AppError";
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

describe("RemoveRulesUseCase", () => {
  let repository: RuleRepository;
  let useCase: RemoveRulesUseCase;

  beforeEach(() => {
    repository = createMockRepository();
    useCase = new RemoveRulesUseCase(repository);
  });

  describe("valid ids", () => {
    it("calls repository.removeByIds exactly once with the exact ids", () => {
      vi.mocked(repository.removeByIds).mockReturnValue({ removed: [], missingIds: [] });

      useCase.execute([1, 2, 3]);

      expect(repository.removeByIds).toHaveBeenCalledTimes(1);
      expect(repository.removeByIds).toHaveBeenCalledWith([1, 2, 3]);
    });
  });

  describe("success (no missing ids)", () => {
    it("returns exactly { removed, status: 'success' } using the mock's return value", () => {
      const removed: FirewallRule[] = [
        rule({ id: 1, value: "1.1.1.1" }),
        rule({ id: 2, value: "2.2.2.2" }),
      ];
      vi.mocked(repository.removeByIds).mockReturnValue({ removed, missingIds: [] });

      const result = useCase.execute([1, 2]);

      expect(result).toEqual({ removed, status: "success" });
    });
  });

  describe("missing ids", () => {
    it("throws NotFoundError with code RULE_NOT_FOUND, status 404, and the missing id in the message (single id)", () => {
      vi.mocked(repository.removeByIds).mockReturnValue({ removed: [], missingIds: [42] });

      let thrown: unknown;
      try {
        useCase.execute([42]);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(NotFoundError);
      const error = thrown as NotFoundError;
      expect(error.code).toBe("RULE_NOT_FOUND");
      expect(error.statusCode).toBe(404);
      expect(error.message).toContain("42");
    });

    it("throws NotFoundError whose message contains all missing ids (multiple ids)", () => {
      vi.mocked(repository.removeByIds).mockReturnValue({ removed: [], missingIds: [7, 8, 9] });

      let thrown: unknown;
      try {
        useCase.execute([7, 8, 9]);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(NotFoundError);
      const error = thrown as NotFoundError;
      expect(error.code).toBe("RULE_NOT_FOUND");
      expect(error.statusCode).toBe(404);
      expect(error.message).toContain("7");
      expect(error.message).toContain("8");
      expect(error.message).toContain("9");
    });
  });

  describe("invalid ids", () => {
    it("throws ValidationError for an empty array and does not call repository.removeByIds", () => {
      expect(() => useCase.execute([])).toThrow(ValidationError);
      expect(repository.removeByIds).not.toHaveBeenCalled();
    });

    it("throws ValidationError for a non-array and does not call repository.removeByIds", () => {
      expect(() => useCase.execute(undefined)).toThrow(ValidationError);
      expect(repository.removeByIds).not.toHaveBeenCalled();
    });

    it("throws ValidationError for non-integer entries and does not call repository.removeByIds", () => {
      expect(() => useCase.execute([1.5])).toThrow(ValidationError);
      expect(repository.removeByIds).not.toHaveBeenCalled();
    });

    it("throws ValidationError for non-number entries and does not call repository.removeByIds", () => {
      expect(() => useCase.execute(["1"])).toThrow(ValidationError);
      expect(repository.removeByIds).not.toHaveBeenCalled();
    });
  });
});
