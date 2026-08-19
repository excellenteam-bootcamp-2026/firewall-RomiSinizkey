import { RuleMode, RuleType, RuleValue } from "../../domain/entities/FirewallRule";
import { RuleRepository } from "../ports/RuleRepository";
import { assertNonEmptyArray, assertValidMode, validatorsByType } from "../validation/ruleValidation";

export interface AddedRuleView {
  id: number;
  value: RuleValue;
  active: boolean;
}

export interface AddRulesResult {
  type: RuleType;
  mode: RuleMode;
  values: AddedRuleView[];
  status: "success";
}

export class AddRulesUseCase {
  constructor(private readonly repository: RuleRepository) {}

  async execute(type: RuleType, rawValues: unknown, rawMode: unknown): Promise<AddRulesResult> {
    assertValidMode(rawMode);
    assertNonEmptyArray<RuleValue>(rawValues, "INVALID_VALUES", "values must be a non-empty array.");

    const values = rawValues as unknown[];
    const validate: (values: unknown[]) => asserts values is RuleValue[] = validatorsByType[type];
    validate(values);

    const created = await this.repository.add(
      (values as RuleValue[]).map((value) => ({ type, mode: rawMode, value }))
    );
    const view = created.map(({ id, value, active }) => ({ id, value, active }));

    return { type, mode: rawMode, values: view, status: "success" };
  }
}
