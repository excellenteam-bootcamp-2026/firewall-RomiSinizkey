import { FirewallRule } from "../../domain/entities/FirewallRule";
import { RuleRepository } from "../ports/RuleRepository";
import { NotFoundError } from "../errors/AppError";
import { assertValidActive, assertValidIds } from "../validation/ruleValidation";

export interface UpdateRuleStatusResult {
  updated: FirewallRule[];
  status: "success";
}

export class UpdateRuleStatusUseCase {
  constructor(private readonly repository: RuleRepository) {}

  execute(rawIds: unknown, rawActive: unknown): UpdateRuleStatusResult {
    assertValidIds(rawIds);
    assertValidActive(rawActive);

    const { updated, missingIds } = this.repository.updateStatus(rawIds, rawActive);
    if (missingIds.length > 0) {
      throw new NotFoundError("RULE_NOT_FOUND", `No rule(s) found for id(s): ${missingIds.join(", ")}.`);
    }

    return { updated, status: "success" };
  }
}
