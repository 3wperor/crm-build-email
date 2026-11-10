/**
 * The welcome flow's "growth plan": what a customer is worth, what the goal
 * adds up to, and roughly what it takes. Pure and browser-safe (no node deps),
 * so the welcome screens can show each fact the moment an answer is picked.
 *
 * Every number comes from the user's own answers plus the openly stated
 * assumptions below; nothing here is an industry statistic.
 */
import { z } from "zod";

export const CUSTOMER_VALUE_OPTIONS = [250, 1000, 5000, 10000] as const;
export const GOAL_OPTIONS = [1, 3, 5, 10] as const;

/** Used for the plan when a question was skipped (shown as an example). */
export const EXAMPLE_ANSWERS = { customerValue: 1000, customersPerMonth: 3 } as const;

/** Rough-guide assumptions, shown to the user next to the numbers. Easy to change once real averages exist. */
export const PLAN_ASSUMPTIONS = {
  /** 3 in 100 people reply. */
  replyRate: 0.03,
  /** 1 in 5 replies becomes a customer. */
  replyToCustomer: 0.2,
  /** Writing, sending and remembering a follow-up by hand. */
  minutesPerEmailByHand: 3,
  trialEmails: 200,
} as const;

export const CHANNELS = [
  {
    id: "referrals",
    label: "Referrals / word of mouth",
    fact: "Referrals are great, but you can't turn them up when things are quiet. Outreach is the tap you control.",
  },
  {
    id: "manual_email",
    label: "Emailing people by hand",
    fact: "Writing, sending and remembering follow-ups takes about 3 minutes an email. YCAReach sends and follows up for you.",
  },
  {
    id: "ads",
    label: "Ads",
    fact: "No cost per click here: it costs the same whether 2 or 20 people reply.",
  },
  {
    id: "social",
    label: "Social media",
    fact: "Posts reach whoever happens to be scrolling. An email reaches the exact person you picked.",
  },
  {
    id: "cold_calling",
    label: "Cold calling",
    fact: "Emails don't need anyone to pick up, and they keep working while you're busy with customers.",
  },
  {
    id: "not_much",
    label: "Not much yet",
    fact: "Good time to start: most people send their first campaign on day one.",
  },
] as const;
export type ChannelId = (typeof CHANNELS)[number]["id"];
export const CHANNEL_IDS = CHANNELS.map((c) => c.id) as [ChannelId, ...ChannelId[]];

export const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

export function valueFact(customerValue: number): string {
  return `So just one extra customer a month is worth ${gbp(customerValue * 12)} a year.`;
}

export function goalFact(customerValue: number, customersPerMonth: number): string {
  const n = customersPerMonth === 1 ? "1 new customer" : `${customersPerMonth} new customers`;
  return `${n} a month = ${gbp(customerValue * customersPerMonth * 12)} a year in new business. Let's see what it takes.`;
}

export function channelFacts(channels: readonly string[]): string[] {
  return CHANNELS.filter((c) => channels.includes(c.id)).map((c) => c.fact);
}

export type GrowthPlan = {
  customerValue: number;
  customersPerMonth: number;
  /** True when a skipped answer was filled with the example. */
  example: boolean;
  yearlyValue: number;
  emailsPerMonth: number;
  hoursSavedPerMonth: number;
  trialEmails: number;
};

/** What the goal takes, as a rough guide. Emails are rounded up to the nearest 50. */
export function growthPlan(answers: { customerValue: number | null; customersPerMonth: number | null }, a = PLAN_ASSUMPTIONS): GrowthPlan {
  const customerValue = answers.customerValue ?? EXAMPLE_ANSWERS.customerValue;
  const customersPerMonth = answers.customersPerMonth ?? EXAMPLE_ANSWERS.customersPerMonth;
  const raw = customersPerMonth / (a.replyRate * a.replyToCustomer);
  const emailsPerMonth = Math.ceil(raw / 50) * 50;
  return {
    customerValue,
    customersPerMonth,
    example: answers.customerValue === null || answers.customersPerMonth === null,
    yearlyValue: customerValue * customersPerMonth * 12,
    emailsPerMonth,
    hoursSavedPerMonth: Math.round((emailsPerMonth * a.minutesPerEmailByHand) / 60),
    trialEmails: a.trialEmails,
  };
}

/** "If 3 in 100 people reply and 1 in 5 replies becomes a customer." */
export function assumptionsText(a = PLAN_ASSUMPTIONS): string {
  return `Rough guide: if ${Math.round(a.replyRate * 100)} in 100 people reply and 1 in ${Math.round(1 / a.replyToCustomer)} replies becomes a customer. You'll see your real numbers within a week.`;
}

// ---------------------------------------------------------------------------
// Saved answers
// ---------------------------------------------------------------------------

const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

export const welcomeAnswersSchema = z.object({
  customerValue: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(10_000_000).nullable()),
  customersPerMonth: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(1000).nullable()),
  channels: z.preprocess((v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(CHANNEL_IDS)).max(CHANNELS.length)),
  offer: z.preprocess(blankToNull, z.string().trim().max(2000).nullable()),
  audience: z.preprocess(blankToNull, z.string().trim().max(500).nullable()),
  hasList: z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : null), z.boolean().nullable()),
});
export type WelcomeAnswers = z.infer<typeof welcomeAnswersSchema>;

// ---------------------------------------------------------------------------
// Email provider guess (replaces the old "which email do you use?" question)
// ---------------------------------------------------------------------------

const GOOGLE = new Set(["gmail.com", "googlemail.com"]);
const MICROSOFT = new Set(["outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "live.co.uk", "msn.com"]);

/** From the sign-up address: gmail → "gmail", Outlook.com family → "outlook", anything else unknown. */
export function guessEmailProvider(email: string): "gmail" | "outlook" | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (GOOGLE.has(domain)) return "gmail";
  if (MICROSOFT.has(domain)) return "outlook";
  return null;
}

// ---------------------------------------------------------------------------
// Dashboard goal tracker
// ---------------------------------------------------------------------------

export function goalProgress(goal: number, wonThisMonth: number, customerValue: number | null) {
  return {
    goal,
    won: wonThisMonth,
    pct: Math.min(100, Math.round((wonThisMonth / Math.max(goal, 1)) * 100)),
    reached: wonThisMonth >= goal,
    valueWon: customerValue ? wonThisMonth * customerValue : null,
  };
}
