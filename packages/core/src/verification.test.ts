import { describe, expect, it } from "vitest";
import { classifyEmail, isDomainCheckFresh, isRoleAccount, type DomainCheck } from "./verification";

const now = new Date("2026-09-28T12:00:00Z");
const disposable = new Set(["mailinator.com"]);
const opts = { isDisposable: (d: string) => disposable.has(d), now };
const dc = (over: Partial<DomainCheck> = {}): DomainCheck => ({
  domain: "acme.io",
  mxHosts: ["mx1.acme.io", "mx2.acme.io"],
  nullMx: false,
  hasAddress: false,
  error: null,
  ...over,
});

describe("classifyEmail", () => {
  it("valid when the domain has MX and the address is personal", () => {
    const r = classifyEmail("Ada@Acme.io", dc(), opts);
    expect(r.status).toBe("valid");
    expect(r.detail).toEqual({ level: "mx", reasons: [], domain: "acme.io", mx: ["mx1.acme.io", "mx2.acme.io"], checkedAt: now.toISOString() });
  });

  it.each([
    ["bad syntax", "not-an-email", dc(), "invalid", "syntax"],
    ["disposable domain", "x@mailinator.com", dc({ domain: "mailinator.com" }), "invalid", "disposable"],
    ["NXDOMAIN", "a@acme.io", dc({ mxHosts: [], error: "nxdomain" }), "invalid", "domain_not_found"],
    ["null MX", "a@acme.io", dc({ mxHosts: [], nullMx: true }), "invalid", "null_mx"],
    ["no MX, no A", "a@acme.io", dc({ mxHosts: [] }), "invalid", "no_mail_server"],
    ["no MX, has A", "a@acme.io", dc({ mxHosts: [], hasAddress: true }), "risky", "implicit_mx"],
    ["role account", "sales+eu@acme.io", dc(), "risky", "role_account"],
    ["temporary DNS failure", "a@acme.io", dc({ mxHosts: [], error: "temporary" }), "unknown", "dns_error"],
    ["no domain check", "a@acme.io", null, "unknown", "dns_error"],
  ] as const)("%s → %s", (_label, email, check, status, reason) => {
    const r = classifyEmail(email, check, opts);
    expect(r.status).toBe(status);
    expect(r.detail.reasons).toEqual([reason]);
  });

  it("checks disposable before DNS (no lookup needed)", () => {
    expect(classifyEmail("x@mailinator.com", null, opts).status).toBe("invalid");
  });
});

describe("isRoleAccount", () => {
  it.each([
    ["info@x.io", true],
    ["Sales@x.io", true],
    ["support+tickets@x.io", true],
    ["ada@x.io", false],
    ["information@x.io", false],
  ])("%s → %s", (e, expected) => expect(isRoleAccount(e)).toBe(expected));
});

describe("isDomainCheckFresh", () => {
  it("caches good results for 7 days and temporary failures for 1 hour", () => {
    const h = (hours: number) => new Date(now.getTime() - hours * 3600_000);
    expect(isDomainCheckFresh({ error: null, checkedAt: h(24 * 6) }, now)).toBe(true);
    expect(isDomainCheckFresh({ error: null, checkedAt: h(24 * 8) }, now)).toBe(false);
    expect(isDomainCheckFresh({ error: "nxdomain", checkedAt: h(24) }, now)).toBe(true);
    expect(isDomainCheckFresh({ error: "temporary", checkedAt: h(0.5) }, now)).toBe(true);
    expect(isDomainCheckFresh({ error: "temporary", checkedAt: h(2) }, now)).toBe(false);
  });
});
