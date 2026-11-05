"use server";

import { can } from "@crm/core";
import type { BillingInterval, PaidPlan } from "@crm/core/billing";
import { getOrgContext } from "@/lib/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCheckoutUrl, createPortalUrl, createSwitchPlanUrl, priceIdFor } from "@/lib/billing";

export type BillingResult = { url?: string; error?: string };

/** Stripe's own explanation (e.g. "No such price"), so setup problems are visible. Never contains the secret key. */
function reason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/sk_(test|live)_[A-Za-z0-9*]+/g, "sk_…").slice(0, 300);
}

async function billingContext() {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "org.update")) return { ctx: null, error: "Only the workspace owner or an admin can manage billing." } as const;
  const { data: org } = await createAdminClient()
    .from("organizations")
    .select("plan, stripe_customer_id, stripe_subscription_id, subscription_status")
    .eq("id", ctx.org.id)
    .single();
  return { ctx, org } as const;
}

/** Stripe-hosted checkout for a plan; the browser then goes to the returned URL. */
export async function startCheckout(plan: PaidPlan, interval: BillingInterval): Promise<BillingResult> {
  if (!["standard", "pro"].includes(plan) || !["month", "year"].includes(interval)) return { error: "Unknown plan." };
  const b = await billingContext();
  if (!b.ctx) return { error: b.error };
  try {
    // Already subscribed: switch the existing subscription (Stripe's confirm screen), never a second one.
    if (b.org?.stripe_customer_id && b.org.stripe_subscription_id && ["active", "trialing", "past_due"].includes(b.org.subscription_status ?? "")) {
      const price = priceIdFor(plan, interval);
      if (!price) throw new Error(`No Stripe price configured for ${plan} (${interval}ly)`);
      return { url: await createSwitchPlanUrl(b.org.stripe_customer_id, b.org.stripe_subscription_id, price) };
    }
    return { url: await createCheckoutUrl({ orgId: b.ctx.org.id, email: b.ctx.user.email, customerId: b.org?.stripe_customer_id ?? null, plan, interval }) };
  } catch (e) {
    console.error("checkout failed", e);
    return { error: `Couldn't open checkout: ${reason(e)}` };
  }
}

/** Stripe's billing portal: switch plan, update card, download invoices, cancel. */
export async function openBillingPortal(): Promise<BillingResult> {
  const b = await billingContext();
  if (!b.ctx) return { error: b.error };
  if (!b.org?.stripe_customer_id) return { error: "No subscription yet. Choose a plan first." };
  try {
    return { url: await createPortalUrl(b.org.stripe_customer_id) };
  } catch (e) {
    console.error("portal failed", e);
    return { error: `Couldn't open the billing portal: ${reason(e)}` };
  }
}
