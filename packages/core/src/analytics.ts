/**
 * Analytics math: rates, confidence intervals, A/B significance, and the
 * open/click tracking rewrite applied to outgoing HTML. Pure functions only.
 */
import { escapeHtml } from "./templates";

// ---------------------------------------------------------------------------
// Rates and intervals
// ---------------------------------------------------------------------------

export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** 95% Wilson score interval for k successes out of n (well-behaved at small n and rates near 0). */
export function wilsonInterval(k: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** Two-sided p-value of a pooled two-proportion z-test. 1 when there is nothing to compare. */
export function twoProportionPValue(k1: number, n1: number, k2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 1;
  const pooled = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = (k1 / n1 - k2 / n2) / se;
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

// ---------------------------------------------------------------------------
// A/B evaluation
// ---------------------------------------------------------------------------

export const AB_MIN_SENDS_PER_VARIANT = 100;
export const AB_MIN_WINNER_SUCCESSES = 5;
export const AB_ALPHA = 0.05;

export type AbArm = { id: string; label: string; sent: number; successes: number };

export type AbVerdict =
  | { status: "single"; message: string }
  | { status: "collecting"; message: string; needed: number }
  | { status: "no_difference"; message: string; leaderId: string | null; pValue: number | null }
  | { status: "winner"; message: string; winnerId: string; pValue: number };

/**
 * Declares a winner only when the leading variant beats EVERY other variant
 * with p < alpha / (k − 1) (Bonferroni), each variant has at least
 * `minSends` sends, and the leader has at least `minSuccesses` successes.
 * These floors limit (but cannot remove) the false positives that come from
 * re-checking a running test repeatedly.
 */
export function evaluateAbTest(
  arms: AbArm[],
  opts: { minSends?: number; minSuccesses?: number; alpha?: number; metric?: string } = {},
): AbVerdict {
  const minSends = opts.minSends ?? AB_MIN_SENDS_PER_VARIANT;
  const minSuccesses = opts.minSuccesses ?? AB_MIN_WINNER_SUCCESSES;
  const alpha = opts.alpha ?? AB_ALPHA;
  const metric = opts.metric ?? "reply rate";

  if (arms.length < 2) return { status: "single", message: "Add a second variant to run an A/B test." };

  const short = arms.filter((a) => a.sent < minSends);
  if (short.length > 0) {
    const needed = short.reduce((n, a) => n + (minSends - a.sent), 0);
    return {
      status: "collecting",
      needed,
      message: `Collecting data: each variant needs ${minSends} sends (${arms.map((a) => `${a.label}: ${a.sent}`).join(", ")}).`,
    };
  }

  const ranked = [...arms].sort((a, b) => b.successes / b.sent - a.successes / a.sent);
  const leader = ranked[0]!;
  const runnerUp = ranked[1]!;
  const leaderRate = leader.successes / leader.sent;
  if (leaderRate === runnerUp.successes / runnerUp.sent) {
    return { status: "no_difference", leaderId: null, pValue: null, message: `No difference in ${metric} yet.` };
  }

  const adjusted = alpha / (arms.length - 1);
  const pValues = ranked.slice(1).map((a) => twoProportionPValue(leader.successes, leader.sent, a.successes, a.sent));
  const worst = Math.max(...pValues);
  const summary = `${leader.label} ${formatPct(leaderRate)} vs ${runnerUp.label} ${formatPct(runnerUp.successes / runnerUp.sent)} ${metric}`;

  if (leader.successes < minSuccesses) {
    return { status: "no_difference", leaderId: leader.id, pValue: worst, message: `${summary}: too few ${metric === "reply rate" ? "replies" : "successes"} to call it.` };
  }
  if (worst >= adjusted) {
    return { status: "no_difference", leaderId: leader.id, pValue: worst, message: `${summary}: not significant yet (p = ${formatP(worst)}).` };
  }
  return { status: "winner", winnerId: leader.id, pValue: worst, message: `${summary} (p = ${formatP(worst)}).` };
}

export function formatPct(r: number | null, digits = 1): string {
  return r === null ? "—" : `${(r * 100).toFixed(digits)}%`;
}

export function formatP(p: number): string {
  return p < 0.001 ? "< 0.001" : p.toFixed(3);
}

// ---------------------------------------------------------------------------
// Open / click tracking
// ---------------------------------------------------------------------------

const ENTITY: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };

function unescapeAttr(s: string): string {
  return s.replace(/&(amp|quot|#39|lt|gt);/g, (m) => ENTITY[m]!);
}

/**
 * Rewrites http(s) links through the click tracker and appends an open pixel.
 * Links in `skip` (the unsubscribe link) are left untouched so opting out
 * never depends on the tracker.
 */
export function injectTracking(
  html: string,
  opts: { openPixelUrl?: string | null; clickUrl?: ((url: string) => string) | null; skip?: string[] },
): string {
  const skip = new Set(opts.skip ?? []);
  let out = html;
  if (opts.clickUrl) {
    const toTracked = opts.clickUrl;
    out = out.replace(/<a(\s[^>]*?)?\shref="([^"]*)"/gi, (m, pre: string | undefined, raw: string) => {
      const url = unescapeAttr(raw);
      if (!/^https?:\/\//i.test(url) || skip.has(url)) return m;
      return `<a${pre ?? ""} href="${escapeHtml(toTracked(url))}"`;
    });
  }
  if (opts.openPixelUrl) {
    const pixel = `<img src="${escapeHtml(opts.openPixelUrl)}" width="1" height="1" alt="" style="border:0;width:1px;height:1px">`;
    const i = out.lastIndexOf("</div>");
    out = i >= 0 ? `${out.slice(0, i)}${pixel}\n${out.slice(i)}` : `${out}\n${pixel}`;
  }
  return out;
}

/** Security gateways and link scanners fetch pixels and links before (or instead of) a person. */
const SCANNER_UA =
  /bot\b|crawler|spider|scan|barracuda|proofpoint|mimecast|messagelabs|symantec|forcepoint|trendmicro|sophos|fortinet|urldefense|safelinks|curl\/|wget|python-|go-http|java\/|headless|phantom|slurp|preview/i;

export const TRACKING_BOT_WINDOW_SECONDS = 60;

export function isLikelyScanner(userAgent: string | null | undefined, secondsSinceSend: number | null): boolean {
  if (!userAgent || !userAgent.trim()) return true;
  if (SCANNER_UA.test(userAgent)) return true;
  return secondsSinceSend !== null && secondsSinceSend >= 0 && secondsSinceSend < TRACKING_BOT_WINDOW_SECONDS;
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function parseRange(v: string | undefined | null): AnalyticsRange {
  const n = Number(v);
  return (ANALYTICS_RANGES as readonly number[]).includes(n) ? (n as AnalyticsRange) : 30;
}
