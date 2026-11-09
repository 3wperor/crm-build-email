/**
 * Onboarding: welcome answers, the getting-started checklist, in-app trial
 * banners and the reminder emails. Pure: no I/O.
 */
import { z } from "zod";
import { trialDaysLeft, type BillingStatus } from "./billing";

// ---------------------------------------------------------------------------
// Welcome questions
// ---------------------------------------------------------------------------

export const EMAIL_PROVIDERS = ["gmail", "outlook", "other"] as const;
export type EmailProviderAnswer = (typeof EMAIL_PROVIDERS)[number];

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const welcomeAnswersSchema = z.object({
  offer: z.preprocess(blankToNull, z.string().trim().max(2000).nullable().default(null)),
  audience: z.preprocess(blankToNull, z.string().trim().max(500).nullable().default(null)),
  provider: z.preprocess(blankToNull, z.enum(EMAIL_PROVIDERS).nullable().default(null)),
  hasList: z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : null), z.boolean().nullable()),
});
export type WelcomeAnswers = z.infer<typeof welcomeAnswersSchema>;

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export type ChecklistFacts = {
  inboxes: number;
  hasAddress: boolean;
  leads: number;
  /** Campaigns with at least one written email. */
  writtenCampaigns: number;
  /** Test emails that went out. */
  testsSent: number;
  /** Campaigns that were started (active, paused after start, or completed). */
  startedCampaigns: number;
  /** For a better hint on the leads step. */
  hasList?: boolean | null;
  provider?: EmailProviderAnswer | null;
  firstCampaignId?: string | null;
};

export type ChecklistItem = { id: string; title: string; hint: string; href: string; cta: string; done: boolean };

export function onboardingChecklist(f: ChecklistFacts): ChecklistItem[] {
  const campaignHref = f.firstCampaignId ? `/campaigns/${f.firstCampaignId}` : "/campaigns";
  return [
    {
      id: "inbox",
      title: "Connect the inbox you'll send from",
      hint:
        f.provider === "outlook"
          ? "Outlook / Microsoft 365 isn't supported yet. Use a Gmail or Google Workspace address, or another provider with SMTP."
          : "Takes about 2 minutes with an app password. We'll walk you through it.",
      href: "/inboxes/new",
      cta: "Connect inbox",
      done: f.inboxes > 0,
    },
    {
      id: "address",
      title: "Add your business address",
      hint: "The law (UK PECR, CAN-SPAM) requires a postal address in every cold email's footer.",
      href: "/settings",
      cta: "Add address",
      done: f.hasAddress,
    },
    {
      id: "leads",
      title: "Add the people you want to email",
      hint:
        f.hasList === false
          ? "No list yet? Start with 20–50 people you'd genuinely like to work with: a spreadsheet with name, company and email is enough."
          : "Upload a CSV or Excel file, or paste addresses. Emails are checked automatically.",
      href: "/leads",
      cta: "Add leads",
      done: f.leads > 0,
    },
    {
      id: "write",
      title: "Write your campaign",
      hint: "Create a campaign and click “Write with AI”: it drafts the first email and the follow-ups for you.",
      href: campaignHref,
      cta: f.firstCampaignId ? "Open campaign" : "Create campaign",
      done: f.writtenCampaigns > 0,
    },
    {
      id: "test",
      title: "Send yourself a test",
      hint: "See exactly what your leads will get, with their names filled in.",
      href: f.firstCampaignId ? `${campaignHref}?tab=sequence` : "/campaigns",
      cta: "Send a test",
      done: f.testsSent > 0,
    },
    {
      id: "start",
      title: "Start your campaign",
      hint: "Add leads to the campaign and press Start. Emails go out slowly within your sending hours.",
      href: f.firstCampaignId ? `${campaignHref}?tab=leads` : "/campaigns",
      cta: "Start",
      done: f.startedCampaigns > 0,
    },
  ];
}

// ---------------------------------------------------------------------------
// In-app banner
// ---------------------------------------------------------------------------

export type Banner = { tone: "info" | "warning" | "danger"; message: string; cta: string };

const FAILED_PAYMENT = new Set(["past_due", "unpaid", "incomplete", "incomplete_expired"]);

