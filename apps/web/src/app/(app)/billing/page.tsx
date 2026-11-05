import { can } from "@crm/core";
import { blockMessage, trialDaysLeft } from "@crm/core/billing";
import { getOrgContext } from "@/lib/org";
import { getBillingStatus, stripeConfigured } from "@/lib/billing";
import { PageHeader } from "@/components/coming-soon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PlanPicker } from "./plan-picker";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const { org, role } = await getOrgContext();
  const status = await getBillingStatus(org.id);
  const canManage = can(role, "org.update");
  const subscribed = !!status.has_customer && ["active", "trialing", "past_due"].includes(status.subscription_status ?? "");
  const block = blockMessage(status.block);

  let summary: string;
  if (status.plan === "trial") {
    const days = trialDaysLeft(status.trial_ends_at);
    summary = `Free trial: ${days} day${days === 1 ? "" : "s"} left, ${status.trial_emails_used ?? 0} of ${status.trial_email_limit} emails used. Everything (Pro included) is unlocked until then.`;
  } else if (status.plan === "expired") {
    summary = status.subscription_status === "past_due" ? "Your last payment failed. Update your card to resume sending." : "No active plan. Sending is paused; your data is safe.";
  } else {
    const renew = status.current_period_end ? new Date(status.current_period_end).toLocaleDateString() : null;
    summary = `You're on ${status.plan === "pro" ? "Pro" : "Standard"} (${status.billing_interval === "year" ? "yearly" : "monthly"}).${
      renew ? (status.cancel_at_period_end ? ` Ends on ${renew}.` : ` Renews on ${renew}.`) : ""
    }`;
  }

  return (
    <>
      <PageHeader title="Billing" description={summary} />
      <div className="grid gap-6">
        {block && (
          <Alert variant="destructive">
            <AlertDescription>{block}</AlertDescription>
          </Alert>
        )}
        {!stripeConfigured() && (
          <Alert>
            <AlertDescription>Payments aren&apos;t set up yet (STRIPE_SECRET_KEY is missing).</AlertDescription>
          </Alert>
        )}
        {!canManage && (
          <Alert>
            <AlertDescription>Only the workspace owner or an admin can change the plan.</AlertDescription>
          </Alert>
        )}
        <PlanPicker
          currentPlan={status.plan}
          currentInterval={status.billing_interval}
          canManage={canManage && stripeConfigured()}
          subscribed={subscribed}
        />
      </div>
    </>
  );
}
