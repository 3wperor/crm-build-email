import "server-only";
import { cache } from "react";
import { blockMessage, planForPrice, priceMapFromEnv, summarizeSubscription, type BillingInterval, type BillingStatus, type PaidPlan } from "@crm/core/billing";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";

/** Plan, trial meter and whether sending is blocked, for the current user's workspace (RLS-checked). */
export const getBillingStatus = cache(async (orgId: string): Promise<BillingStatus> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_status", { p_org_id: orgId });
  if (error) throw new Error(error.message);
  return data as unknown as BillingStatus;
});

/** Server-side gate for anything that sends: returns the message to show, or null when allowed. */
export async function sendBlockedMessage(orgId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("billing_status", { p_org_id: orgId });
  if (error) throw new Error(error.message);
  return blockMessage((data as unknown as BillingStatus).block);
}

/** Workspaces whose sending is blocked (planner skips them). */
export async function blockedOrgIds(orgIds: string[]): Promise<Set<string>> {
  const admin = createAdminClient();
  const blocked = new Set<string>();
  for (const id of new Set(orgIds)) {
    const { data } = await admin.rpc("billing_status", { p_org_id: id });
    if ((data as unknown as BillingStatus | null)?.block) blocked.add(id);
  }
  return blocked;
}

// ---------------------------------------------------------------------------
// Stripe REST (no SDK): form-encoded requests with the secret key.
// ---------------------------------------------------------------------------

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

function stripeBase(): string {
  // Local tests can point at a fake Stripe; never in production.
  return (process.env.VERCEL_ENV !== "production" && process.env.STRIPE_API_BASE) || "https://api.stripe.com";
}

