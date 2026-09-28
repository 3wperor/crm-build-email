/**
 * Warmup pool logic: ramp and quota math, spreading sends over working hours,
 * peer choice, the reply decision, message text from a built-in phrase bank,
 * and health / auto-pause rules. Pure functions only.
 */
import { z } from "zod";
import { hash32, zonedParts } from "./scheduler";

export const WARMUP_HEADER = "X-YCAReach-Warmup";

export const WARMUP_DEFAULTS = { startVolume: 2, rampStep: 2, target: 20, replyRatePct: 30 } as const;
export const WARMUP_LIMITS = { targetMin: 2, targetMax: 50, rampStepMax: 5, replyRateMax: 60 } as const;
/** Local working hours warmup mail goes out in (minutes since midnight). */
export const WARMUP_HOURS = { start: 8 * 60, end: 18 * 60 } as const;
/** A thread stops after this many messages (original + replies). */
export const WARMUP_MAX_THREAD = 4;
/** Health rules look at this many days. */
export const WARMUP_HEALTH_DAYS = 7;

export const warmupSettingsSchema = z.object({
  target: z.coerce.number().int().min(WARMUP_LIMITS.targetMin).max(WARMUP_LIMITS.targetMax),
  rampStep: z.coerce.number().int().min(1).max(WARMUP_LIMITS.rampStepMax),
  replyRate: z.coerce.number().int().min(0).max(WARMUP_LIMITS.replyRateMax),
});

/** 1 on the day warmup started (in `timeZone`), 2 the next day, … */
export function warmupDay(startedAt: Date, now: Date, timeZone: string): number {
  const a = zonedParts(startedAt, timeZone);
  const b = zonedParts(now, timeZone);
  const days = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 864e5);
  return Math.max(1, days + 1);
}

/**
 * New warmup emails an inbox sends today: start volume, +rampStep per day, up
 * to target; half on weekends (real inboxes are quieter); never more than the
 * inbox's daily cap.
 */
export function warmupQuota(o: { day: number; weekday: number; target: number; rampStep: number; dailyCap: number; startVolume?: number }): number {
  const start = Math.min(o.startVolume ?? WARMUP_DEFAULTS.startVolume, o.target);
  const base = Math.min(o.target, start + o.rampStep * Math.max(0, o.day - 1));
  const weekend = o.weekday === 6 || o.weekday === 7;
  return Math.max(0, Math.min(o.dailyCap, weekend ? Math.ceil(base / 2) : base));
}

/**
 * How many new emails to create now so that today's quota is spread evenly
 * over working hours. Nothing before or after hours.
 */
export function warmupDueNow(o: { quota: number; createdToday: number; minuteOfDay: number }): number {
  if (o.minuteOfDay < WARMUP_HOURS.start || o.minuteOfDay >= WARMUP_HOURS.end) return 0;
  const frac = (o.minuteOfDay - WARMUP_HOURS.start) / (WARMUP_HOURS.end - WARMUP_HOURS.start);
  return Math.max(0, Math.ceil(o.quota * Math.min(1, frac)) - o.createdToday);
}

/** The pool member this inbox has emailed least today; ties broken by a stable hash. */
export function pickWarmupPeer(peers: string[], sentToToday: ReadonlyMap<string, number>, seed: string): string | null {
  if (peers.length === 0) return null;
  const ranked = [...peers].sort((a, b) => (sentToToday.get(a) ?? 0) - (sentToToday.get(b) ?? 0) || hash32(`${seed}:${a}`) - hash32(`${seed}:${b}`));
  return ranked[0]!;
}

/** Deterministic per message, so a retried sync makes the same decision. */
export function shouldReply(messageId: string, replyRatePct: number, threadLength: number): boolean {
  if (threadLength >= WARMUP_MAX_THREAD || replyRatePct <= 0) return false;
  return hash32(`reply:${messageId}`) % 100 < replyRatePct;
}

