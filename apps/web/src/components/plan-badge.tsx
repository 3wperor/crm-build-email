import Link from "next/link";
import { trialDaysLeft, type BillingStatus } from "@crm/core/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Header: trial countdown + meter, paused warning, or an Upgrade-to-Pro nudge. */
export function PlanBadge({ status }: { status: BillingStatus }) {
  const choose = (
    <Button asChild size="sm">
      <Link href="/billing">Choose a plan</Link>
    </Button>
  );
  if (status.block) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="destructive">{status.plan === "trial" ? "Trial over · sending paused" : "Sending paused · no plan"}</Badge>
        {choose}
      </div>
    );
  }
  if (status.plan === "trial") {
    const days = trialDaysLeft(status.trial_ends_at);
    return (
      <div className="flex items-center gap-2" data-testid="trial-badge">
        <Badge variant="warning">
          Free trial · {days} day{days === 1 ? "" : "s"} left · {status.trial_emails_used ?? 0}/{status.trial_email_limit} emails
        </Badge>
        {choose}
      </div>
    );
  }
  if (status.plan === "standard") {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href="/billing">Upgrade to Pro</Link>
      </Button>
    );
  }
  return null;
}
