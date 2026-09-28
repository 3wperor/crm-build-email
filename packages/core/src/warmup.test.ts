import { describe, expect, it } from "vitest";
import {
  composeWarmupEmail,
  composeWarmupReply,
  engagementFor,
  pickWarmupPeer,
  shouldReply,
  warmupDay,
  warmupDueNow,
  warmupHealth,
  warmupQuota,
  warmupSettingsSchema,
  WARMUP_MAX_THREAD,
} from "./warmup";

describe("warmupDay", () => {
  it("counts calendar days in the inbox's timezone", () => {
    const start = new Date("2026-09-28T22:30:00Z"); // 18:30 in New York, 00:30 next day in Berlin
    expect(warmupDay(start, new Date("2026-09-28T23:00:00Z"), "America/New_York")).toBe(1);
    expect(warmupDay(start, new Date("2026-09-29T14:00:00Z"), "America/New_York")).toBe(2);
    expect(warmupDay(start, new Date("2026-09-29T14:00:00Z"), "Europe/Berlin")).toBe(1);
    expect(warmupDay(start, new Date("2026-10-05T14:00:00Z"), "Europe/Berlin")).toBe(7);
    expect(warmupDay(new Date("2026-10-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z"), "UTC")).toBe(1);
  });
});

describe("warmupQuota", () => {
  const q = (day: number, extra: Partial<Parameters<typeof warmupQuota>[0]> = {}) =>
    warmupQuota({ day, weekday: 2, target: 20, rampStep: 2, dailyCap: 30, ...extra });
  it("ramps from 2 by the step up to the target", () => {
    expect([1, 2, 3, 5, 10, 11, 30].map((d) => q(d))).toEqual([2, 4, 6, 10, 20, 20, 20]);
    expect(q(4, { rampStep: 1 })).toBe(5);
  });
  it("halves on weekends and never exceeds the daily cap", () => {
    expect(q(10, { weekday: 6 })).toBe(10);
    expect(q(2, { weekday: 7 })).toBe(2);
    expect(q(10, { dailyCap: 12 })).toBe(12);
    expect(q(1, { target: 2 })).toBe(2);
  });
});

describe("warmupDueNow", () => {
  it("spreads the quota over 08:00–18:00", () => {
    expect(warmupDueNow({ quota: 10, createdToday: 0, minuteOfDay: 7 * 60 + 59 })).toBe(0);
    expect(warmupDueNow({ quota: 10, createdToday: 0, minuteOfDay: 8 * 60 })).toBe(0);
    expect(warmupDueNow({ quota: 10, createdToday: 0, minuteOfDay: 8 * 60 + 10 })).toBe(1);
    expect(warmupDueNow({ quota: 10, createdToday: 1, minuteOfDay: 8 * 60 + 30 })).toBe(0);
    expect(warmupDueNow({ quota: 10, createdToday: 1, minuteOfDay: 13 * 60 })).toBe(4);
    expect(warmupDueNow({ quota: 10, createdToday: 3, minuteOfDay: 17 * 60 + 59 })).toBe(7);
    expect(warmupDueNow({ quota: 10, createdToday: 3, minuteOfDay: 18 * 60 })).toBe(0);
    expect(warmupDueNow({ quota: 10, createdToday: 12, minuteOfDay: 12 * 60 })).toBe(0);
  });
});

describe("pickWarmupPeer", () => {
  it("prefers the peer emailed least today, stable otherwise", () => {
    const counts = new Map([["a", 2], ["b", 0], ["c", 1]]);
    expect(pickWarmupPeer(["a", "b", "c"], counts, "s")).toBe("b");
    const tie = pickWarmupPeer(["x", "y", "z"], new Map(), "seed-1");
    expect(pickWarmupPeer(["z", "y", "x"], new Map(), "seed-1")).toBe(tie);
    expect(pickWarmupPeer([], new Map(), "s")).toBeNull();
  });
  it("spreads across peers over many seeds", () => {
    const seen = new Set(Array.from({ length: 30 }, (_, i) => pickWarmupPeer(["x", "y", "z"], new Map(), `s${i}`)));
    expect(seen.size).toBe(3);
  });
});