/** Engagement for a received warmup email: always opened, rescued from spam; some starred. */
export function engagementFor(messageId: string): { markSeen: true; moveToInbox: true; flag: boolean } {
  return { markSeen: true, moveToInbox: true, flag: hash32(`flag:${messageId}`) % 100 < 15 };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type WarmupHealth = { inboxRate: number | null; score: number | null; pauseReason: string | null };

/**
 * From the last 7 days of an inbox's warmup mail as seen by its peers.
 * Pauses on repeated bounces, or when more than 20% lands in spam
 * (with at least 10 received, so a couple of misses don't trip it).
 */
export function warmupHealth(o: { received: number; spam: number; bounced: number }): WarmupHealth {
  const inboxRate = o.received > 0 ? (o.received - o.spam) / o.received : null;
  const score = inboxRate === null ? null : Math.max(0, Math.round(inboxRate * 100) - o.bounced * 10);
  let pauseReason: string | null = null;
  if (o.bounced >= 2) pauseReason = `${o.bounced} warmup emails bounced in the last ${WARMUP_HEALTH_DAYS} days`;
  else if (o.received >= 10 && o.spam / o.received > 0.2) {
    pauseReason = `${Math.round((o.spam / o.received) * 100)}% of warmup emails landed in spam in the last ${WARMUP_HEALTH_DAYS} days`;
  }
  return { inboxRate, score, pauseReason };
}

// ---------------------------------------------------------------------------
// Message text (built-in phrase bank: ordinary, varied business mail)
// ---------------------------------------------------------------------------

const SUBJECTS = [
  "Quick update on this week",
  "Notes from our call",
  "Following up on the schedule",
  "Thoughts on the proposal",
  "Agenda for Thursday",
  "Question about the timeline",
  "Draft for your review",
  "Checking in",
  "Next steps",
  "Recap and a small ask",
  "Budget numbers",
  "Planning for next month",
  "Feedback on the outline",
  "Meeting time",
  "Shared the document",
  "One more thing",
];
const GREETINGS = ["Hi {name},", "Hello {name},", "Hey {name},", "Morning {name},", "Hi there,", "Hello,"];
const OPENERS = [
  "Hope your week is going well.",
  "Thanks again for the quick turnaround.",
  "Just wanted to close the loop on this.",
  "I had a chance to look through everything.",
  "Following up on what we discussed.",
  "Hope you had a good weekend.",
  "Sorry for the slow reply on my side.",
  "Quick note before I forget.",
];
const BODIES = [
  "I went through the draft and it looks good overall. I left a couple of small comments on the second section.",
  "Could we move the review to later in the week? Thursday afternoon works best for me.",
  "The numbers line up with what we expected, so I think we can go ahead with the plan as written.",
  "I talked to the team and everyone is on board. We can start next Monday if that still works for you.",
  "I shared the updated version in the usual folder. Let me know if anything is unclear.",
  "The timeline looks realistic. The only open question is who owns the final sign-off.",
  "I pulled together the notes from last time and added a few ideas for the next round.",
  "We are a little behind on the first milestone, but nothing that should affect the end date.",
  "I like the new direction. It is simpler and should be easier to explain to everyone else.",
  "Can you send over the latest figures when you get a moment? No rush.",
];
const CLOSERS = ["Let me know what you think.", "Talk soon.", "Thanks!", "Happy to jump on a call if easier.", "No rush on this.", "Appreciate it."];
const SIGNOFFS = ["Best,", "Thanks,", "Cheers,", "Regards,", "All the best,"];
const REPLY_BODIES = [
  "Thanks for the update, this all makes sense.",
  "Sounds good to me. Let's go with that.",
  "Got it, I will take a look this afternoon.",
  "Appreciate you sending this over. Looks good.",
  "Works for me. I have added it to my calendar.",
  "Thanks! I will get back to you with comments tomorrow.",
  "Perfect, thanks for pulling this together.",
  "Makes sense. One small question, but it can wait until we talk.",
];

const pick = <T>(list: readonly T[], seed: string, part: string): T => list[hash32(`${seed}:${part}`) % list.length]!;
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "";

function greeting(seed: string, toName: string | null) {
  const g = pick(GREETINGS, seed, "greet");
  const n = firstName(toName);
  return g.includes("{name}") ? (n ? g.replace("{name}", n) : "Hi,") : g;
}

export type WarmupText = { subject: string; text: string };

export function composeWarmupEmail(seed: string, o: { toName: string | null; fromName: string | null }): WarmupText {
  const sign = firstName(o.fromName);
  const lines = [greeting(seed, o.toName), "", `${pick(OPENERS, seed, "open")} ${pick(BODIES, seed, "body")}`, "", pick(CLOSERS, seed, "close"), "", pick(SIGNOFFS, seed, "sign")];
  if (sign) lines.push(sign);
  return { subject: pick(SUBJECTS, seed, "subject"), text: lines.join("\n") };
}

export function composeWarmupReply(seed: string, o: { subject: string; toName: string | null; fromName: string | null }): WarmupText {
  const sign = firstName(o.fromName);
  const lines = [greeting(seed, o.toName), "", pick(REPLY_BODIES, seed, "reply"), "", pick(SIGNOFFS, seed, "sign")];
  if (sign) lines.push(sign);
  return { subject: /^re:/i.test(o.subject) ? o.subject : `Re: ${o.subject}`, text: lines.join("\n") };
}
