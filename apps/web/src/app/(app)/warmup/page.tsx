import Link from "next/link";
import { can, formatPct, warmupDay, warmupHealth, warmupQuota, zonedParts } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { PlacementChart } from "@/components/charts/placement-chart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toggleWarmup } from "./actions";
import { WarmupSettingsForm } from "./settings-form";

export const metadata = { title: "Warmup" };

function PlacementBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground text-xs">No data yet</span>;
  if (score >= 90) return <Badge variant="success">✓ Good · {score}</Badge>;
  if (score >= 80) return <Badge variant="warning">! Watch · {score}</Badge>;
  return <Badge variant="destructive">✕ Poor · {score}</Badge>;
}

export default async function WarmupPage() {
  const { org, role } = await getOrgContext();
  const canManage = can(role, "sending_accounts.manage");
  const supabase = await createClient();
  const now = new Date();

  const [{ data: accounts }, { data: stats }, { data: daily }] = await Promise.all([
    supabase
      .from("sending_accounts")
      .select(
        "id, email, display_name, status, health, daily_cap, timezone, updated_at, warmup_enabled, warmup_started_at, warmup_daily_target, warmup_ramp_step, warmup_reply_rate, warmup_paused_reason",
      )
      .eq("org_id", org.id)
      .order("email"),
    supabase.rpc("warmup_stats", { p_org_id: org.id, p_days: 7 }),
    supabase.rpc("warmup_daily", { p_org_id: org.id, p_tz: org.default_timezone, p_days: 14 }),
  ]);
  const statsBy = new Map((stats ?? []).map((s) => [s.account_id, s]));
  const list = accounts ?? [];
  const active = list.filter((a) => a.warmup_enabled && !a.warmup_paused_reason && a.status === "active");
  const sum = (k: "received" | "spam" | "replies_sent" | "sent_today") => list.reduce((n, a) => n + Number(statsBy.get(a.id)?.[k] ?? 0), 0);
  const received = sum("received");
  const spam = sum("spam");
  const points = (daily ?? []).map((d) => ({ day: d.day, inbox: Number(d.inbox), spam: Number(d.spam) }));

  return (
    <>
      <PageHeader
        title="Warmup"
        description="Your own inboxes email each other on a slow ramp, open and reply to each other's mail, and rescue it from spam, so providers learn to trust them."
      />
      <Alert className="mb-6">
        <AlertDescription>
          <span>
            <Badge variant="warning" className="mr-2">
              Beta
            </Badge>
            The pool is your workspace&apos;s own inboxes only (at least two). Warmup mail is tagged, never shows up in Replies or Analytics, follows the
            kill switch, and counts toward each inbox&apos;s daily cap. An inbox pauses itself if more than 20% of its warmup mail lands in spam or two
            bounce.
          </span>
        </AlertDescription>
      </Alert>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="warmup-kpis">
        <Kpi label="Inbox placement" value={formatPct(received ? (received - spam) / received : null, 0)} sub={`last 7 days · ${received} received`} />
        <Kpi label="Rescued from spam" value={String(spam)} sub="last 7 days" />
        <Kpi label="Sent today" value={String(sum("sent_today"))} sub={`${active.length} inbox${active.length === 1 ? "" : "es"} warming`} />
        <Kpi label="Replies" value={String(sum("replies_sent"))} sub="last 7 days" />
      </div>

      {list.length < 2 && (
        <Alert className="mb-6">
          <AlertDescription>
            <span>
              Warmup needs at least two inboxes. <Link href="/inboxes/new" className="underline">Connect another inbox</Link>.
            </span>
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Where warmup mail landed</CardTitle>
          <CardDescription>Warmup emails received by your inboxes per day, last 14 days.</CardDescription>
        </CardHeader>
        <CardContent>
          <PlacementChart days={points} />
          <details className="mt-3">
            <summary className="text-muted-foreground cursor-pointer text-sm">Show as a table</summary>
            <Table data-testid="placement-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Inbox</TableHead>
                  <TableHead className="text-right">Spam</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...(daily ?? [])].reverse().map((d) => (
                  <TableRow key={d.day}>
                    <TableCell>{d.day}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.sent}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.inbox}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.spam}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Table data-testid="warmup-inboxes">
            <TableHeader>
              <TableRow>
                <TableHead>Inbox</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Today</TableHead>
                <TableHead>Placement (7 days)</TableHead>
                <TableHead className="text-right">Replies</TableHead>
                {canManage && <TableHead className="sr-only">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((a) => {
                const s = statsBy.get(a.id);
                const tz = a.timezone ?? org.default_timezone;
                const day = a.warmup_started_at ? warmupDay(new Date(a.warmup_started_at), now, tz) : 1;
                const quota = warmupQuota({
                  day,
                  weekday: zonedParts(now, tz).weekday,
                  target: a.warmup_daily_target,
                  rampStep: a.warmup_ramp_step,
                  dailyCap: a.daily_cap,
                });
                const h = warmupHealth({ received: Number(s?.received ?? 0), spam: Number(s?.spam ?? 0), bounced: Number(s?.bounced ?? 0) });
                let status: React.ReactNode;
                if (!a.warmup_enabled) status = <Badge variant="outline">Off</Badge>;
                else if (a.warmup_paused_reason)
                  status = (
                    <>
                      <Badge variant="warning">⚠ Paused</Badge>
                      <div className="text-muted-foreground mt-1 max-w-64 text-xs whitespace-normal">{a.warmup_paused_reason}. Turn warmup back on to restart the ramp.</div>
                    </>
                  );
                else if (a.status !== "active") status = <Badge variant="outline">Inbox {a.status}</Badge>;
                else if (active.length < 2) status = <Badge variant="outline">Waiting for a second inbox</Badge>;
                else status = <Badge variant="success">Warming · day {day}</Badge>;
                return (
                  <TableRow key={a.id} data-testid={`warmup-row-${a.email}`} className="align-top">
                    <TableCell>
                      <Link href={`/inboxes/${a.id}`} className="font-medium hover:underline">
                        {a.email}
                      </Link>
                      {canManage && a.warmup_enabled && (
                        <details>
                          <summary className="text-muted-foreground cursor-pointer text-xs">Settings</summary>
                          <WarmupSettingsForm
                            accountId={a.id}
                            email={a.email}
                            target={a.warmup_daily_target}
                            rampStep={a.warmup_ramp_step}
                            replyRate={a.warmup_reply_rate}
                            dailyCap={a.daily_cap}
                            updatedAt={a.updated_at}
                          />
                        </details>
                      )}
                    </TableCell>
                    <TableCell>{status}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.warmup_enabled ? (
                        <>
                          {Number(s?.created_today ?? 0)} / {quota}
                          <div className="text-muted-foreground text-xs">target {a.warmup_daily_target}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <PlacementBadge score={h.score} />
                      {Number(s?.received ?? 0) > 0 && (
                        <div className="text-muted-foreground mt-1 text-xs">
                          {Number(s?.spam ?? 0)} of {Number(s?.received ?? 0)} in spam
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number(s?.replies_sent ?? 0)}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <form action={toggleWarmup}>
                          <input type="hidden" name="account_id" value={a.id} />
                          <input type="hidden" name="enable" value={String(!a.warmup_enabled || !!a.warmup_paused_reason)} />
                          <Button size="sm" variant={a.warmup_enabled && !a.warmup_paused_reason ? "outline" : "default"}>
                            {!a.warmup_enabled ? "Start warmup" : a.warmup_paused_reason ? "Restart warmup" : "Stop warmup"}
                          </Button>
                        </form>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums" data-testid={`warmup-kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {value}
        </CardTitle>
        <p className="text-muted-foreground text-xs">{sub}</p>
      </CardHeader>
    </Card>
  );
}
