import { can } from "@crm/core";
import { blockMessage, trialDaysLeft } from "@crm/core/billing";
import { getOrgContext } from "@/lib/org";
import { getBillingStatus, stripeConfigured } from "@/lib/billing";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PlanPicker } from "./plan-picker";
import { formatDay, plural } from "@/lib/format";
import { UsageBar } from "@/components/usage-bar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const { org, role } = await getOrgContext();
  const status = await getBillingStatus(org.id);
  const canManage = can(role, "org.update");
  const subscribed = !!status.has_customer && ["active", "trialing", "past_due"].includes(status.subscription_status ?? "");
  const block = blockMessage(status.block);

  const planName = status.plan === "trial" ? "Free trial" : status.plan === "pro" ? "Pro" : status.plan === "standard" ? "Standard" : "No plan";
  let summary: string;
  if (status.plan === "trial") {
    const days = trialDaysLeft(status.trial_ends_at);
    summary = `${plural(days, "day")} left and ${status.trial_emails_used ?? 0} of ${status.trial_email_limit} emails used. Everything, including the Pro features, is unlocked until the trial ends.`;
  } else if (status.plan === "expired") {
    summary = status.subscription_status === "past_due" ? "Your last payment failed. Update your card to resume sending." : "No active plan. Sending is paused; your data is safe.";
  } else {
    const renew = status.current_period_end ? formatDay(status.current_period_end, org.default_timezone) : null;
    summary = `You're on ${status.plan === "pro" ? "Pro" : "Standard"} (${status.billing_interval === "year" ? "yearly" : "monthly"}).${
      renew ? (status.cancel_at_period_end ? ` Ends on ${renew}.` : ` Renews on ${renew}.`) : ""
    }`;
  }

  return (
    <>
      <PageHeader title="Billing" description="Your plan, and what each plan includes." />
      <div className="grid gap-6">
        <Card data-testid="plan-summary">
          <CardHeader>
            <CardDescription>Your plan</CardDescription>
            <CardTitle className="text-section-title flex flex-wrap items-center gap-2">
              {planName}
              <Badge variant={status.block ? "danger" : status.plan === "trial" ? "warning" : "success"}>
                {status.block ? "Sending paused" : status.plan === "trial" ? `${plural(trialDaysLeft(status.trial_ends_at), "day")} left` : "Active"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-muted-foreground max-w-2xl text-sm">{summary}</p>
            {status.plan === "trial" && (
              <UsageBar used={status.trial_emails_used ?? 0} cap={status.trial_email_limit ?? 0} className="max-w-xs" label="Trial emails used" />
            )}
          </CardContent>
        </Card>
        {block && (
          <Alert variant="destructive">
            <AlertDescription>{block}</AlertDescription>
          </Alert>
        )}
        {!stripeConfigured() && (
          <Alert>
            <AlertDescription>Payments aren&apos;t switched on yet, so plans can&apos;t be changed here. (Site owner: STRIPE_SECRET_KEY is missing.)</AlertDescription>
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
