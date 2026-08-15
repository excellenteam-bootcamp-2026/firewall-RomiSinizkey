import { describe, it, expect } from "vitest";
import {
  assertNonEmptyArray,
  assertValidActive,
  assertValidDomains,
  assertValidIds,
  assertValidIps,
  assertValidMode,
  assertValidPorts,
  assertValidRuleType,
} from "../../../../src/application/validation/ruleValidation";
import { ValidationError } from "../../../../src/application/errors/AppError";

describe("assertValidMode", () => {
  it("accepts 'blacklist' and 'whitelist'", () => {
    expect(() => assertValidMode("blacklist")).not.toThrow();
    expect(() => assertValidMode("whitelist")).not.toThrow();
  });

  it("rejects anything else", () => {
    expect(() => assertValidMode("allow")).toThrow(ValidationError);
    expect(() => assertValidMode(undefined)).toThrow(ValidationError);
    expect(() => assertValidMode(123)).toThrow(ValidationError);
  });
});

describe("assertNonEmptyArray", () => {
  it("accepts a non-empty array", () => {
    expect(() => assertNonEmptyArray([1, 2], "CODE", "msg")).not.toThrow();
  });

  it("rejects an empty array", () => {
    expect(() => assertNonEmptyArray([], "CODE", "msg")).toThrow(ValidationError);
  });

  it("rejects non-array values", () => {
    expect(() => assertNonEmptyArray("not-an-array", "CODE", "msg")).toThrow(ValidationError);
    expect(() => assertNonEmptyArray(undefined, "CODE", "msg")).toThrow(ValidationError);
  });
});

describe("assertValidIps", () => {
  it("accepts valid IPv4 addresses", () => {
    expect(() => assertValidIps(["192.168.1.1", "0.0.0.0", "255.255.255.255"])).not.toThrow();
  });

  it("rejects invalid IPv4 addresses", () => {
    expect(() => assertValidIps(["256.1.1.1"])).toThrow(ValidationError);
    expect(() => assertValidIps(["not-an-ip"])).toThrow(ValidationError);
    expect(() => assertValidIps(["1.2.3"])).toThrow(ValidationError);
  });

  it("rejects non-string values", () => {
    expect(() => assertValidIps([123])).toThrow(ValidationError);
  });
});

describe("assertValidDomains", () => {
  it("accepts valid domains", () => {
    expect(() => assertValidDomains(["example.com", "sub.example.co.il"])).not.toThrow();
  });

  it("rejects domains with protocol, path, or port", () => {
    expect(() => assertValidDomains(["https://example.com"])).toThrow(ValidationError);
    expect(() => assertValidDomains(["example.com/path"])).toThrow(ValidationError);
    expect(() => assertValidDomains(["example.com:8080"])).toThrow(ValidationError);
  });

  it("rejects domains with a single label or invalid characters", () => {
    expect(() => assertValidDomains(["localhost"])).toThrow(ValidationError);
    expect(() => assertValidDomains(["exa_mple.com"])).toThrow(ValidationError);
  });

  it("rejects non-string values", () => {
    expect(() => assertValidDomains([42])).toThrow(ValidationError);
  });
});

describe("assertValidPorts", () => {
  it("accepts integers within 1-65535", () => {
    expect(() => assertValidPorts([1, 80, 65535])).not.toThrow();
  });

  it("rejects out-of-range or non-integer values", () => {
    expect(() => assertValidPorts([0])).toThrow(ValidationError);
    expect(() => assertValidPorts([65536])).toThrow(ValidationError);
    expect(() => assertValidPorts([80.5])).toThrow(ValidationError);
  });

  it("rejects non-number values", () => {
    expect(() => assertValidPorts(["80"])).toThrow(ValidationError);
  });
});

describe("assertValidIds", () => {
  it("accepts a non-empty array of integers", () => {
    expect(() => assertValidIds([1, 2, 3])).not.toThrow();
  });

  it("rejects an empty array", () => {
    expect(() => assertValidIds([])).toThrow(ValidationError);
  });

  it("rejects non-integer or non-number entries", () => {
    expect(() => assertValidIds([1, "2"])).toThrow(ValidationError);
    expect(() => assertValidIds([1.5])).toThrow(ValidationError);
  });

  it("rejects non-array values", () => {
    expect(() => assertValidIds(undefined)).toThrow(ValidationError);
  });
});

describe("assertValidActive", () => {
  it("accepts boolean values", () => {
    expect(() => assertValidActive(true)).not.toThrow();
    expect(() => assertValidActive(false)).not.toThrow();
  });

  it("rejects non-boolean values", () => {
    expect(() => assertValidActive("true")).toThrow(ValidationError);
    expect(() => assertValidActive(1)).toThrow(ValidationError);
    expect(() => assertValidActive(undefined)).toThrow(ValidationError);
  });
});

describe("assertValidRuleType", () => {
  it("accepts 'ip', 'domain', and 'port'", () => {
    expect(() => assertValidRuleType("ip")).not.toThrow();
    expect(() => assertValidRuleType("domain")).not.toThrow();
    expect(() => assertValidRuleType("port")).not.toThrow();
  });

  it("rejects anything else", () => {
    expect(() => assertValidRuleType("url")).toThrow(ValidationError);
    expect(() => assertValidRuleType(undefined)).toThrow(ValidationError);
  });
});
