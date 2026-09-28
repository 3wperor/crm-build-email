import { z } from "zod";
import { isValidTimeZone } from "./sending-accounts";
import { parseTimeOfDay } from "./scheduler";

export const CAMPAIGN_DAILY_LIMIT_MAX = 10000;
export const CAMPAIGN_PER_INBOX_MAX = 2000;

const timeField = z
  .string()
  .trim()
  .regex(/^\d{1,2}:\d{2}(:\d{2})?$/, "Use HH:MM")
  .refine((v) => safeMinutes(v) !== null, "Invalid time");

function safeMinutes(v: string): number | null {
  try {
    return parseTimeOfDay(v);
  } catch {
    return null;
  }
}

const checkbox = z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());

/** Campaign settings form / MCP set_send_window + set_daily_volume inputs. */
export const campaignSettingsSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    timezone: z.string().trim().refine(isValidTimeZone, "Unknown timezone"),
    sendWindowStart: timeField,
    sendWindowEnd: timeField,
    sendDays: z
      .array(z.coerce.number().int().min(1).max(7))
      .min(1, "Pick at least one day")
      .transform((d) => [...new Set(d)].sort()),
    dailyLimit: z.coerce.number().int().min(0).max(CAMPAIGN_DAILY_LIMIT_MAX),
    dailyLimitPerInbox: z.coerce.number().int().min(0).max(CAMPAIGN_PER_INBOX_MAX),
    includeRisky: checkbox,
    approvalMode: z.enum(["draft", "auto"]).default("draft"),
    accountIds: z.array(z.string().uuid()).default([]),
  })
  // Zod 4 runs this even when a time field already failed, so never throw here.
  .refine((s) => safeMinutes(s.sendWindowStart) === null || safeMinutes(s.sendWindowStart) !== safeMinutes(s.sendWindowEnd), {
    message: "Start and end time can't be the same",
    path: ["sendWindowEnd"],
  });

export type CampaignSettings = z.output<typeof campaignSettingsSchema>;

export const stepSchema = z.object({
  delayDays: z.coerce.number().int().min(0).max(365),
  delayHours: z.coerce.number().int().min(0).max(23),
});

export const variantSchema = z.object({
  subject: z.string().max(300).default(""),
  body: z.string().max(20000).default(""),
  weight: z.coerce.number().int().min(0).max(10000),
  isActive: checkbox,
});

export type StartCheckInput = {
  steps: { step_order: number; variants: { subject: string; body: string; is_active: boolean; weight: number }[] }[];
  inboxes: { status: string; health: string }[];
  physicalAddress: string | null;
  enrolled: number;
  dailyLimit: number;
  dailyLimitPerInbox: number;
};

/** Everything that must be true before a campaign may start sending. Empty array = ready. */
export function campaignStartProblems(c: StartCheckInput): string[] {
  const problems: string[] = [];
  const steps = [...c.steps].sort((a, b) => a.step_order - b.step_order);
  if (steps.length === 0) problems.push("Add at least one step to the sequence.");
  steps.forEach((s, i) => {
    const usable = s.variants.filter((v) => v.is_active && v.weight > 0 && v.body.trim());
    if (usable.length === 0) problems.push(`Step ${i + 1} needs an active variant with a body.`);
    if (i === 0 && usable.some((v) => !v.subject.trim())) problems.push("Every active variant of step 1 needs a subject.");
  });
  if (!c.inboxes.some((i) => i.status === "active" && i.health !== "failing")) {
    problems.push("Attach at least one active, healthy inbox.");
  }
  if (!c.physicalAddress?.trim()) problems.push("Set your physical mailing address in Settings (required in every email footer).");
  if (c.enrolled === 0) problems.push("Add leads to the campaign.");
  if (c.dailyLimit === 0 || c.dailyLimitPerInbox === 0) problems.push("Daily limits must be above zero.");
  return problems;
}

export function nextAbGroup(existing: string[]): string {
  for (let i = 0; i < 26; i++) {
    const g = String.fromCharCode(65 + i);
    if (!existing.includes(g)) return g;
  }
  throw new Error("Too many variants");
}
