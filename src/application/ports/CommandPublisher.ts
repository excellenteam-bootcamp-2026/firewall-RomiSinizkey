import { RuleMode, RuleType, RuleValue } from "../../domain/entities/FirewallRule";

export interface CreateRulesPayload {
  type: RuleType;
  mode: RuleMode;
  values: RuleValue[];
}

export interface CreateRulesCommand {
  operation_id: string;
  command_type: "create_rules";
  payload: CreateRulesPayload;
}

export interface CommandPublisher {
  publish(command: CreateRulesCommand): Promise<void>;
}
