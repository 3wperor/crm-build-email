/**
 * Plans, trial rules, Stripe price mapping and webhook signature checks.
 * Pure (node:crypto only); the database enforces the same rules when sending.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type Plan = "trial" | "standard" | "pro" | "expired";
export type PaidPlan = "standard" | "pro";
export type BillingInterval = "month" | "year";
/** Why a workspace may not send right now (null = it may). Mirrors private.send_block_reason. */
export type SendBlock = "plan_expired" | "trial_ended" | "trial_limit" | null;

export const TRIAL_DAYS = 7;
export const TRIAL_EMAIL_LIMIT = 200;

export const PRICES_GBP: Record<PaidPlan, Record<BillingInterval, number>> = {
  standard: { month: 20, year: 200 },
  pro: { month: 25, year: 250 },
};

export type BillingStatus = {
  plan: Plan;
  block: SendBlock;
  trial_ends_at: string;
  trial_email_limit: number;
  trial_emails_used: number | null;
  billing_interval: BillingInterval | null;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  has_customer: boolean;
};

export function blockMessage(block: SendBlock): string | null {
  switch (block) {
    case null:
      return null;
    case "trial_ended":
      return "Your free trial has ended. Choose a plan to keep sending.";
    case "trial_limit":
      return "You've used all 200 trial emails. Choose a plan to keep sending.";
    case "plan_expired":
      return "Upgrade to start sending campaigns.";
  }
}

/** Pro features (AI agent, own Anthropic key, Claude writing): Pro plan, or a trial still running. */
export function hasProAccess(s: { plan: Plan; trial_ends_at: string }, now = new Date()): boolean {
  return s.plan === "pro" || (s.plan === "trial" && now < new Date(s.trial_ends_at));
}

export function trialDaysLeft(trialEndsAt: string, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / 864e5));
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

export type PriceMap = Record<PaidPlan, Record<BillingInterval, string | undefined>>;

export function priceMapFromEnv(env: Record<string, string | undefined>): PriceMap {
  return {
    standard: { month: env.STRIPE_PRICE_STANDARD_MONTHLY, year: env.STRIPE_PRICE_STANDARD_YEARLY },
    pro: { month: env.STRIPE_PRICE_PRO_MONTHLY, year: env.STRIPE_PRICE_PRO_YEARLY },
  };
}

/** Which plan/interval a Stripe price id stands for (null = not one of ours). */
export function planForPrice(priceId: string | null | undefined, prices: PriceMap): { plan: PaidPlan; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const plan of ["standard", "pro"] as const) {
    for (const interval of ["month", "year"] as const) {
      if (prices[plan][interval] === priceId) return { plan, interval };
    }
  }
  return null;
}

/**
 * Verifies a Stripe-Signature header (t=…,v1=…) over the raw body with the
 * endpoint's signing secret, rejecting signatures older than `toleranceS`.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowS = Math.floor(Date.now() / 1000), toleranceS = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || sigs.length === 0 || Math.abs(nowS - t) > toleranceS) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return sigs.some((s) => {
    const got = Buffer.from(s);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** The fields we keep from a Stripe subscription object. */
export function summarizeSubscription(sub: {
  id: string;
  status: string;
  customer: string | { id: string };
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] };
}) {
  const item = sub.items?.data?.[0];
  // Newer API versions put the period end on the item instead of the subscription.
  const periodEnd = sub.current_period_end ?? item?.current_period_end;
  return {
    subscriptionId: sub.id,
    status: sub.status,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    orgId: sub.metadata?.org_id ?? null,
    priceId: item?.price?.id ?? null,
    periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
  };
}

/** Webhook events that can change a workspace's plan, and where to find the subscription id. */
export function subscriptionIdFromEvent(event: { type: string; data: { object: Record<string, unknown> } }): string | null {
  const o = event.data.object;
  if (event.type === "checkout.session.completed") return o.mode === "subscription" && typeof o.subscription === "string" ? o.subscription : null;
  if (event.type.startsWith("customer.subscription.")) return typeof o.id === "string" ? o.id : null;
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const sub = o.subscription ?? (o.parent as { subscription_details?: { subscription?: string } } | undefined)?.subscription_details?.subscription;
    return typeof sub === "string" ? sub : null;
  }
  return null;
}
