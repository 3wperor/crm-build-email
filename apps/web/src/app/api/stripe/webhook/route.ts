import { planForPrice, priceMapFromEnv, subscriptionIdFromEvent, summarizeSubscription, verifyStripeSignature } from "@crm/core/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeRequest } from "@/lib/billing";

export const dynamic = "force-dynamic";

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

/**
 * Stripe → YCAReach. Every relevant event re-reads the subscription from Stripe
 * and applies its current state, so retries and out-of-order delivery are harmless.
 * Non-2xx makes Stripe retry.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!verifyStripeSignature(raw, request.headers.get("stripe-signature"), secret)) {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }
  const event = JSON.parse(raw) as StripeEvent;
  const subscriptionId = subscriptionIdFromEvent(event);
  if (!subscriptionId) return Response.json({ received: true, ignored: event.type });

  const sub = summarizeSubscription(await stripeRequest("GET", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`));
  const orgId = sub.orgId ?? (typeof event.data.object.client_reference_id === "string" ? event.data.object.client_reference_id : null);
  const mapped = planForPrice(sub.priceId, priceMapFromEnv(process.env));
  if (!orgId || !mapped) {
    console.error(`stripe webhook ${event.id}: cannot map subscription ${sub.subscriptionId} (org ${orgId}, price ${sub.priceId})`);
    // 200: retrying won't help; the price/org is not ours.
    return Response.json({ received: true, ignored: "unmapped subscription" });
  }

  const { data, error } = await createAdminClient().rpc("apply_stripe_subscription", {
    p_org_id: orgId,
    p_customer_id: sub.customerId,
    p_subscription_id: sub.subscriptionId,
    p_status: sub.status,
    p_plan: mapped.plan,
    p_interval: mapped.interval,
    p_period_end: sub.periodEnd as string,
    p_cancel_at_end: sub.cancelAtPeriodEnd,
  });
  if (error) {
    console.error(`stripe webhook ${event.id}: ${error.message}`);
    return Response.json({ error: "could not apply" }, { status: 500 });
  }
  return Response.json({ received: true, plan: data });
}
