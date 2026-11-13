import { subscriptionIdFromEvent, verifyStripeSignature } from "@crm/core/billing";
import { applySubscriptionFromStripe } from "@/lib/billing";

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

  const fallbackOrgId = typeof event.data.object.client_reference_id === "string" ? event.data.object.client_reference_id : null;
  try {
    const sync = await applySubscriptionFromStripe(subscriptionId, { fallbackOrgId });
    if (sync.result !== "applied") {
      const detail = sync.result === "unmapped" ? `org ${sync.orgId}, price ${sync.priceId}` : sync.result;
      console.error(`stripe webhook ${event.id}: cannot map subscription ${subscriptionId} (${detail})`);
      // 200: retrying won't help; the price/org is not ours.
      return Response.json({ received: true, ignored: "unmapped subscription" });
    }
    return Response.json({ received: true, plan: sync.plan });
  } catch (e) {
    console.error(`stripe webhook ${event.id}: ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: "could not apply" }, { status: 500 });
  }
}
