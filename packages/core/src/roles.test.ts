import { describe, expect, it } from "vitest";
import { can, isRole } from "./roles";

describe("can", () => {
  it("denies everything without a role", () => {
    expect(can(null, "org.read")).toBe(false);
    expect(can(undefined, "leads.write")).toBe(false);
  });

  it("lets viewers read but not write", () => {
    expect(can("viewer", "org.read")).toBe(true);
    expect(can("viewer", "leads.write")).toBe(false);
    expect(can("viewer", "sending.pause")).toBe(false);
  });

  it("lets senders pause but not resume sending", () => {
    expect(can("sender", "sending.pause")).toBe(true);
    expect(can("sender", "sending.resume")).toBe(false);
  });

  it("restricts sending accounts and api keys to admin+", () => {
    expect(can("sender", "sending_accounts.manage")).toBe(false);
    expect(can("admin", "sending_accounts.manage")).toBe(true);
    expect(can("admin", "api_keys.manage")).toBe(true);
  });

  it("restricts member management to owners", () => {
    expect(can("admin", "members.manage")).toBe(false);
    expect(can("owner", "members.manage")).toBe(true);
  });
});

describe("isRole", () => {
  it("accepts known roles only", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(1)).toBe(false);
  });
});
