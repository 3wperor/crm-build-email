import Link from "next/link";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, CheckCircle2, Mail, Sparkles } from "lucide-react";
import { effectiveSentToday, extractReplyText } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { GettingStarted } from "@/components/onboarding/getting-started";
import { GoalTracker } from "@/components/onboarding/goal-tracker";
import { StatusBadge } from "@/components/status-badge";
import { Time } from "@/components/time";
import { UsageBar } from "@/components/usage-bar";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, plural } from "@/lib/format";

export const metadata = { title: "Dashboard" };

/** What needs you today: replies to answer, how today's sending is going, and your goal. */
export default async function DashboardPage() {
  const { org } = await getOrgContext();
  const supabase = await createClient();

  const [{ data: waiting, count: waitingCount }, { data: inboxes }, { count: running }] = await Promise.all([
    supabase
      .from("replies")
      .select("id, from_email, subject, body_text, classification, received_at, draft_status, leads(first_name, last_name, company)", { count: "exact" })
      .eq("org_id", org.id)
      .is("handled_at", null)
      .in("classification", ["positive", "neutral"])
      .order("received_at", { ascending: false })
      .limit(5),
    supabase
      .from("sending_accounts")
      .select("id, email, status, daily_cap, sent_today, sent_today_date, timezone")
      .eq("org_id", org.id)
      .eq("status", "active")
      .order("created_at"),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "active"),
  ]);

  const now = new Date();
  const usage = (inboxes ?? []).map((a) => ({ id: a.id, email: a.email, sent: effectiveSentToday(a, now, org.default_timezone), cap: a.daily_cap }));
  const sent = usage.reduce((n, a) => n + a.sent, 0);
  const cap = usage.reduce((n, a) => n + a.cap, 0);
  const total = waitingCount ?? 0;

  return (
    <>
      <PageHeader title="Dashboard" description={`What needs you today at ${org.name}.`} />
      <Suspense fallback={<Skeleton className="mb-6 h-40 w-full" />}>
        <GettingStarted orgId={org.id} />
      </Suspense>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card data-testid="waiting-replies">
          <CardHeader>
            <CardTitle className="text-section-title">{total ? `${plural(total, "reply", "replies")} waiting for an answer` : "Replies"}</CardTitle>
            <CardDescription>{total ? "Newest first. Answering quickly is what turns a reply into a customer." : "People who reply with interest or a question show up here."}</CardDescription>
            {total > 0 && (
              <CardAction>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/replies?c=needs_reply">
                    See all <ArrowRight />
                  </Link>
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {!waiting?.length ? (
              <div className="text-muted-foreground flex items-center gap-2.5 py-2 text-sm">
                <CheckCircle2 className="text-success size-4 shrink-0" /> You&apos;re all caught up. Nothing is waiting for an answer.
              </div>
            ) : (
              <ul className="-mx-2 grid">
                {waiting.map((r) => (
                  <li key={r.id}>
                    <Link href={`/replies/${r.id}`} className="hover:bg-muted/60 focus-visible:ring-ring/50 flex items-start gap-3 rounded-md px-2 py-2.5 outline-none focus-visible:ring-[3px]">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-sm font-medium">{[r.leads?.first_name, r.leads?.last_name].filter(Boolean).join(" ") || r.from_email}</span>
                          {r.leads?.company && <span className="text-muted-foreground text-small truncate">{r.leads.company}</span>}
                          <StatusBadge kind="reply" value={r.classification} />
                          {r.draft_status === "ready" && (
                            <span className="text-primary text-caption inline-flex items-center gap-1 font-medium">
                              <Sparkles className="size-3" /> AI draft ready
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground text-small mt-0.5 line-clamp-1">{extractReplyText(r.body_text ?? "").slice(0, 160) || r.subject || "(no message)"}</p>
                      </div>
                      <Time value={r.received_at} className="text-muted-foreground text-caption shrink-0 pt-0.5 whitespace-nowrap" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card data-testid="sending-today">
            <CardHeader>
              <CardTitle className="text-section-title">Sending today</CardTitle>
              <CardDescription>
                {!usage.length
                  ? "Connect an inbox to start sending."
                  : `${plural(running ?? 0, "campaign")} running · ${formatNumber(sent)} of ${formatNumber(cap)} emails sent today`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!usage.length ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/inboxes/new">
                    <Mail /> Add inbox
                  </Link>
                </Button>
              ) : (
                <ul className="grid gap-3">
                  {usage.map((a) => (
                    <li key={a.id} className="grid gap-1">
                      <Link href={`/inboxes/${a.id}`} className="text-small truncate font-medium hover:underline">
                        {a.email}
                      </Link>
                      <UsageBar used={a.sent} cap={a.cap} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Suspense fallback={<Skeleton className="h-32 w-full" />}>
            <GoalTracker orgId={org.id} />
          </Suspense>
        </div>
      </div>
    </>
  );
}
