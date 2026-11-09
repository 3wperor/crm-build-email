import { describe, expect, it } from "vitest";
import type { BillingStatus } from "./billing";
import { billingBanner, dueNotice, noticeEmail, onboardingChecklist, welcomeAnswersSchema, type NoticeOrg } from "./onboarding";

const NOW = new Date("2026-11-09T12:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 864e5).toISOString();

describe("welcome answers", () => {
  it("accepts partial answers and blanks", () => {
    expect(welcomeAnswersSchema.parse({ offer: " Websites for dentists ", audience: "", provider: "gmail", hasList: "no" })).toEqual({
      offer: "Websites for dentists",
      audience: null,
      provider: "gmail",
      hasList: false,
    });
    expect(welcomeAnswersSchema.parse({})).toEqual({ offer: null, audience: null, provider: null, hasList: null });
  });
  it("rejects unknown providers", () => {
    expect(welcomeAnswersSchema.safeParse({ provider: "yahoo" }).success).toBe(false);
  });
});

describe("checklist", () => {
  const none = { inboxes: 0, hasAddress: false, leads: 0, writtenCampaigns: 0, testsSent: 0, startedCampaigns: 0 };
  it("starts with nothing done, in order", () => {
    const items = onboardingChecklist(none);
    expect(items.map((i) => i.id)).toEqual(["inbox", "address", "leads", "write", "test", "start"]);
    expect(items.every((i) => !i.done)).toBe(true);
  });
  it("ticks steps from real data and links to the first campaign", () => {
    const items = onboardingChecklist({ ...none, inboxes: 1, leads: 30, writtenCampaigns: 1, firstCampaignId: "c1" });
    expect(items.filter((i) => i.done).map((i) => i.id)).toEqual(["inbox", "leads", "write"]);
    expect(items.find((i) => i.id === "test")!.href).toBe("/campaigns/c1?tab=sequence");
  });
  it("tailors hints to the welcome answers", () => {
    expect(onboardingChecklist({ ...none, provider: "outlook" })[0]!.hint).toMatch(/isn't supported yet/);
    expect(onboardingChecklist({ ...none, hasList: false })[2]!.hint).toMatch(/No list yet/);
  });
});

const status = (over: Partial<BillingStatus>): BillingStatus => ({
  plan: "trial",
  block: null,
  trial_ends_at: inDays(5),
  trial_email_limit: 200,
  trial_emails_used: 10,
  billing_interval: null,
  subscription_status: null,
  current_period_end: null,
  cancel_at_period_end: false,
  has_customer: false,
  ...over,
});

describe("billing banner", () => {
  it("stays quiet early in the trial and on paid plans", () => {
    expect(billingBanner(status({}), NOW)).toBeNull();
    expect(billingBanner(status({ plan: "pro" }), NOW)).toBeNull();
  });
  it("counts down the last two days", () => {
    expect(billingBanner(status({ trial_ends_at: inDays(1.5) }), NOW)?.message).toBe("2 days left in your free trial.");
    expect(billingBanner(status({ trial_ends_at: inDays(0.4) }), NOW)?.message).toBe("Your free trial ends in less than a day.");
  });
  it("warns at 80% of trial emails", () => {
    expect(billingBanner(status({ trial_emails_used: 160 }), NOW)?.message).toBe("You've used 160 of your 200 trial emails.");
  });
  it("explains why sending stopped", () => {
    expect(billingBanner(status({ block: "trial_ended" }), NOW)?.tone).toBe("danger");
    expect(billingBanner(status({ block: "trial_limit" }), NOW)?.message).toMatch(/all 200 trial emails/);
    expect(billingBanner(status({ plan: "expired", subscription_status: "past_due" }), NOW)?.cta).toBe("Update payment");
    expect(billingBanner(status({ plan: "expired", subscription_status: "canceled" }), NOW)?.message).toMatch(/plan has ended/);
  });
});

describe("reminder emails", () => {
  const org = (over: Partial<NoticeOrg>): NoticeOrg => ({
    id: "o",
    name: "Acme",
    plan: "trial",
    trial_ends_at: inDays(5),
    subscription_status: null,
    current_period_end: null,
    block: null,
    ...over,
  });
  it("sends nothing early in the trial or on paid plans", () => {
    expect(dueNotice(org({}), NOW)).toBeNull();
    expect(dueNotice(org({ plan: "pro" }), NOW)).toBeNull();
  });
  it("reminds 2 days before the end, once per trial", () => {
    const end = inDays(1.9);
    expect(dueNotice(org({ trial_ends_at: end }), NOW)).toEqual({ kind: "trial_ending", key: end.slice(0, 10) });
  });
  it("says when the trial ended or the allowance ran out", () => {
    expect(dueNotice(org({ trial_ends_at: inDays(-1) }), NOW)?.kind).toBe("trial_ended");
    expect(dueNotice(org({ block: "trial_limit" }), NOW)?.kind).toBe("trial_limit");
  });
  it("leaves trials that ended long ago alone", () => {
    expect(dueNotice(org({ trial_ends_at: inDays(-30) }), NOW)).toBeNull();
    expect(dueNotice(org({ plan: "expired", trial_ends_at: inDays(-30) }), NOW)).toBeNull();
  });
  it("tells paying customers about failed payments and ended plans, keyed by period", () => {
    const p = inDays(-1);
    expect(dueNotice(org({ plan: "expired", subscription_status: "past_due", current_period_end: p }), NOW)).toEqual({ kind: "payment_failed", key: p.slice(0, 10) });
    expect(dueNotice(org({ plan: "expired", subscription_status: "canceled", current_period_end: p }), NOW)?.kind).toBe("plan_ended");
  });
  it("writes a plain email with the billing link", () => {
    const e = noticeEmail("payment_failed", { workspace: "Acme", billingUrl: "https://app.example/billing", firstName: "Sam" });
    expect(e.subject).toMatch(/payment/);
    expect(e.text).toContain("Hi Sam,");
    expect(e.text).toContain("https://app.example/billing");
    expect(e.text).toContain("Acme");
  });
});