/** The one billing banner to show at the top of the app, or null. */
export function billingBanner(s: BillingStatus, now = new Date()): Banner | null {
  if (s.plan === "expired") {
    if (s.subscription_status && FAILED_PAYMENT.has(s.subscription_status)) {
      return { tone: "danger", message: "Your last payment didn't go through, so sending is paused. Update your card to carry on.", cta: "Update payment" };
    }
    return { tone: "danger", message: "Your plan has ended, so sending is paused. Your data is safe: choose a plan to carry on.", cta: "Choose a plan" };
  }
  if (s.plan !== "trial") return null;
  if (s.block === "trial_ended") return { tone: "danger", message: "Your free trial has ended, so sending is paused. Choose a plan to keep going.", cta: "Choose a plan" };
  if (s.block === "trial_limit") return { tone: "danger", message: `You've used all ${s.trial_email_limit} trial emails. Choose a plan to keep sending.`, cta: "Choose a plan" };
  const used = s.trial_emails_used ?? 0;
  if (s.trial_email_limit > 0 && used >= s.trial_email_limit * 0.8) {
    return { tone: "warning", message: `You've used ${used} of your ${s.trial_email_limit} trial emails.`, cta: "Choose a plan" };
  }
  const days = trialDaysLeft(s.trial_ends_at, now);
  if (days <= 2) return { tone: "warning", message: days <= 1 ? "Your free trial ends in less than a day." : "2 days left in your free trial.", cta: "Choose a plan" };
  return null;
}

// ---------------------------------------------------------------------------
// Reminder emails
// ---------------------------------------------------------------------------

export const NOTICE_KINDS = ["trial_ending", "trial_ended", "trial_limit", "payment_failed", "plan_ended"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export type NoticeOrg = {
  id: string;
  name: string;
  plan: string;
  trial_ends_at: string;
  subscription_status: string | null;
  current_period_end: string | null;
  block: string | null;
};

/**
 * Which reminder (if any) a workspace is due, with a key that makes it
 * once-only per occurrence. Old occurrences (over a week) are left alone so
 * a first deploy doesn't email every past trial.
 */
export function dueNotice(o: NoticeOrg, now = new Date()): { kind: NoticeKind; key: string } | null {
  const week = 7 * 864e5;
  const trialEnd = new Date(o.trial_ends_at);
  if (o.plan === "trial") {
    if (o.block === "trial_limit") return { kind: "trial_limit", key: o.trial_ends_at.slice(0, 10) };
    const left = trialEnd.getTime() - now.getTime();
    if (left <= 0) return -left < week ? { kind: "trial_ended", key: o.trial_ends_at.slice(0, 10) } : null;
    if (left <= 2 * 864e5) return { kind: "trial_ending", key: o.trial_ends_at.slice(0, 10) };
    return null;
  }
  if (o.plan === "expired") {
    const failed = !!o.subscription_status && FAILED_PAYMENT.has(o.subscription_status);
    const key = (o.current_period_end ?? o.trial_ends_at).slice(0, 10);
    if (failed) return { kind: "payment_failed", key };
    if (o.subscription_status) return { kind: "plan_ended", key };
    // A trial that ran out before plans existed / was expired by hand.
    return now.getTime() - trialEnd.getTime() < week ? { kind: "trial_ended", key: o.trial_ends_at.slice(0, 10) } : null;
  }
  return null;
}

export type NoticeEmail = { subject: string; text: string };

export function noticeEmail(kind: NoticeKind, ctx: { workspace: string; billingUrl: string; firstName?: string | null }): NoticeEmail {
  const hi = `Hi${ctx.firstName ? ` ${ctx.firstName}` : ""},`;
  const sign = "Thanks,\nThe YCAReach team";
  const body = (subject: string, lines: string[]): NoticeEmail => ({ subject, text: [hi, "", ...lines, "", sign].join("\n") });
  switch (kind) {
    case "trial_ending":
      return body("Your YCAReach trial ends in 2 days", [
        `Your free trial for ${ctx.workspace} ends in 2 days. When it does, your campaigns pause (nothing is deleted).`,
        "",
        "To keep sending without a break, choose a plan here:",
        ctx.billingUrl,
        "",
        "Standard is £20/month. Pro (£25/month) adds the AI that writes your emails and drafts your replies.",
      ]);
    case "trial_ended":
      return body("Your YCAReach trial has ended", [
        `Your free trial for ${ctx.workspace} has ended, so sending is paused. Your leads, campaigns and replies are all still there.`,
        "",
        "Pick a plan and everything carries on where it left off:",
        ctx.billingUrl,
      ]);
    case "trial_limit":
      return body("You've used all your trial emails", [
        `${ctx.workspace} has sent all of its free trial emails, so sending is paused. Nothing is deleted.`,
        "",
        "Choose a plan to keep your campaigns going:",
        ctx.billingUrl,
      ]);
    case "payment_failed":
      return body("Your YCAReach payment didn't go through", [
        `We couldn't take the payment for ${ctx.workspace}, so sending is paused. Your data is safe.`,
        "",
        "Update your card here and sending starts again straight away:",
        ctx.billingUrl,
      ]);
    case "plan_ended":
      return body("Your YCAReach plan has ended", [
        `The plan for ${ctx.workspace} has ended, so sending is paused. Your leads, campaigns and replies are kept.`,
        "",
        "You can pick a plan again at any time:",
        ctx.billingUrl,
      ]);
  }
}
