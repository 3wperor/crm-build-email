/**
 * Scheduling primitives. Pure and deterministic (pass `now` / `random` in),
 * so the planner, the sender and the UI estimate all agree.
 *
 * Time zones use Intl only (no dependency). Wall-clock arithmetic is done in
 * the campaign's zone so "3 days later at the same time" survives DST.
 */

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type SendWindow = {
  timezone: string;
  /** "HH:MM" or "HH:MM:SS" (Postgres `time`). end < start = overnight window. */
  start: string;
  end: string;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. For overnight windows, the day the window opens. */
  days: readonly number[];
};

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday!]!,
  };
}

/** Offset of `timeZone` from UTC at `date`, in ms (wall clock − UTC). */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * UTC instant for a wall-clock time in `timeZone`. Times that don't exist
 * (spring-forward gap) are shifted forward by the gap (02:30 → 03:30);
 * ambiguous times (fall-back) resolve to the earlier instant.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, minuteOfDay: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  // Try both candidate offsets around the target and keep the ones that round-trip.
  const candidates = [offsetMs(new Date(wall - 36e5 * 14), timeZone), offsetMs(new Date(wall + 36e5 * 14), timeZone), offsetMs(new Date(wall), timeZone)];
  const valid = [...new Set(candidates)]
    .map((off) => wall - off)
    .filter((t) => {
      const p = zonedParts(new Date(t), timeZone);
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall;
    })
    .sort((a, b) => a - b);
  if (valid.length > 0) return new Date(valid[0]!);
  // In a gap: interpret with the pre-transition offset, which lands after the gap.
  return new Date(wall - offsetMs(new Date(wall - 36e5 * 14), timeZone));
}

export function parseTimeOfDay(s: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) throw new Error(`Invalid time of day: ${s}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Invalid time of day: ${s}`);
  return h * 60 + min;
}

const prevWeekday = (d: number) => ((d + 5) % 7) + 1;

