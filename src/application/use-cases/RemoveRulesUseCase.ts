import { FirewallRule } from "../../domain/entities/FirewallRule";
import { RuleRepository } from "../ports/RuleRepository";
import { NotFoundError } from "../errors/AppError";
import { assertValidIds } from "../validation/ruleValidation";

export interface RemoveRulesResult {
  removed: FirewallRule[];
  status: "success";
}

export class RemoveRulesUseCase {
  constructor(private readonly repository: RuleRepository) {}

  async execute(rawIds: unknown): Promise<RemoveRulesResult> {
    assertValidIds(rawIds);

    const { removed, missingIds } = await this.repository.removeByIds(rawIds);
    if (missingIds.length > 0) {
      throw new NotFoundError("RULE_NOT_FOUND", `No rule(s) found for id(s): ${missingIds.join(", ")}.`);
    }

    return { removed, status: "success" };
  }
}
