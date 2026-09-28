import { describe, expect, it } from "vitest";
import {
  addDelay,
  checkSend,
  computeNextSendAt,
  estimateNextSend,
  hash32,
  isWithinWindow,
  nextDayWindowOpening,
  nextWindowOpening,
  parseTimeOfDay,
  pickInbox,
  pickVariant,
  randomSendGapMs,
  startOfLocalDay,
  zonedParts,
  zonedTimeToUtc,
  type GuardInput,
  type SendWindow,
} from "./scheduler";

const NY = "America/New_York";
const weekdays9to5: SendWindow = { timezone: NY, start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] };
const iso = (d: Date) => d.toISOString();

describe("zoned time conversion", () => {
  it("round-trips normal times", () => {
    // 2026-09-28 09:00 EDT = 13:00Z
    expect(iso(zonedTimeToUtc(2026, 9, 28, 9 * 60, NY))).toBe("2026-09-28T13:00:00.000Z");
    expect(zonedParts(new Date("2026-09-28T13:00:00Z"), NY)).toMatchObject({ hour: 9, minute: 0, weekday: 1 });
  });

  it("handles winter offset", () => {
    expect(iso(zonedTimeToUtc(2026, 1, 15, 9 * 60, NY))).toBe("2026-01-15T14:00:00.000Z");
  });

  it("shifts non-existent spring-forward times past the gap", () => {
    // 2026-03-08 02:30 does not exist in New York → 03:30 EDT = 07:30Z
    expect(iso(zonedTimeToUtc(2026, 3, 8, 150, NY))).toBe("2026-03-08T07:30:00.000Z");
  });

  it("resolves ambiguous fall-back times to the earlier instant", () => {
    // 2026-11-01 01:30 happens twice; first is EDT (05:30Z)
    expect(iso(zonedTimeToUtc(2026, 11, 1, 90, NY))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("works for half-hour zones", () => {
    expect(iso(zonedTimeToUtc(2026, 9, 28, 9 * 60, "Asia/Kolkata"))).toBe("2026-09-28T03:30:00.000Z");
  });

  it("parses Postgres time strings", () => {
    expect(parseTimeOfDay("09:00:00")).toBe(540);
    expect(parseTimeOfDay("9:05")).toBe(545);
    expect(() => parseTimeOfDay("25:00")).toThrow();
  });
});

describe("isWithinWindow", () => {
  it("respects hours, end-exclusive, and days", () => {
    expect(isWithinWindow(new Date("2026-09-28T13:00:00Z"), weekdays9to5)).toBe(true); // Mon 09:00
    expect(isWithinWindow(new Date("2026-09-28T12:59:00Z"), weekdays9to5)).toBe(false); // Mon 08:59
    expect(isWithinWindow(new Date("2026-09-28T21:00:00Z"), weekdays9to5)).toBe(false); // Mon 17:00
    expect(isWithinWindow(new Date("2026-10-03T15:00:00Z"), weekdays9to5)).toBe(false); // Sat 11:00
  });

  it("supports overnight windows attributed to the opening day", () => {
    const night: SendWindow = { timezone: "UTC", start: "22:00", end: "02:00", days: [5] }; // Friday night
    expect(isWithinWindow(new Date("2026-10-02T23:00:00Z"), night)).toBe(true); // Fri 23:00
    expect(isWithinWindow(new Date("2026-10-03T01:00:00Z"), night)).toBe(true); // Sat 01:00 (Fri window)
    expect(isWithinWindow(new Date("2026-10-03T23:00:00Z"), night)).toBe(false); // Sat 23:00
    expect(isWithinWindow(new Date("2026-10-02T01:00:00Z"), night)).toBe(false); // Fri 01:00 (Thu window)
  });
});

describe("nextWindowOpening", () => {
  it("returns `from` when already inside", () => {
    const t = new Date("2026-09-28T15:00:00Z");
    expect(nextWindowOpening(t, weekdays9to5)).toBe(t);
  });

  it("moves to today's opening, tomorrow's, or past the weekend", () => {
    expect(iso(nextWindowOpening(new Date("2026-09-28T10:00:00Z"), weekdays9to5))).toBe("2026-09-28T13:00:00.000Z"); // Mon 06:00 → Mon 09:00
    expect(iso(nextWindowOpening(new Date("2026-09-28T22:00:00Z"), weekdays9to5))).toBe("2026-09-29T13:00:00.000Z"); // Mon 18:00 → Tue
    expect(iso(nextWindowOpening(new Date("2026-10-02T22:00:00Z"), weekdays9to5))).toBe("2026-10-05T13:00:00.000Z"); // Fri 18:00 → Mon
  });

  it("stays at 09:00 local across the DST change", () => {
    // Fri 2026-10-30 18:00 EDT → Mon 2026-11-02 09:00 EST (14:00Z, not 13:00Z)
    expect(iso(nextWindowOpening(new Date("2026-10-30T22:00:00Z"), weekdays9to5))).toBe("2026-11-02T14:00:00.000Z");
  });

  it("handles a single allowed day a week away", () => {
    const tuesdays: SendWindow = { ...weekdays9to5, days: [2] };
    expect(iso(nextWindowOpening(new Date("2026-09-29T22:00:00Z"), tuesdays))).toBe("2026-10-06T13:00:00.000Z");
  });

  it("rejects windows with no days", () => {
    expect(() => nextWindowOpening(new Date(), { ...weekdays9to5, days: [] })).toThrow();
  });
});

describe("addDelay / computeNextSendAt", () => {
  it("adds calendar days at the same wall-clock time across DST", () => {
    // Fri 2026-10-30 10:00 EDT + 3 days = Mon 2026-11-02 10:00 EST
    expect(iso(addDelay(new Date("2026-10-30T14:00:00Z"), 3, 0, NY))).toBe("2026-11-02T15:00:00.000Z");
  });

  it("adds hours as elapsed time", () => {
    expect(iso(addDelay(new Date("2026-09-28T14:00:00Z"), 0, 5, NY))).toBe("2026-09-28T19:00:00.000Z");
  });

  it("first step goes now (snapped into the window)", () => {
    const now = new Date("2026-09-28T11:00:00Z"); // Mon 07:00
    expect(iso(computeNextSendAt({ now, step: { delayDays: 0, delayHours: 0 }, lastSentAt: null, window: weekdays9to5 }))).toBe(
      "2026-09-28T13:00:00.000Z",
    );
  });

  it("follow-up after N days skips the weekend", () => {
    // sent Thu 2026-10-01 15:00 EDT, +2 days = Sat → Mon 09:00
    const r = computeNextSendAt({
      now: new Date("2026-10-01T19:05:00Z"),
      step: { delayDays: 2, delayHours: 0 },
      lastSentAt: new Date("2026-10-01T19:00:00Z"),
      window: weekdays9to5,
    });
    expect(iso(r)).toBe("2026-10-05T13:00:00.000Z");
  });

  it("never schedules in the past", () => {
    const now = new Date("2026-10-07T15:00:00Z");
    const r = computeNextSendAt({ now, step: { delayDays: 1, delayHours: 0 }, lastSentAt: new Date("2026-10-01T15:00:00Z"), window: weekdays9to5 });
    expect(r.getTime()).toBe(now.getTime());
  });
});

describe("day boundaries", () => {
  it("computes local midnight and the next day's opening", () => {
    const t = new Date("2026-09-29T02:00:00Z"); // Mon 22:00 EDT
    expect(iso(startOfLocalDay(t, NY))).toBe("2026-09-28T04:00:00.000Z");
    expect(iso(nextDayWindowOpening(t, weekdays9to5))).toBe("2026-09-29T13:00:00.000Z");
    expect(iso(nextDayWindowOpening(new Date("2026-10-02T15:00:00Z"), weekdays9to5))).toBe("2026-10-05T13:00:00.000Z"); // Fri → Mon
  });
});

describe("randomSendGapMs", () => {
  it("stays within 3–7 minutes", () => {
    expect(randomSendGapMs(undefined, () => 0)).toBe(180_000);
    expect(randomSendGapMs(undefined, () => 0.999999)).toBeLessThanOrEqual(420_000);
    for (let i = 0; i < 100; i++) {
      const g = randomSendGapMs();
      expect(g).toBeGreaterThanOrEqual(180_000);
      expect(g).toBeLessThanOrEqual(420_000);
    }
  });
});

describe("pickVariant", () => {
  const v = (id: string, weight: number, extra: object = {}) => ({ id, weight, is_active: true, ...extra });

  it("is deterministic per seed", () => {
    const vs = [v("a", 50), v("b", 50)];
    expect(pickVariant(vs, "lead-1:step-1")).toEqual(pickVariant([...vs].reverse(), "lead-1:step-1"));
  });

  it("splits roughly by weight", () => {
    const vs = [v("a", 70), v("b", 30)];
    let a = 0;
    for (let i = 0; i < 20000; i++) if (pickVariant(vs, `lead-${i}:step`)!.id === "a") a++;
    expect(a / 20000).toBeGreaterThan(0.68);
    expect(a / 20000).toBeLessThan(0.72);
  });

  it("ignores inactive / zero-weight variants and honors a winner", () => {
    expect(pickVariant([v("a", 0), v("b", 10, { is_active: false }), v("c", 5)], "x")!.id).toBe("c");
    expect(pickVariant([v("a", 90), v("b", 10, { is_winner: true })], "x")!.id).toBe("b");
    expect(pickVariant([v("a", 0)], "x")).toBeNull();
  });

  it("hash32 is stable", () => {
    expect(hash32("hello")).toBe(hash32("hello"));
    expect(hash32("hello")).not.toBe(hash32("hellp"));
  });
});

describe("pickInbox", () => {
  const c = (id: string, remaining: number, extra: object = {}) => ({ id, remaining, status: "active", health: "healthy", ...extra });

  it("picks the usable inbox with most room", () => {
    expect(pickInbox([c("a", 3), c("b", 10), c("c", 20, { health: "failing" }), c("d", 30, { status: "paused" })], null)).toBe("b");
    expect(pickInbox([c("a", 0)], null)).toBeNull();
  });

  it("keeps threads on their inbox, or waits", () => {
    expect(pickInbox([c("a", 3), c("b", 10)], "a")).toBe("a");
    expect(pickInbox([c("a", 0), c("b", 10)], "a")).toBeNull();
    expect(pickInbox([c("b", 10)], "a")).toBeNull();
  });
});

describe("checkSend", () => {
  const base: GuardInput = {
    now: new Date("2026-09-28T15:00:00Z"), // Mon 11:00 NY
    orgPaused: false,
    campaignStatus: "active",
    enrollmentStatus: "active",
    leadStatus: "in_sequence",
    verificationStatus: "valid",
    includeRisky: false,
    suppressed: false,
    window: weekdays9to5,
  };

  it("allows a normal send", () => {
    expect(checkSend(base)).toEqual({ ok: true });
  });

  it("holds when the kill switch is on or the campaign isn't active", () => {
    expect(checkSend({ ...base, orgPaused: true })).toMatchObject({ ok: false, action: "hold", reason: "sending_paused" });
    expect(checkSend({ ...base, campaignStatus: "paused" })).toMatchObject({ ok: false, action: "hold" });
  });

  it.each([
    [{ suppressed: true }, "suppressed", "stopped"],
    [{ leadStatus: "replied" }, "lead_replied", "replied"],
    [{ leadStatus: "bounced" }, "lead_bounced", "bounced"],
    [{ leadStatus: "unsubscribed" }, "lead_unsubscribed", "unsubscribed"],
    [{ leadStatus: "do_not_contact" }, "lead_do_not_contact", "stopped"],
    [{ verificationStatus: "invalid" }, "invalid_email", "stopped"],
    [{ verificationStatus: "risky" }, "risky_email", "stopped"],
    [{ enrollmentStatus: "replied" }, "enrollment_replied", "replied"],
  ])("stops for %o", (over, reason, enrollmentStatus) => {
    expect(checkSend({ ...base, ...over })).toEqual({ ok: false, action: "stop", reason, enrollmentStatus });
  });

  it("allows risky when the campaign opts in, and unverified/unknown", () => {
    expect(checkSend({ ...base, verificationStatus: "risky", includeRisky: true }).ok).toBe(true);
    expect(checkSend({ ...base, verificationStatus: "unverified" }).ok).toBe(true);
    expect(checkSend({ ...base, verificationStatus: "unknown" }).ok).toBe(true);
  });

  it("defers while verification is running and outside the window", () => {
    expect(checkSend({ ...base, verificationStatus: "pending" })).toMatchObject({ action: "defer", reason: "verification_pending" });
    const r = checkSend({ ...base, now: new Date("2026-10-03T15:00:00Z") }); // Saturday
    expect(r).toMatchObject({ action: "defer", reason: "outside_window" });
    expect(iso((r as { retryAt: Date }).retryAt)).toBe("2026-10-05T13:00:00.000Z");
  });

  it("suppression beats a paused campaign? no — hold wins, suppression is re-checked on resume", () => {
    expect(checkSend({ ...base, campaignStatus: "paused", suppressed: true })).toMatchObject({ action: "hold" });
  });
});



describe("estimateNextSend", () => {
  const now = new Date("2026-09-28T15:00:00Z"); // Mon 11:00 NY
  const base = { now, active: true, window: weekdays9to5, inflight: 0, earliestDue: now, remainingToday: 10 };
  it("covers each state", () => {
    expect(estimateNextSend({ ...base, active: false })).toEqual({ kind: "not_running" });
    expect(estimateNextSend({ ...base, inflight: 3 })).toEqual({ kind: "sending_now", queued: 3 });
    expect(estimateNextSend({ ...base, earliestDue: null })).toEqual({ kind: "nothing_due" });
    expect(estimateNextSend(base)).toEqual({ kind: "at", at: now, reason: "due" });
    expect(estimateNextSend({ ...base, remainingToday: 0 })).toMatchObject({ reason: "quota_tomorrow", at: new Date("2026-09-29T13:00:00Z") });
    expect(estimateNextSend({ ...base, earliestDue: new Date("2026-10-03T15:00:00Z") })).toMatchObject({ reason: "window", at: new Date("2026-10-05T13:00:00Z") });
  });
});
