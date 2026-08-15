import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpdateRuleStatusUseCase } from "../../../../src/application/use-cases/UpdateRuleStatusUseCase";
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

describe("UpdateRuleStatusUseCase", () => {
  let repository: RuleRepository;
  let useCase: UpdateRuleStatusUseCase;

  beforeEach(() => {
    repository = createMockRepository();
    useCase = new UpdateRuleStatusUseCase(repository);
  });

  describe("valid ids and active value", () => {
    it("forwards active: true unchanged, calling repository.updateStatus exactly once with the exact ids and value", () => {
      vi.mocked(repository.updateStatus).mockReturnValue({ updated: [], missingIds: [] });

      useCase.execute([1, 2, 3], true);

      expect(repository.updateStatus).toHaveBeenCalledTimes(1);
      expect(repository.updateStatus).toHaveBeenCalledWith([1, 2, 3], true);
    });

    it("forwards active: false unchanged, calling repository.updateStatus exactly once with the exact ids and value", () => {
      vi.mocked(repository.updateStatus).mockReturnValue({ updated: [], missingIds: [] });

      useCase.execute([4, 5], false);

      expect(repository.updateStatus).toHaveBeenCalledTimes(1);
      expect(repository.updateStatus).toHaveBeenCalledWith([4, 5], false);
    });
  });

  describe("success (no missing ids)", () => {
    it("returns exactly { updated, status: 'success' } using the mock's return value", () => {
      const updated: FirewallRule[] = [
        rule({ id: 1, active: false }),
        rule({ id: 2, active: false }),
      ];
      vi.mocked(repository.updateStatus).mockReturnValue({ updated, missingIds: [] });

      const result = useCase.execute([1, 2], false);

      expect(result).toEqual({ updated, status: "success" });
    });
  });

  describe("missing ids", () => {
    it("throws NotFoundError with code RULE_NOT_FOUND, status 404, and the missing id in the message (single id)", () => {
      vi.mocked(repository.updateStatus).mockReturnValue({ updated: [], missingIds: [42] });

      let thrown: unknown;
      try {
        useCase.execute([42], true);
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
      vi.mocked(repository.updateStatus).mockReturnValue({ updated: [], missingIds: [7, 8, 9] });

      let thrown: unknown;
      try {
        useCase.execute([7, 8, 9], true);
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

  describe("invalid ids (with a valid active value)", () => {
    it("throws ValidationError for an empty array and does not call repository.updateStatus", () => {
      expect(() => useCase.execute([], true)).toThrow(ValidationError);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it("throws ValidationError for a non-array and does not call repository.updateStatus", () => {
      expect(() => useCase.execute(undefined, true)).toThrow(ValidationError);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it("throws ValidationError for non-integer entries and does not call repository.updateStatus", () => {
      expect(() => useCase.execute([1.5], true)).toThrow(ValidationError);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it("throws ValidationError for non-number entries and does not call repository.updateStatus", () => {
      expect(() => useCase.execute(["1"], true)).toThrow(ValidationError);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe("invalid active value (with valid ids)", () => {
    it("throws ValidationError for a string and does not call repository.updateStatus", () => {
      expect(() => useCase.execute([1], "true")).toThrow(ValidationError);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it("throws ValidationError for a number and does not call repository.updateStatus", () => {
      expect(() => useCase.execute([1], 1)).toThrow(ValidationError);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it("throws ValidationError for undefined and does not call repository.updateStatus", () => {
      expect(() => useCase.execute([1], undefined)).toThrow(ValidationError);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });
  });
});
