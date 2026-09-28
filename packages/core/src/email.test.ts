import { describe, expect, it } from "vitest";
import { emailDomain, isValidEmailSyntax, normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });
});

describe("isValidEmailSyntax", () => {
  it.each(["ada@example.com", "first.last+tag@sub.example.co.uk", "A@B.IO"])("accepts %s", (e) => {
    expect(isValidEmailSyntax(e)).toBe(true);
  });

  it.each(["", "ada", "ada@", "@example.com", "a b@example.com", "ada@example", "a..b@example.com", ".a@example.com", "ada@-example.com"])(
    "rejects %s",
    (e) => {
      expect(isValidEmailSyntax(e)).toBe(false);
    },
  );
});

describe("emailDomain", () => {
  it("extracts the lowercase domain", () => {
    expect(emailDomain("ada@Example.com")).toBe("example.com");
    expect(emailDomain("nope")).toBeNull();
  });
});
