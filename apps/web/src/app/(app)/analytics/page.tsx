import Link from "next/link";
import { ANALYTICS_RANGES, formatPct, parseRange, rate } from "@crm/core/analytics";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_METRICS, loadBreakdown, type BreakdownRow, type Metrics } from "@/lib/analytics";
import { PageHeader } from "@/components/coming-soon";
import { ResponsesChart, SentChart, type DailyPoint } from "@/components/charts/daily-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select-native";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Analytics" };

const UUID = /^[0-9a-f-]{36}$/i;
/** Above this bounce rate, mailbox providers start treating an inbox as a spammer. */
const BOUNCE_WARN = 0.03;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; campaign?: string; inbox?: string }> }) {
  const sp = await searchParams;
  const days = parseRange(sp.range);
  const campaignId = sp.campaign && UUID.test(sp.campaign) ? sp.campaign : null;
  const accountId = sp.inbox && UUID.test(sp.inbox) ? sp.inbox : null;
  const { org } = await getOrgContext();
  const tz = org.default_timezone;
  const supabase = await createClient();
  const scope = { orgId: org.id, tz, days, campaignId, accountId };

  const [{ data: campaigns }, { data: inboxes }, total, byCampaign, byInbox, byVariant, { data: daily, error: dailyError }] = await Promise.all([
    supabase.from("campaigns").select("id, name").eq("org_id", org.id).order("name"),
    supabase.from("sending_accounts").select("id, email").eq("org_id", org.id).order("email"),
    loadBreakdown(supabase, { ...scope, group: "total" }),
    loadBreakdown(supabase, { ...scope, group: "campaign" }),
    loadBreakdown(supabase, { ...scope, group: "inbox" }),
    loadBreakdown(supabase, { ...scope, group: "variant" }),
    supabase.rpc("analytics_daily", {
      p_org_id: org.id,
      p_tz: tz,
      p_days: days,
      ...(campaignId ? { p_campaign_id: campaignId } : {}),
      ...(accountId ? { p_account_id: accountId } : {}),
    }),
  ]);
  if (dailyError) throw new Error(dailyError.message);

  const t: Metrics = total[0] ? toMetrics(total[0]) : EMPTY_METRICS;
  const points: DailyPoint[] = (daily ?? []).map((d) => ({
    day: d.day,
    sent: Number(d.sent),
    replied: Number(d.replied),
    bounced: Number(d.bounced),
    unsubscribed: Number(d.unsubscribed),
  }));
  const hasTracking = t.opened > 0 || t.clicked > 0;

  return (
    <>
      <PageHeader title="Analytics" description={`Emails sent in the last ${days} days and what came back. Days are in ${tz}.`} />

      <form className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filters">
        <div className="grid gap-1.5">
          <Label htmlFor="range">Range</Label>
          <NativeSelect id="range" name="range" defaultValue={String(days)} className="w-36">
            {ANALYTICS_RANGES.map((r) => (
              <option key={r} value={r}>
                Last {r} days
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="campaign">Campaign</Label>
          <NativeSelect id="campaign" name="campaign" defaultValue={campaignId ?? ""} className="w-56">
            <option value="">All campaigns</option>
            {(campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="inbox">Inbox</Label>
          <NativeSelect id="inbox" name="inbox" defaultValue={accountId ?? ""} className="w-56">
            <option value="">All inboxes</option>
            {(inboxes ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.email}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="kpis">
        <Kpi label="Sent" value={t.sent.toLocaleString()} sub={`${(t.sent - t.bounced).toLocaleString()} delivered`} />
        <Kpi label="Reply rate" value={formatPct(rate(t.replied, t.sent))} sub={`${t.replied} replies`} />
        <Kpi label="Positive replies" value={t.positive.toLocaleString()} sub={`${formatPct(rate(t.positive, t.sent))} of sent`} />
        <Kpi
          label="Bounce rate"
          value={formatPct(rate(t.bounced, t.sent))}
          sub={`${t.bounced} bounced`}
          warn={t.sent >= 20 && (rate(t.bounced, t.sent) ?? 0) > BOUNCE_WARN ? "Above 3%: check list quality" : undefined}
        />
        <Kpi label="Unsubscribe rate" value={formatPct(rate(t.unsubscribed, t.sent))} sub={`${t.unsubscribed} unsubscribed`} />
        {hasTracking && (
          <>
            <Kpi label="Open rate" value={formatPct(rate(t.opened, t.sent))} sub="tracked campaigns, bots excluded" />
            <Kpi label="Click rate" value={formatPct(rate(t.clicked, t.sent))} sub={`${t.clicked} clicked`} />
          </>
        )}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sent per day</CardTitle>
          </CardHeader>
          <CardContent>
            <SentChart days={points} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Responses per day</CardTitle>
            <CardDescription>Counted on the day they arrived.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsesChart days={points} />
          </CardContent>
        </Card>
      </div>
      <details className="mb-6">
        <summary className="text-muted-foreground cursor-pointer text-sm">Show daily numbers as a table</summary>
        <Card className="mt-2">
          <CardContent>
            <Table data-testid="daily-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Replies</TableHead>
                  <TableHead className="text-right">Bounces</TableHead>
                  <TableHead className="text-right">Unsubscribes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...points].reverse().map((p) => (
                  <TableRow key={p.day}>
                    <TableCell>{p.day}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.sent}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.replied}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.bounced}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.unsubscribed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </details>

      <p className="text-muted-foreground mb-3 text-xs">
        Rates below count the emails sent in the range and everything that came back from them, whenever it arrived.
      </p>
      <div className="grid gap-6">
        <Breakdown title="By campaign" rows={byCampaign} tracking={hasTracking} href={(r) => (r.key ? `/campaigns/${r.key}?tab=results` : null)} testId="by-campaign" />
        <Breakdown title="By inbox" rows={byInbox} tracking={hasTracking} href={() => null} testId="by-inbox" />
        <Breakdown
          title="By variant"
          rows={byVariant}
          tracking={hasTracking}
          href={() => null}
          testId="by-variant"
          note="Open a campaign's Results tab to compare variants with confidence intervals and promote a winner."
        />
      </div>
    </>
  );
}

function toMetrics(r: BreakdownRow): Metrics {
  return {
    sent: Number(r.sent),
    bounced: Number(r.bounced),
    opened: Number(r.opened),
    clicked: Number(r.clicked),
    replied: Number(r.replied),
    positive: Number(r.positive),
    unsubscribed: Number(r.unsubscribed),
  };
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {value}
        </CardTitle>
        <p className="text-muted-foreground text-xs">{sub}</p>
        {warn && (
          <Badge variant="warning" className="mt-1 w-fit">
            ⚠ {warn}
          </Badge>
        )}
      </CardHeader>
    </Card>
  );
}

function Breakdown({
  title,
  rows,
  tracking,
  href,
  testId,
  note,
}: {
  title: string;
  rows: BreakdownRow[];
  tracking: boolean;
  href: (r: BreakdownRow) => string | null;
  testId: string;
  note?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {note && <CardDescription>{note}</CardDescription>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing sent in this range.</p>
        ) : (
          <Table data-testid={testId}>
            <TableHeader>
              <TableRow>
                <TableHead>{title.replace("By ", "").replace(/^./, (c) => c.toUpperCase())}</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Replied</TableHead>
                <TableHead className="text-right">Positive</TableHead>
                {tracking && <TableHead className="text-right">Opened</TableHead>}
                {tracking && <TableHead className="text-right">Clicked</TableHead>}
                <TableHead className="text-right">Bounced</TableHead>
                <TableHead className="text-right">Unsubscribed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const m = toMetrics(r);
                const link = href(r);
                const bounce = rate(m.bounced, m.sent) ?? 0;
                return (
                  <TableRow key={r.key ?? "none"}>
                    <TableCell>
                      {link ? (
                        <Link href={link} className="font-medium hover:underline">
                          {r.label}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.label}</span>
                      )}
                      {r.sub && <div className="text-muted-foreground text-xs">{r.sub}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.sent}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPct(rate(m.replied, m.sent))} <span className="text-muted-foreground text-xs">({m.replied})</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.positive}</TableCell>
                    {tracking && <TableCell className="text-right tabular-nums">{formatPct(rate(m.opened, m.sent))}</TableCell>}
                    {tracking && <TableCell className="text-right tabular-nums">{formatPct(rate(m.clicked, m.sent))}</TableCell>}
                    <TableCell className="text-right tabular-nums">
                      {formatPct(bounce)}
                      {m.sent >= 20 && bounce > BOUNCE_WARN && (
                        <Badge variant="warning" className="ml-1">
                          ⚠ high
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPct(rate(m.unsubscribed, m.sent))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
