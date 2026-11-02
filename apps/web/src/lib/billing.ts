import "server-only";
import { cache } from "react";
import { blockMessage, priceMapFromEnv, type BillingInterval, type BillingStatus, type PaidPlan } from "@crm/core/billing";
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
