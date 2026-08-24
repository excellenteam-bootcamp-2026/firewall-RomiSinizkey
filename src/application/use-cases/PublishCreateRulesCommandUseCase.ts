import { randomUUID } from "crypto";
import { RuleValue } from "../../domain/entities/FirewallRule";
import { CommandPublisher, CreateRulesCommand } from "../ports/CommandPublisher";
import { assertNonEmptyArray, assertValidIps, assertValidMode } from "../validation/ruleValidation";

export interface PublishCreateRulesCommandResult {
  operation_id: string;
}

export class PublishCreateRulesCommandUseCase {
  constructor(private readonly commandPublisher: CommandPublisher) {}

  async execute(rawValues: unknown, rawMode: unknown): Promise<PublishCreateRulesCommandResult> {
    assertValidMode(rawMode);
    assertNonEmptyArray<RuleValue>(rawValues, "INVALID_VALUES", "values must be a non-empty array.");

    const values = rawValues as unknown[];
    assertValidIps(values);

    const operation_id = randomUUID();
    const command: CreateRulesCommand = {
      operation_id,
      command_type: "create_rules",
      payload: {
        type: "ip",
        mode: rawMode,
        values,
      },
    };

    await this.commandPublisher.publish(command);

    return { operation_id };
  }
}