export async function stripeRequest<T>(method: "GET" | "POST", path: string, params?: Record<string, string>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetch(`${stripeBase()}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2025-03-31.basil" },
    ...(params ? { body: new URLSearchParams(params).toString() } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
  return json;
}

export function priceIdFor(plan: PaidPlan, interval: BillingInterval): string | null {
  return priceMapFromEnv(process.env)[plan][interval] ?? null;
}

/** Stripe-hosted checkout for a workspace. The org id rides along so the webhook knows whom to activate. */
export async function createCheckoutUrl(args: { orgId: string; email: string; customerId: string | null; plan: PaidPlan; interval: BillingInterval }): Promise<string> {
  const price = priceIdFor(args.plan, args.interval);
  if (!price) throw new Error(`No Stripe price configured for ${args.plan} (${args.interval}ly)`);
  const session = await stripeRequest<{ url: string }>("POST", "/v1/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: args.orgId,
    "metadata[org_id]": args.orgId,
    "subscription_data[metadata][org_id]": args.orgId,
    success_url: `${publicEnv.appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${publicEnv.appUrl}/billing`,
    allow_promotion_codes: "true",
    ...(args.customerId ? { customer: args.customerId } : { customer_email: args.email }),
  });
  return session.url;
}

/** Stripe's billing portal: switch plan, change card, cancel. */
export async function createPortalUrl(customerId: string): Promise<string> {
  const session = await stripeRequest<{ url: string }>("POST", "/v1/billing_portal/sessions", { customer: customerId, return_url: `${publicEnv.appUrl}/billing` });
  return session.url;
}

/**
 * Billing portal opened straight on "confirm switch to <price>" for an existing
 * subscription (instead of the portal's home page). Stripe prorates the change.
 * Needs "Switch plans" enabled in the portal settings with both products.
 */
export async function createSwitchPlanUrl(customerId: string, subscriptionId: string, priceId: string): Promise<string> {
  const sub = await stripeRequest<{ items: { data: { id: string; price: { id: string } }[] } }>("GET", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const item = sub.items.data[0];
  if (!item) throw new Error("Subscription has no items");
  if (item.price.id === priceId) return createPortalUrl(customerId);
  const session = await stripeRequest<{ url: string }>("POST", "/v1/billing_portal/sessions", {
    customer: customerId,
    return_url: `${publicEnv.appUrl}/billing`,
    "flow_data[type]": "subscription_update_confirm",
    "flow_data[subscription_update_confirm][subscription]": subscriptionId,
    "flow_data[subscription_update_confirm][items][0][id]": item.id,
    "flow_data[subscription_update_confirm][items][0][price]": priceId,
    "flow_data[subscription_update_confirm][items][0][quantity]": "1",
    "flow_data[after_completion][type]": "redirect",
    "flow_data[after_completion][redirect][return_url]": `${publicEnv.appUrl}/billing?switched=1`,
  });
  return session.url;
}

// ---------------------------------------------------------------------------
// Stripe → workspace plan. One function, used by the webhook and by the pages
// people land on after paying, so a missed or late webhook can't leave someone
// on the wrong plan.
// ---------------------------------------------------------------------------

export type SubscriptionSync =
  | { result: "applied"; orgId: string; plan: string; changed: boolean }
  /** The subscription's price isn't one of the STRIPE_PRICE_* settings, or it names no workspace. */
  | { result: "unmapped"; orgId: string | null; priceId: string | null; subscriptionId: string }
  /** The subscription belongs to a different workspace than the one asking. */
  | { result: "mismatch" };

/**
 * Reads a subscription fresh from Stripe and applies its current state to the
 * workspace it belongs to. Safe to call any number of times, in any order.
 * `forOrgId` limits it to one workspace (pass it whenever a signed-in person,
 * rather than Stripe, is the reason for the call).
 */
export async function applySubscriptionFromStripe(subscriptionId: string, opts: { forOrgId?: string; fallbackOrgId?: string | null } = {}): Promise<SubscriptionSync> {
  const sub = summarizeSubscription(await stripeRequest("GET", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`));
  const orgId = sub.orgId ?? opts.forOrgId ?? opts.fallbackOrgId ?? null;
  if (opts.forOrgId && orgId !== opts.forOrgId) return { result: "mismatch" };
  const mapped = planForPrice(sub.priceId, priceMapFromEnv(process.env));
  if (!orgId || !mapped) return { result: "unmapped", orgId, priceId: sub.priceId, subscriptionId: sub.subscriptionId };

  const admin = createAdminClient();
  const { data: before } = await admin.from("organizations").select("plan, subscription_status").eq("id", orgId).maybeSingle();
  const { data: outcome, error } = await admin.rpc("apply_stripe_subscription", {
    p_org_id: orgId,
    p_customer_id: sub.customerId,
    p_subscription_id: sub.subscriptionId,
    p_status: sub.status,
    p_plan: mapped.plan,
    p_interval: mapped.interval,
    p_period_end: sub.periodEnd as string,
    p_cancel_at_end: sub.cancelAtPeriodEnd,
  });
  if (error) throw new Error(error.message);
  // Worked out from what Stripe said, not by reading the row again: a second identical read
  // in the same request is answered from the request's cache and would look unchanged.
  const applied = outcome !== "ignored_old_subscription";
  const plan = !applied ? (before?.plan ?? mapped.plan) : ["active", "trialing"].includes(sub.status) ? mapped.plan : "expired";
  return { result: "applied", orgId, plan, changed: applied && (before?.plan !== plan || before?.subscription_status !== sub.status) };
}

/**
 * Brings a workspace's plan in line with Stripe right now (billing page, after
 * checkout). Never throws: Stripe being slow must not break the page.
 */
export async function syncOrgSubscription(orgId: string): Promise<SubscriptionSync | null> {
  if (!stripeConfigured()) return null;
  try {
    const { data: org } = await createAdminClient().from("organizations").select("stripe_subscription_id").eq("id", orgId).maybeSingle();
    if (!org?.stripe_subscription_id) return null;
    return await applySubscriptionFromStripe(org.stripe_subscription_id, { forOrgId: orgId });
  } catch (e) {
    console.error(`subscription sync failed for ${orgId}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Straight after Stripe checkout: activate the plan from the checkout session
 * itself instead of waiting for the webhook. Only for a workspace the caller
 * belongs to (`memberOrgIds`).
 */
export async function syncCheckoutSession(sessionId: string, memberOrgIds: string[]): Promise<SubscriptionSync | null> {
  if (!stripeConfigured() || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return null;
  try {
    const session = await stripeRequest<{ subscription?: string | { id: string } | null; client_reference_id?: string | null; status?: string }>(
      "GET",
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    );
    const orgId = session.client_reference_id;
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (session.status !== "complete" || !orgId || !subscriptionId || !memberOrgIds.includes(orgId)) return null;
    return await applySubscriptionFromStripe(subscriptionId, { forOrgId: orgId });
  } catch (e) {
    console.error("checkout session sync failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
