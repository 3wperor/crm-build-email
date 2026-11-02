import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { blockMessage, hasProAccess, planForPrice, subscriptionIdFromEvent, summarizeSubscription, trialDaysLeft, verifyStripeSignature, type PriceMap } from "./billing";

const SECRET = "whsec_test_secret";
const sign = (body: string, t: number, secret = SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("verifyStripeSignature", () => {
  const body = '{"id":"evt_1","type":"checkout.session.completed"}';
  const now = 1_800_000_000;
  it("accepts a valid, fresh signature (also among several v1 values)", () => {
    expect(verifyStripeSignature(body, sign(body, now), SECRET, now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${now},v1=deadbeef,${sign(body, now).split(",")[1]}`, SECRET, now)).toBe(true);
  });
  it("rejects tampering, wrong secret, old timestamps and junk", () => {
    expect(verifyStripeSignature(body + " ", sign(body, now), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now, "whsec_other"), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now - 301), SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, null, SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, "garbage", SECRET, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now), "", now)).toBe(false);
  });
});

describe("plans", () => {
  const prices: PriceMap = { standard: { month: "price_sm", year: "price_sy" }, pro: { month: "price_pm", year: undefined } };
  it("maps our price ids only", () => {
    expect(planForPrice("price_sy", prices)).toEqual({ plan: "standard", interval: "year" });
    expect(planForPrice("price_pm", prices)).toEqual({ plan: "pro", interval: "month" });
    expect(planForPrice("price_other", prices)).toBeNull();
    expect(planForPrice(undefined, prices)).toBeNull();
  });
  it("gives Pro features to Pro and to a running trial", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    expect(hasProAccess({ plan: "pro", trial_ends_at: "2000-01-01" }, now)).toBe(true);
    expect(hasProAccess({ plan: "trial", trial_ends_at: "2026-11-05T00:00:00Z" }, now)).toBe(true);
    expect(hasProAccess({ plan: "trial", trial_ends_at: "2026-11-01T00:00:00Z" }, now)).toBe(false);
    expect(hasProAccess({ plan: "standard", trial_ends_at: "2026-11-05T00:00:00Z" }, now)).toBe(false);
    expect(trialDaysLeft("2026-11-05T00:00:00Z", now)).toBe(3);
    expect(trialDaysLeft("2026-11-01T00:00:00Z", now)).toBe(0);
  });
  it("explains every block", () => {
    expect(blockMessage(null)).toBeNull();
    expect(blockMessage("trial_limit")).toContain("200 trial emails");
    expect(blockMessage("plan_expired")).toBe("Upgrade to start sending campaigns.");
  });
});

describe("Stripe objects", () => {
  it("summarizes a subscription (period end on the item in newer API versions)", () => {
    expect(
      summarizeSubscription({
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        metadata: { org_id: "org-1" },
        items: { data: [{ price: { id: "price_pm" }, current_period_end: 1_800_000_000 }] },
      }),
    ).toEqual({ subscriptionId: "sub_1", status: "active", customerId: "cus_1", orgId: "org-1", priceId: "price_pm", periodEnd: "2027-01-15T08:00:00.000Z", cancelAtPeriodEnd: false });
  });
  it("finds the subscription behind each relevant event", () => {
    expect(subscriptionIdFromEvent({ type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_1" } } })).toBe("sub_1");
    expect(subscriptionIdFromEvent({ type: "checkout.session.completed", data: { object: { mode: "payment" } } })).toBeNull();
    expect(subscriptionIdFromEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_2" } } })).toBe("sub_2");
    expect(subscriptionIdFromEvent({ type: "invoice.payment_failed", data: { object: { parent: { subscription_details: { subscription: "sub_3" } } } } })).toBe("sub_3");
    expect(subscriptionIdFromEvent({ type: "invoice.paid", data: { object: { subscription: "sub_4" } } })).toBe("sub_4");
    expect(subscriptionIdFromEvent({ type: "charge.refunded", data: { object: {} } })).toBeNull();
  });
});
