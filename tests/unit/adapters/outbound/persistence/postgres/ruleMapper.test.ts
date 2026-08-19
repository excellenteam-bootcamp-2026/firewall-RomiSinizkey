import { describe, it, expect } from "vitest";
import { toDomainRule, toInsertRow, FirewallRuleRow } from "../../../../../../src/adapters/outbound/persistence/postgres/ruleMapper";
import { ValidationError } from "../../../../../../src/application/errors/AppError";

// This file never imports "pg" or the postgres connection module, and every
// row below is a plain object — no database connection is opened by these tests.

describe("ruleMapper.toDomainRule", () => {
  it("maps an IP row to a domain rule, keeping the value a string", () => {
    const row: FirewallRuleRow = { id: 1, type: "ip", mode: "blacklist", value: "203.0.113.5", active: true };

    expect(toDomainRule(row)).toEqual({
      id: 1,
      type: "ip",
      mode: "blacklist",
      value: "203.0.113.5",
      active: true,
    });
  });

  it("maps a domain/website row to a domain rule, keeping the value a string", () => {
    const row: FirewallRuleRow = { id: 2, type: "domain", mode: "whitelist", value: "example.com", active: false };

    expect(toDomainRule(row)).toEqual({
      id: 2,
      type: "domain",
      mode: "whitelist",
      value: "example.com",
      active: false,
    });
  });

  it("converts a port row's text value to a number", () => {
    const row: FirewallRuleRow = { id: 3, type: "port", mode: "blacklist", value: "443", active: true };

    const rule = toDomainRule(row);

    expect(rule.value).toBe(443);
    expect(typeof rule.value).toBe("number");
  });

  it("preserves mode and active exactly as stored, for both possible values", () => {
    const whitelistInactive: FirewallRuleRow = { id: 4, type: "ip", mode: "whitelist", value: "10.0.0.1", active: false };
    const blacklistActive: FirewallRuleRow = { id: 5, type: "ip", mode: "blacklist", value: "10.0.0.2", active: true };

    expect(toDomainRule(whitelistInactive)).toMatchObject({ mode: "whitelist", active: false });
    expect(toDomainRule(blacklistActive)).toMatchObject({ mode: "blacklist", active: true });
  });

  it("throws a ValidationError for non-numeric port text", () => {
    const row: FirewallRuleRow = { id: 6, type: "port", mode: "blacklist", value: "abc", active: true };

    expect(() => toDomainRule(row)).toThrow(ValidationError);
    expect(() => toDomainRule(row)).toThrow(/port/i);
  });

  it("throws a ValidationError for an out-of-range port", () => {
    const tooHigh: FirewallRuleRow = { id: 7, type: "port", mode: "blacklist", value: "70000", active: true };
    const tooLow: FirewallRuleRow = { id: 8, type: "port", mode: "blacklist", value: "0", active: true };

    expect(() => toDomainRule(tooHigh)).toThrow(ValidationError);
    expect(() => toDomainRule(tooLow)).toThrow(ValidationError);
  });

  it("throws a ValidationError instead of silently casting a malformed type", () => {
    const row = { id: 9, type: "unknown", mode: "blacklist", value: "x", active: true } as unknown as FirewallRuleRow;

    expect(() => toDomainRule(row)).toThrow(ValidationError);
  });

  it("throws a ValidationError instead of silently casting a malformed mode", () => {
    const row = { id: 10, type: "ip", mode: "unknown", value: "10.0.0.1", active: true } as unknown as FirewallRuleRow;

    expect(() => toDomainRule(row)).toThrow(ValidationError);
  });
});

describe("ruleMapper.toInsertRow", () => {
  it("converts a domain/website input rule into a Drizzle insert object", () => {
    expect(toInsertRow({ type: "domain", mode: "whitelist", value: "example.com" })).toEqual({
      type: "domain",
      mode: "whitelist",
      value: "example.com",
      active: true,
    });
  });

  it("converts an IP input rule into a Drizzle insert object, keeping the value a string", () => {
    expect(toInsertRow({ type: "ip", mode: "blacklist", value: "203.0.113.5" })).toEqual({
      type: "ip",
      mode: "blacklist",
      value: "203.0.113.5",
      active: true,
    });
  });

  it("converts a numeric port value to text for insertion", () => {
    const insertRow = toInsertRow({ type: "port", mode: "blacklist", value: 8080 });

    expect(insertRow.value).toBe("8080");
    expect(typeof insertRow.value).toBe("string");
  });

  it("preserves mode across both blacklist and whitelist inputs", () => {
    expect(toInsertRow({ type: "port", mode: "blacklist", value: 22 }).mode).toBe("blacklist");
    expect(toInsertRow({ type: "port", mode: "whitelist", value: 22 }).mode).toBe("whitelist");
  });
});
