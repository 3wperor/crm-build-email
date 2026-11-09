import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { onboardingChecklist, type EmailProviderAnswer } from "@crm/core/onboarding";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dismissChecklist } from "./actions";

/** Dashboard "Get started" checklist. Each step ticks itself off from real data. */
export async function GettingStarted({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const [{ data: org }, inboxes, leads, written, tests, started, { data: first }] = await Promise.all([
    supabase
      .from("organizations")
      .select("physical_address, onboarding_has_list, onboarding_provider, onboarding_answered_at, checklist_dismissed_at")
      .eq("id", orgId)
      .single(),
    supabase.from("sending_accounts").select("id", head).eq("org_id", orgId),
    supabase.from("leads").select("id", head).eq("org_id", orgId),
    supabase.from("email_variants").select("id", head).eq("org_id", orgId).neq("body", ""),
    supabase.from("test_sends").select("id", head).eq("org_id", orgId).eq("status", "sent"),
    supabase.from("campaigns").select("id", head).eq("org_id", orgId).neq("status", "draft"),
    supabase.from("campaigns").select("id").eq("org_id", orgId).order("created_at").limit(1).maybeSingle(),
  ]);
  if (!org || org.checklist_dismissed_at) return null;

  const items = onboardingChecklist({
    inboxes: inboxes.count ?? 0,
    hasAddress: !!org.physical_address?.trim(),
    leads: leads.count ?? 0,
    writtenCampaigns: written.count ?? 0,
    testsSent: tests.count ?? 0,
    startedCampaigns: started.count ?? 0,
    hasList: org.onboarding_has_list,
    provider: org.onboarding_provider as EmailProviderAnswer | null,
    firstCampaignId: first?.id ?? null,
  });
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  const next = items.find((i) => !i.done);

  return (
    <Card className="mb-6" data-testid="getting-started">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle className="text-base">Get started: send your first campaign</CardTitle>
          <CardDescription>
            {done} of {items.length} done. Most people finish in about 15 minutes.
          </CardDescription>
        </div>
        <form action={dismissChecklist}>
          <Button size="sm" variant="ghost">
            Hide
          </Button>
        </form>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="bg-muted h-2 overflow-hidden rounded-full" aria-hidden>
          <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
        {!org.onboarding_answered_at && (
          <p className="text-sm">
            <Link href="/welcome" className="underline">
              Answer 4 quick questions
            </Link>{" "}
            and we&apos;ll pre-fill your first campaign.
          </p>
        )}
        <ol className="grid gap-2">
          {items.map((item) => {
            const isNext = item.id === next?.id;
            return (
              <li key={item.id} className={cn("flex items-start gap-3 rounded-md p-2", isNext && "bg-primary/5 border-primary/30 border")}>
                {item.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : <Circle className="text-muted-foreground mt-0.5 size-5 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm font-medium", item.done && "text-muted-foreground line-through")}>{item.title}</div>
                  {!item.done && <div className="text-muted-foreground text-xs">{item.hint}</div>}
                </div>
                {!item.done && (
                  <Button asChild size="sm" variant={isNext ? "default" : "outline"}>
                    <Link href={item.href}>{item.cta}</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
