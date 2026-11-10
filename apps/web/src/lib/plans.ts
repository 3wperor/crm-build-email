/** Plans as shown to people (homepage and Billing). Browser-safe: no server imports. */
export type PaidPlan = "standard" | "pro";
export type Interval = "month" | "year";

export const PRICES: Record<PaidPlan, Record<Interval, number>> = { standard: { month: 20, year: 200 }, pro: { month: 25, year: 250 } };

// soon: shown as "coming soon" for features that aren't built yet.
export const PLAN_FEATURES: { label: string; standard: boolean; soon?: boolean }[] = [
  { label: "Unlimited campaigns, follow-ups and A/B tests", standard: true },
  { label: "Your own inboxes, lead import (CSV/Excel) and verification", standard: true },
  { label: "Reply detection, pipeline, analytics, warmup", standard: true },
  { label: "HubSpot sync", standard: true },
  { label: "AI writes your campaign emails", standard: false },
  { label: "AI sorts replies and drafts answers you send in one click", standard: false },
  { label: "Use your own Claude or OpenAI key for a stronger model", standard: false },
  { label: "Connect Claude (MCP) to run YCAReach from chat", standard: false },
];

export const TRIAL = { days: 7, emails: 200 } as const;
