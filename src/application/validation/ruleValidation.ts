import { RuleMode, RuleType, RuleValue } from "../../domain/entities/FirewallRule";
import { ValidationError } from "../errors/AppError";

const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;

const DOMAIN_REGEX = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})+$/;

export function assertValidMode(mode: unknown): asserts mode is RuleMode {
  if (mode !== "blacklist" && mode !== "whitelist") {
    throw new ValidationError("INVALID_MODE", "mode must be strictly either blacklist or whitelist.");
  }
}

export function assertNonEmptyArray<T>(values: unknown, code: string, message: string): asserts values is T[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ValidationError(code, message);
  }
}

export function assertValidIps(values: unknown[]): asserts values is string[] {
  for (const value of values) {
    if (typeof value !== "string" || !IPV4_REGEX.test(value)) {
      throw new ValidationError("INVALID_IP", `"${value}" is not a valid IPv4 address.`);
    }
  }
}

export function assertValidDomains(values: unknown[]): asserts values is string[] {
  for (const value of values) {
    if (typeof value !== "string" || value.includes("/") || value.includes(":") || !DOMAIN_REGEX.test(value)) {
      throw new ValidationError(
        "INVALID_DOMAIN",
        `"${value}" is not a valid domain. Domains must not include protocol, path, or port.`
      );
    }
  }
}

export function assertValidPorts(values: unknown[]): asserts values is number[] {
  for (const value of values) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
      throw new ValidationError("INVALID_PORT", "Ports must be integers between 1 and 65535.");
    }
  }
}

export function assertValidIds(ids: unknown): asserts ids is number[] {
  assertNonEmptyArray<number>(ids, "INVALID_IDS", "ids must be a non-empty array of integers.");
  for (const id of ids as unknown[]) {
    if (typeof id !== "number" || !Number.isInteger(id)) {
      throw new ValidationError("INVALID_IDS", "ids must be a non-empty array of integers.");
    }
  }
}

export function assertValidActive(active: unknown): asserts active is boolean {
  if (typeof active !== "boolean") {
    throw new ValidationError("INVALID_ACTIVE", "active must be a Boolean value (true or false).");
  }
}

export function assertValidRuleType(type: unknown): asserts type is RuleType {
  if (type !== "ip" && type !== "domain" && type !== "port") {
    throw new ValidationError("INVALID_TYPE", 'type must be one of "ip", "domain" or "port".');
  }
}

export const validatorsByType: Record<RuleType, (values: unknown[]) => asserts values is RuleValue[]> = {
  ip: assertValidIps as (values: unknown[]) => asserts values is RuleValue[],
  domain: assertValidDomains as (values: unknown[]) => asserts values is RuleValue[],
  port: assertValidPorts as (values: unknown[]) => asserts values is RuleValue[],
};