describe("shouldReply", () => {
  it("replies to roughly the configured share, deterministically, and ends long threads", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `<w-${i}@x.test>`);
    const share = ids.filter((id) => shouldReply(id, 30, 1)).length / ids.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.35);
    expect(shouldReply("<a@b>", 30, 1)).toBe(shouldReply("<a@b>", 30, 1));
    expect(ids.some((id) => shouldReply(id, 60, WARMUP_MAX_THREAD))).toBe(false);
    expect(ids.some((id) => shouldReply(id, 0, 1))).toBe(false);
  });
  it("stars some messages, always opens and rescues", () => {
    const e = Array.from({ length: 500 }, (_, i) => engagementFor(`<m${i}>`));
    expect(e.every((x) => x.markSeen && x.moveToInbox)).toBe(true);
    const starred = e.filter((x) => x.flag).length;
    expect(starred).toBeGreaterThan(40);
    expect(starred).toBeLessThan(120);
  });
});

describe("warmupHealth", () => {
  it("scores inbox placement and pauses on spam or bounces", () => {
    expect(warmupHealth({ received: 0, spam: 0, bounced: 0 })).toEqual({ inboxRate: null, score: null, pauseReason: null });
    expect(warmupHealth({ received: 20, spam: 2, bounced: 0 })).toMatchObject({ inboxRate: 0.9, score: 90, pauseReason: null });
    expect(warmupHealth({ received: 20, spam: 5, bounced: 0 }).pauseReason).toBe("25% of warmup emails landed in spam in the last 7 days");
    expect(warmupHealth({ received: 5, spam: 3, bounced: 0 }).pauseReason).toBeNull(); // too little data
    expect(warmupHealth({ received: 20, spam: 0, bounced: 2 })).toMatchObject({ score: 80, pauseReason: "2 warmup emails bounced in the last 7 days" });
  });
});

describe("composeWarmupEmail / reply", () => {
  it("is deterministic, varied and signed", () => {
    const a = composeWarmupEmail("seed-1", { toName: "Grace Hopper", fromName: "Jane Sender" });
    expect(composeWarmupEmail("seed-1", { toName: "Grace Hopper", fromName: "Jane Sender" })).toEqual(a);
    expect(a.text).toMatch(/^(Hi|Hello|Hey|Morning) (Grace,|there,)|^(Hi|Hello),/);
    expect(a.text.trim().endsWith("Jane")).toBe(true);
    expect(a.text).not.toMatch(/\{|\}|undefined/);
    const subjects = new Set(Array.from({ length: 40 }, (_, i) => composeWarmupEmail(`s${i}`, { toName: null, fromName: null }).subject));
    expect(subjects.size).toBeGreaterThan(8);
  });
  it("replies in-thread", () => {
    const r = composeWarmupReply("r1", { subject: "Checking in", toName: "Jane", fromName: "Grace" });
    expect(r.subject).toBe("Re: Checking in");
    expect(composeWarmupReply("r2", { subject: "Re: Checking in", toName: null, fromName: null }).subject).toBe("Re: Checking in");
    expect(r.text).toContain("Grace");
  });
});

describe("warmupSettingsSchema", () => {
  it("bounds the settings", () => {
    expect(warmupSettingsSchema.safeParse({ target: "20", rampStep: "2", replyRate: "30" }).success).toBe(true);
    expect(warmupSettingsSchema.safeParse({ target: "51", rampStep: "2", replyRate: "30" }).success).toBe(false);
    expect(warmupSettingsSchema.safeParse({ target: "20", rampStep: "0", replyRate: "30" }).success).toBe(false);
    expect(warmupSettingsSchema.safeParse({ target: "20", rampStep: "2", replyRate: "61" }).success).toBe(false);
  });
});
