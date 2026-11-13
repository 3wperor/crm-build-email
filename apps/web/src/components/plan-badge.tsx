import Link from "next/link";
import { trialDaysLeft, type BillingStatus } from "@crm/core/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
        <Badge variant="destructive" className="hidden sm:inline-flex">
          {status.plan === "trial" ? "Trial over · sending paused" : "Sending paused · no plan"}
        </Badge>
        {choose}
      </div>
    );
  }
  if (status.plan === "trial") {
    const days = trialDaysLeft(status.trial_ends_at);
    const used = status.trial_emails_used ?? 0;
    const limit = status.trial_email_limit ?? 0;
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    // Calm and on-brand while there's time; amber only when it's nearly over.
    const ending = days <= 2 || pct >= 90;
    return (
      <Link
        href="/billing"
        data-testid="trial-badge"
        className="group bg-background hover:bg-accent/60 focus-visible:ring-ring/50 flex h-8 items-center gap-2.5 rounded-full border pr-1 pl-3 text-sm max-[359px]:gap-0 max-[359px]:pl-1 whitespace-nowrap outline-none focus-visible:ring-[3px]"
      >
        <span className="flex items-center gap-2">
          <span className="font-medium max-[359px]:hidden">
            <span className="hidden sm:inline">Free trial · </span>
            <span className={cn(ending && "text-warning")}>
              {days} day{days === 1 ? "" : "s"} left
            </span>
          </span>
          <span className="text-muted-foreground hidden items-center gap-2 lg:flex">
            <span
              role="progressbar"
              aria-label="Trial emails used"
              aria-valuenow={used}
              aria-valuemin={0}
              aria-valuemax={limit}
              className="bg-muted block h-1.5 w-12 overflow-hidden rounded-full"
            >
              <span className={cn("block h-full rounded-full", ending ? "bg-warning" : "bg-primary")} style={{ width: `${Math.max(pct, 4)}%` }} />
            </span>
            <span className="text-caption tabular-nums">
              {used}/{limit} emails
            </span>
          </span>
        </span>
        <span className="bg-primary text-primary-foreground group-hover:bg-primary/90 text-caption flex h-6 items-center rounded-full px-2.5 font-medium">
          <span className="sm:hidden">Upgrade</span>
          <span className="hidden sm:inline">Choose a plan</span>
        </span>
      </Link>
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
