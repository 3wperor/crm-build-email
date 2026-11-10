import Link from "next/link";
import { Target } from "lucide-react";
import { gbp, goalProgress } from "@crm/core/growth";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** "1 of 3 new customers this month": counts leads moved to a Won stage this calendar month. */
export async function GoalTracker({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("goal_customers_per_month, goal_customer_value").eq("id", orgId).single();
  const goal = org?.goal_customers_per_month;
  if (!goal) return null;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await supabase
    .from("opportunities")
    .select("id, pipeline_stages!inner(kind)", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("pipeline_stages.kind", "won")
    .gte("moved_at", monthStart);
  const p = goalProgress(goal, count ?? 0, org.goal_customer_value);
  const month = now.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

  return (
    <Card className="mb-6" data-testid="goal-tracker">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="size-4" /> {p.reached ? "Goal reached this month" : `${p.won} of ${p.goal} new customer${p.goal === 1 ? "" : "s"} in ${month}`}
          </CardTitle>
          <CardDescription>
            {p.valueWon ? `About ${gbp(p.valueWon)} won so far. ` : ""}
            Move a lead to <strong>Won</strong> in the{" "}
            <Link href="/pipeline" className="underline">
              Pipeline
            </Link>{" "}
            when they become a customer.
          </CardDescription>
        </div>
        <Link href="/settings#goal" className="text-muted-foreground text-xs underline">
          Change goal
        </Link>
      </CardHeader>
      <CardContent>
        <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
          <div className={p.reached ? "h-full rounded-full bg-emerald-600" : "bg-primary h-full rounded-full"} style={{ width: `${Math.max(p.pct, 2)}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}