function shiftDate(y: number, m: number, d: number, days: number) {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function isWithinWindow(date: Date, w: SendWindow): boolean {
  const p = zonedParts(date, w.timezone);
  const mins = p.hour * 60 + p.minute;
  const start = parseTimeOfDay(w.start);
  const end = parseTimeOfDay(w.end);
  if (start < end) return w.days.includes(p.weekday) && mins >= start && mins < end;
  // Overnight window, e.g. 22:00–02:00: belongs to the day it opened.
  if (mins >= start) return w.days.includes(p.weekday);
  if (mins < end) return w.days.includes(prevWeekday(p.weekday));
  return false;
}

/** Earliest instant ≥ `from` inside the window. */
export function nextWindowOpening(from: Date, w: SendWindow): Date {
  if (w.days.length === 0) throw new Error("Send window has no days");
  if (isWithinWindow(from, w)) return from;
  const p = zonedParts(from, w.timezone);
  const start = parseTimeOfDay(w.start);
  for (let i = 0; i <= 8; i++) {
    const weekday = ((p.weekday - 1 + i) % 7) + 1;
    if (!w.days.includes(weekday)) continue;
    const d = shiftDate(p.year, p.month, p.day, i);
    const open = zonedTimeToUtc(d.year, d.month, d.day, start, w.timezone);
    if (open.getTime() >= from.getTime()) return open;
  }
  throw new Error("No window opening found within 8 days");
}

/** Start of the local calendar day containing `date`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, timeZone);
}

/** Opening of the first window on a later local day than `date` (used when today's quota is spent). */
export function nextDayWindowOpening(date: Date, w: SendWindow): Date {
  const p = zonedParts(date, w.timezone);
  const d = shiftDate(p.year, p.month, p.day, 1);
  return nextWindowOpening(zonedTimeToUtc(d.year, d.month, d.day, 0, w.timezone), w);
}

/** `from` + N calendar days (same wall-clock time, DST-safe) + H hours. */
export function addDelay(from: Date, delayDays: number, delayHours: number, timeZone: string): Date {
  const p = zonedParts(from, timeZone);
  const d = shiftDate(p.year, p.month, p.day, delayDays);
  const base = zonedTimeToUtc(d.year, d.month, d.day, p.hour * 60 + p.minute, timeZone);
  return new Date(base.getTime() + p.second * 1000 + delayHours * 36e5);
}

export type StepTiming = { delayDays: number; delayHours: number };

/**
 * When the next step should go out: step 1 is timed from enrollment/start,
 * later steps from the previous send. Always snapped into the send window.
 */
export function computeNextSendAt(opts: {
  now: Date;
  step: StepTiming;
  lastSentAt: Date | null;
  enrolledAt?: Date | null;
  window: SendWindow;
}): Date {
  const anchor = opts.lastSentAt ?? opts.now;
  const due = addDelay(anchor, opts.step.delayDays, opts.step.delayHours, opts.window.timezone);
  return nextWindowOpening(due.getTime() < opts.now.getTime() ? opts.now : due, opts.window);
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

export const DEFAULT_SEND_GAP = { minSeconds: 180, maxSeconds: 420 };

/** Random gap between two sends from the same inbox (human-like, not a steady beat). */
export function randomSendGapMs(gap = DEFAULT_SEND_GAP, random: () => number = Math.random): number {
  const min = Math.max(0, gap.minSeconds);
  const max = Math.max(min, gap.maxSeconds);
  return Math.round((min + random() * (max - min)) * 1000);
}

// ---------------------------------------------------------------------------
// A/B variant selection
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit with a murmur3 finalizer — fast, isomorphic, well distributed. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export type VariantLike = { id: string; weight: number; is_active: boolean; is_winner?: boolean };

/**
 * Deterministic weighted split: the same lead always gets the same variant
 * for a step (retries, previews and analytics agree). A promoted winner
 * takes all traffic.
 */
export function pickVariant<T extends VariantLike>(variants: T[], seed: string): T | null {
  const eligible = variants.filter((v) => v.is_active && v.weight > 0).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (eligible.length === 0) return null;
  const winner = eligible.find((v) => v.is_winner);
  if (winner) return winner;
  const total = eligible.reduce((n, v) => n + v.weight, 0);
  let point = hash32(seed) % total;
  for (const v of eligible) {
    if (point < v.weight) return v;
    point -= v.weight;
  }
  return eligible[eligible.length - 1]!;
}

// ---------------------------------------------------------------------------
// Inbox selection
// ---------------------------------------------------------------------------

export type InboxCandidate = { id: string; remaining: number; status: string; health: string };

export function isUsableInbox(i: Pick<InboxCandidate, "status" | "health">): boolean {
  return i.status === "active" && i.health !== "failing";
}

/**
 * A thread sticks to the inbox that sent step 1 (replies and threading break
 * otherwise). New threads go to the usable inbox with the most room today.
 * Returns null when nothing can send now.
 */
export function pickInbox(candidates: InboxCandidate[], stickyId: string | null): string | null {
  if (stickyId) {
    const sticky = candidates.find((c) => c.id === stickyId);
    return sticky && isUsableInbox(sticky) && sticky.remaining > 0 ? sticky.id : null;
  }
  const usable = candidates.filter((c) => isUsableInbox(c) && c.remaining > 0);
  usable.sort((a, b) => b.remaining - a.remaining || (a.id < b.id ? -1 : 1));
  return usable[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Send guard
// ---------------------------------------------------------------------------

const BLOCKED_LEAD_STATUSES = new Set(["replied", "bounced", "unsubscribed", "do_not_contact"]);

export type GuardInput = {
  now: Date;
  orgPaused: boolean;
  campaignStatus: string;
  enrollmentStatus: string;
  leadStatus: string;
  verificationStatus: string;
  includeRisky: boolean;
  suppressed: boolean;
  window: SendWindow;
};

export type GuardResult =
  | { ok: true }
  /** stop: this lead must never get this campaign's next email. */
  | { ok: false; action: "stop"; reason: string; enrollmentStatus: string }
  /** hold: wait (kill switch / paused campaign); re-planned on resume. */
  | { ok: false; action: "hold"; reason: string }
  /** defer: try again at retryAt. */
  | { ok: false; action: "defer"; reason: string; retryAt: Date };

/**
 * The single source of truth for "may this email go out right now?" — run by
 * the planner and again by the sender immediately before SMTP. Caps are
 * enforced atomically in the database (reserve_send_slot).
 */
export function checkSend(i: GuardInput): GuardResult {
  if (i.orgPaused) return { ok: false, action: "hold", reason: "sending_paused" };
  if (i.campaignStatus !== "active") return { ok: false, action: "hold", reason: `campaign_${i.campaignStatus}` };

  if (i.suppressed) return { ok: false, action: "stop", reason: "suppressed", enrollmentStatus: "stopped" };
  if (BLOCKED_LEAD_STATUSES.has(i.leadStatus)) {
    const status = i.leadStatus === "replied" || i.leadStatus === "bounced" || i.leadStatus === "unsubscribed" ? i.leadStatus : "stopped";
    return { ok: false, action: "stop", reason: `lead_${i.leadStatus}`, enrollmentStatus: status };
  }
  if (!["queued", "active"].includes(i.enrollmentStatus)) {
    return { ok: false, action: "stop", reason: `enrollment_${i.enrollmentStatus}`, enrollmentStatus: i.enrollmentStatus };
  }
  if (i.verificationStatus === "invalid") return { ok: false, action: "stop", reason: "invalid_email", enrollmentStatus: "stopped" };
  if (i.verificationStatus === "risky" && !i.includeRisky) {
    return { ok: false, action: "stop", reason: "risky_email", enrollmentStatus: "stopped" };
  }
  if (i.verificationStatus === "pending") {
    return { ok: false, action: "defer", reason: "verification_pending", retryAt: new Date(i.now.getTime() + 10 * 60_000) };
  }

  if (!isWithinWindow(i.now, i.window)) {
    return { ok: false, action: "defer", reason: "outside_window", retryAt: nextWindowOpening(i.now, i.window) };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// UI estimate
// ---------------------------------------------------------------------------

export type NextSendEstimate =
  | { kind: "not_running" }
  | { kind: "sending_now"; queued: number }
  | { kind: "at"; at: Date; reason: "window" | "due" | "quota_tomorrow" }
  | { kind: "nothing_due" };

/** "Next send" for the campaign header, consistent with how the planner decides. */
export function estimateNextSend(opts: {
  now: Date;
  active: boolean;
  window: SendWindow;
  inflight: number;
  earliestDue: Date | null;
  remainingToday: number;
}): NextSendEstimate {
  if (!opts.active) return { kind: "not_running" };
  if (opts.inflight > 0) return { kind: "sending_now", queued: opts.inflight };
  if (!opts.earliestDue) return { kind: "nothing_due" };
  if (opts.remainingToday <= 0) return { kind: "at", at: nextDayWindowOpening(opts.now, opts.window), reason: "quota_tomorrow" };
  const due = opts.earliestDue.getTime() > opts.now.getTime() ? opts.earliestDue : opts.now;
  const at = nextWindowOpening(due, opts.window);
  return { kind: "at", at, reason: at.getTime() === due.getTime() ? "due" : "window" };
}
