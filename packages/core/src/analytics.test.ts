import { describe, expect, it } from "vitest";
import {
  evaluateAbTest,
  formatP,
  formatPct,
  injectTracking,
  isLikelyScanner,
  normalCdf,
  parseRange,
  rate,
  twoProportionPValue,
  wilsonInterval,
} from "./analytics";
import { buildEmail, textToHtml } from "./templates";

describe("rate / formatting", () => {
  it("is null without a denominator", () => {
    expect(rate(3, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
    expect(formatPct(null)).toBe("—");
    expect(formatPct(0.1234)).toBe("12.3%");
    expect(formatP(0.0001)).toBe("< 0.001");
    expect(formatP(0.04321)).toBe("0.043");
  });
});

describe("normalCdf", () => {
  it("matches known quantiles", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(3)).toBeCloseTo(0.99865, 4);
  });
});

describe("wilsonInterval", () => {
  it("brackets the observed rate and stays within [0, 1]", () => {
    const ci = wilsonInterval(10, 100)!;
    expect(ci.low).toBeCloseTo(0.0552, 3);
    expect(ci.high).toBeCloseTo(0.1744, 3);
    const zero = wilsonInterval(0, 20)!;
    expect(zero.low).toBe(0);
    expect(zero.high).toBeGreaterThan(0.1);
    const all = wilsonInterval(5, 5)!;
    expect(all.high).toBe(1);
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe("twoProportionPValue", () => {
  it("is 1 for identical or empty arms", () => {
    expect(twoProportionPValue(10, 100, 10, 100)).toBeCloseTo(1, 6);
    expect(twoProportionPValue(0, 100, 0, 100)).toBe(1);
    expect(twoProportionPValue(1, 0, 1, 10)).toBe(1);
  });
  it("matches a textbook example", () => {
    // 20/200 vs 8/200: z ≈ 2.34, p ≈ 0.019
    expect(twoProportionPValue(20, 200, 8, 200)).toBeCloseTo(0.0191, 3);
    // symmetric
    expect(twoProportionPValue(8, 200, 20, 200)).toBeCloseTo(twoProportionPValue(20, 200, 8, 200), 10);
  });
});

describe("evaluateAbTest", () => {
  const arm = (id: string, sent: number, successes: number) => ({ id, label: id, sent, successes });

  it("needs two variants", () => {
    expect(evaluateAbTest([arm("A", 500, 50)]).status).toBe("single");
  });

  it("keeps collecting until every variant has the minimum sends", () => {
    const v = evaluateAbTest([arm("A", 120, 20), arm("B", 60, 1)]);
    expect(v.status).toBe("collecting");
    if (v.status === "collecting") {
      expect(v.needed).toBe(40);
      expect(v.message).toContain("A: 120");
    }
  });

  it("declares a clear winner", () => {
    const v = evaluateAbTest([arm("A", 200, 8), arm("B", 200, 20)]);
    expect(v.status).toBe("winner");
    if (v.status === "winner") {
      expect(v.winnerId).toBe("B");
      expect(v.pValue).toBeLessThan(0.05);
      expect(v.message).toContain("B 10.0% vs A 4.0% reply rate");
    }
  });

  it("does not call a small difference", () => {
    const v = evaluateAbTest([arm("A", 200, 10), arm("B", 200, 13)]);
    expect(v.status).toBe("no_difference");
    if (v.status === "no_difference") expect(v.leaderId).toBe("B");
  });

  it("reports ties without a leader", () => {
    const v = evaluateAbTest([arm("A", 150, 6), arm("B", 150, 6)]);
    expect(v).toMatchObject({ status: "no_difference", leaderId: null });
  });

  it("requires a minimum number of successes for the leader", () => {
    // 4/100 vs 0/100 is p ≈ 0.04 but only 4 replies.
    const v = evaluateAbTest([arm("A", 100, 4), arm("B", 100, 0)]);
    expect(v.status).toBe("no_difference");
    expect(v.message).toContain("too few replies");
  });

  it("applies a Bonferroni correction across several variants", () => {
    // 20/200 vs 8/200 is p ≈ 0.019: significant for 2 arms (α = 0.05) …
    expect(evaluateAbTest([arm("A", 200, 20), arm("B", 200, 8)]).status).toBe("winner");
    // … but not against 3 others (α/3 ≈ 0.0167).
    expect(evaluateAbTest([arm("A", 200, 20), arm("B", 200, 8), arm("C", 200, 8), arm("D", 200, 8)]).status).toBe("no_difference");
  });

  it("must beat every other variant, not just the worst", () => {
    const v = evaluateAbTest([arm("A", 300, 40), arm("B", 300, 36), arm("C", 300, 5)]);
    expect(v.status).toBe("no_difference");
  });
});

describe("textToHtml links", () => {
  it("links bare URLs and leaves trailing punctuation outside", () => {
    expect(textToHtml("See https://acme.dev/pricing?a=1&b=2. Thanks")).toBe(
      '<p>See <a href="https://acme.dev/pricing?a=1&amp;b=2">https://acme.dev/pricing?a=1&amp;b=2</a>. Thanks</p>',
    );
    expect(textToHtml("(http://x.io)")).toBe('<p>(<a href="http://x.io">http://x.io</a>)</p>');
    // Author markup stays escaped text; only the URL itself becomes a link.
    expect(textToHtml('<a href="https://evil">x</a>')).toBe(
      '<p>&lt;a href=&quot;<a href="https://evil">https://evil</a>&quot;&gt;x&lt;/a&gt;</p>',
    );
  });
});

describe("injectTracking", () => {
  const email = buildEmail({
    subject: "Hi",
    body: "Check https://acme.dev/demo?x=1&y=2 and ftp://files.example",
    ctx: { lead: { email: "a@b.co", first_name: null, last_name: null, company: null, title: null }, sender: { name: null, email: "me@x.co" } },
    unsubscribeUrl: "https://app.test/u/tok",
    physicalAddress: "1 Main St",
  });

  it("rewrites http(s) links but never the unsubscribe link", () => {
    const out = injectTracking(email.html, {
      clickUrl: (u) => `https://app.test/t/c/T?u=${encodeURIComponent(u)}`,
      skip: ["https://app.test/u/tok"],
    });
    expect(out).toContain(`href="https://app.test/t/c/T?u=${encodeURIComponent("https://acme.dev/demo?x=1&y=2")}"`);
    expect(out).toContain('href="https://app.test/u/tok"');
    expect(out).not.toContain("<img");
  });

  it("appends the open pixel inside the wrapper", () => {
    const out = injectTracking(email.html, { openPixelUrl: "https://app.test/t/o/T" });
    expect(out).toMatch(/<img src="https:\/\/app\.test\/t\/o\/T" width="1" height="1"[^>]*>\n<\/div>$/);
    expect(out).toContain('href="https://acme.dev/demo?x=1&amp;y=2"');
  });

  it("is a no-op when tracking is off", () => {
    expect(injectTracking(email.html, {})).toBe(email.html);
  });

  it("keeps other attributes on the anchor", () => {
    const out = injectTracking('<a style="c" href="https://x.io/a">x</a>', { clickUrl: () => "https://t/1" });
    expect(out).toBe('<a style="c" href="https://t/1">x</a>');
  });
});

describe("isLikelyScanner", () => {
  const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
  it("flags scanners, empty agents and hits right after sending", () => {
    expect(isLikelyScanner(chrome, 3600)).toBe(false);
    expect(isLikelyScanner("Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)", 900)).toBe(false);
    expect(isLikelyScanner("Barracuda Sentinel (EE)", 3600)).toBe(true);
    expect(isLikelyScanner("python-requests/2.31", 3600)).toBe(true);
    expect(isLikelyScanner("", 3600)).toBe(true);
    expect(isLikelyScanner(null, 3600)).toBe(true);
    expect(isLikelyScanner(chrome, 12)).toBe(true);
    expect(isLikelyScanner(chrome, null)).toBe(false);
  });
});

describe("parseRange", () => {
  it("accepts 7/30/90 and defaults to 30", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("90")).toBe(90);
    expect(parseRange("12")).toBe(30);
    expect(parseRange(undefined)).toBe(30);
  });
});
