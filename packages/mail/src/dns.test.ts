import { describe, expect, it } from "vitest";
import { checkDomain, isDisposableDomain, mapWithConcurrency, type DnsResolver } from "./dns";

const err = (code: string) => Object.assign(new Error(code), { code });

function fake(map: Record<string, { mx?: unknown; a?: unknown; aaaa?: unknown }>): DnsResolver {
  const pick = (d: string, k: "mx" | "a" | "aaaa") => {
    const v = map[d]?.[k];
    if (v === undefined) return Promise.reject(err(map[d] ? "ENODATA" : "ENOTFOUND"));
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
  };
  return {
    resolveMx: (d) => pick(d, "mx") as never,
    resolve4: (d) => pick(d, "a") as never,
    resolve6: (d) => pick(d, "aaaa") as never,
  };
}

describe("checkDomain", () => {
  it("orders MX hosts by priority and normalizes them", async () => {
    const r = fake({ "acme.io": { mx: [{ exchange: "B.acme.io.", priority: 20 }, { exchange: "a.acme.io", priority: 10 }] } });
    expect(await checkDomain("acme.io", r)).toEqual({ domain: "acme.io", mxHosts: ["a.acme.io", "b.acme.io"], nullMx: false, hasAddress: false, error: null });
  });

  it("detects RFC 7505 null MX", async () => {
    const r = fake({ "example.com": { mx: [{ exchange: "", priority: 0 }] } });
    expect((await checkDomain("example.com", r)).nullMx).toBe(true);
  });

  it("falls back to A/AAAA when there is no MX", async () => {
    expect(await checkDomain("a.io", fake({ "a.io": { a: ["1.2.3.4"] } }))).toMatchObject({ mxHosts: [], hasAddress: true, error: null });
    expect(await checkDomain("b.io", fake({ "b.io": {} }))).toMatchObject({ hasAddress: false, error: null });
  });

  it("distinguishes NXDOMAIN from temporary failures", async () => {
    expect((await checkDomain("gone.io", fake({}))).error).toBe("nxdomain");
    expect((await checkDomain("slow.io", fake({ "slow.io": { mx: err("ETIMEOUT") } }))).error).toBe("temporary");
    expect((await checkDomain("half.io", fake({ "half.io": { a: err("ESERVFAIL") } }))).error).toBe("temporary");
  });
});

describe("isDisposableDomain", () => {
  it("matches listed domains and their subdomains, not normal ones", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("MAILINATOR.com")).toBe(true);
    expect(isDisposableDomain("foo.mailinator.com")).toBe(true);
    expect(isDisposableDomain("gmail.com")).toBe(false);
    expect(isDisposableDomain("acme.io")).toBe(false);
  });
});

describe("mapWithConcurrency", () => {
  it("limits parallelism and preserves order", async () => {
    let inFlight = 0;
    let max = 0;
    const out = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (n) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, n * 3));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(max).toBe(2);
  });
});

describe("checkDomain against real DNS", () => {
  // Network-dependent; skipped when DNS is unavailable (e.g. sandboxed CI).
  it.skipIf(!process.env.TEST_REAL_DNS)("gmail.com has MX, example.com has null MX, junk domain is NXDOMAIN", async () => {
    expect((await checkDomain("gmail.com")).mxHosts.length).toBeGreaterThan(0);
    expect((await checkDomain("example.com")).nullMx).toBe(true);
    expect((await checkDomain("no-such-domain-zz9q-crm.com")).error).toBe("nxdomain");
  });
});
