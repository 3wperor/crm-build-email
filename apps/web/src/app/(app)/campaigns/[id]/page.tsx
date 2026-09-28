import Link from "next/link";
import { notFound } from "next/navigation";
import { can, effectiveSentToday, estimateNextSend, startOfLocalDay, type NextSendEstimate } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { campaignWindow } from "@/lib/scheduler/config";
import { AutoRefresh } from "@/components/auto-refresh";
import { UsageBar } from "@/components/usage-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { deleteCampaign } from "../actions";
import { CampaignStatusBadge } from "../status-badge";
import { EnrollForm } from "./enroll-form";
import { LifecycleButtons } from "./lifecycle-buttons";
import { SequenceEditor } from "./sequence-editor";
import { CampaignSettingsForm } from "./settings-form";
import { ResultsTab } from "./results-tab";

export const metadata = { title: "Campaign" };

const TABS = ["sequence", "results", "leads", "settings", "activity"] as const;
type Tab = (typeof TABS)[number];

function describeNext(n: NextSendEstimate, tz: string): string {
  const fmt = (d: Date) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
  switch (n.kind) {
    case "not_running":
      return "Not running";
    case "sending_now":
      return `Sending now (${n.queued} queued)`;
    case "nothing_due":
      return "Nothing due";
    case "at":
      return n.reason === "quota_tomorrow" ? `${fmt(n.at)} (today's quota used)` : n.reason === "window" ? `${fmt(n.at)} (window opens)` : `${fmt(n.at)}`;
  }
}

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "sequence";
  const { org, role, user } = await getOrgContext();
  const supabase = await createClient();
  const canEdit = can(role, "campaigns.write");

  const { data: c } = await supabase
    .from("campaigns")
    .select(
      "*, sequences(id, sequence_steps(id, step_order, delay_days, delay_hours, email_variants(id, ab_group, subject, body, weight, is_active, is_winner))), campaign_sending_accounts(sending_account_id)",
    )
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  const now = new Date();
  const window = campaignWindow(c);
  const dayStart = startOfLocalDay(now, c.timezone).toISOString();
  const attached = c.campaign_sending_accounts.map((l) => l.sending_account_id);

  const [{ data: orgRow }, { data: inboxes }, { data: claimedToday }, { data: inflight }, { data: nextDue }, { data: statusRows }, { data: lists }] =
    await Promise.all([
      supabase.from("organizations").select("physical_address").eq("id", org.id).single(),
      supabase.from("sending_accounts").select("id, email, display_name, status, health, daily_cap, sent_today, sent_today_date, timezone").eq("org_id", org.id).order("email"),
      supabase.from("sends").select("sending_account_id").eq("campaign_id", id).gte("claimed_at", dayStart),
      supabase.from("sends").select("id", { count: "exact" }).eq("campaign_id", id).in("status", ["scheduled", "sending"]),
      supabase
        .from("campaign_leads")
        .select("next_send_at")
        .eq("campaign_id", id)
        .in("status", ["queued", "active"])
        .not("next_send_at", "is", null)
        .order("next_send_at")
        .limit(1)
        .maybeSingle(),
      supabase.from("campaign_leads").select("status").eq("campaign_id", id),
      supabase.from("lead_lists").select("id, name").eq("org_id", org.id).order("name"),
    ]);

  // Today's quota: campaign limit, bounded by what the attached inboxes can still send.
  const sentToday = claimedToday?.length ?? 0;
  const perInboxToday = new Map<string, number>();
  for (const s of claimedToday ?? []) if (s.sending_account_id) perInboxToday.set(s.sending_account_id, (perInboxToday.get(s.sending_account_id) ?? 0) + 1);
  const inboxRoom = (inboxes ?? [])
    .filter((i) => attached.includes(i.id) && i.status === "active" && i.health !== "failing")
    .reduce(
      (n, i) =>
        n +
        Math.max(0, Math.min(i.daily_cap - effectiveSentToday(i, now, org.default_timezone), c.daily_limit_per_inbox - (perInboxToday.get(i.id) ?? 0))),
      0,
    );
  const remainingToday = Math.max(0, Math.min(c.daily_limit - sentToday, inboxRoom));
  const next = estimateNextSend({
    now,
    active: c.status === "active",
    window,
    inflight: inflight?.length ?? 0,
    earliestDue: nextDue?.next_send_at ? new Date(nextDue.next_send_at) : null,
    remainingToday,
  });

  const statusCounts = new Map<string, number>();
  for (const r of statusRows ?? []) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  const enrolled = statusRows?.length ?? 0;

  const steps = [...(c.sequences[0]?.sequence_steps ?? [])]
    .sort((a, b) => a.step_order - b.step_order)
    .map((s) => ({ ...s, variants: [...s.email_variants].sort((a, b) => a.ab_group.localeCompare(b.ab_group)) }));

  const { data: sample } = await supabase
    .from("campaign_leads")
    .select("leads!inner(email, first_name, last_name, company, title, custom_json)")
    .eq("campaign_id", id)
    .limit(1)
    .maybeSingle();
  const sampleLead = sample?.leads
    ? { ...sample.leads, custom_json: sample.leads.custom_json as Record<string, unknown> }
    : { email: "ada@example.com", first_name: "Ada", last_name: "Lovelace", company: "Analytical Engines", title: "CTO", custom_json: {} };
  const firstInbox = (inboxes ?? []).find((i) => attached.includes(i.id));
  const { data: testLeads } = await supabase
    .from("campaign_leads")
    .select("leads!inner(id, email)")
    .eq("campaign_id", id)
    .order("enrolled_at")
    .limit(25);
  // Attached inboxes first; any inbox can send a test.
  const testInboxes = [...(inboxes ?? [])].sort((a, b) => Number(attached.includes(b.id)) - Number(attached.includes(a.id)));

  return (
    <>
      <AutoRefresh active={c.status === "active"} intervalMs={5000} />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/campaigns" className="text-muted-foreground text-sm hover:underline">
            ← Campaigns
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {c.name} <CampaignStatusBadge status={c.status} />
          </h1>
        </div>
        <LifecycleButtons campaignId={c.id} status={c.status} canEdit={canEdit} />
      </div>

      {c.last_error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{c.last_error}</AlertDescription>
        </Alert>
      )}
      {org.sending_paused && c.status === "active" && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>All sending is paused workspace-wide (kill switch). This campaign will continue when sending resumes.</AlertDescription>
        </Alert>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Sent today</CardDescription>
            <UsageBar used={sentToday} cap={c.daily_limit} />
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Remaining today</CardDescription>
            <CardTitle className="text-2xl tabular-nums" data-testid="remaining-today">
              {remainingToday}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Next send</CardDescription>
            <CardTitle className="text-sm" data-testid="next-send">
              {describeNext(next, c.timezone)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Leads</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{enrolled.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <nav className="mb-4 flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/campaigns/${c.id}?tab=${t}`}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm capitalize", tab === t ? "border-primary font-medium" : "text-muted-foreground border-transparent")}
          >
            {t}
          </Link>
        ))}
      </nav>

      {tab === "sequence" && (
        <SequenceEditor
          campaignId={c.id}
          steps={steps}
          canEdit={canEdit}
          structureLocked={c.status === "active"}
          sampleLead={sampleLead}
          sender={{ name: firstInbox?.display_name ?? null, email: firstInbox?.email ?? "you@example.com" }}
          physicalAddress={orgRow?.physical_address ?? null}
          testOptions={{
            defaultTo: user.email,
            inboxes: testInboxes.map((i) => ({ id: i.id, email: i.email })),
            leads: (testLeads ?? []).map((l) => l.leads),
          }}
        />
      )}

      {tab === "results" && (
        <ResultsTab
          orgId={org.id}
          campaignId={c.id}
          steps={steps}
          canEdit={canEdit}
          tracking={{ opens: c.track_opens, clicks: c.track_clicks }}
          autoPromote={c.auto_promote_winner}
        />
      )}

      {tab === "leads" && <LeadsTab campaignId={c.id} canEdit={canEdit} lists={lists ?? []} statusCounts={statusCounts} />}

      {tab === "settings" && (
        <div className="grid gap-6">
          <Card>
            <CardContent>
              <CampaignSettingsForm campaign={c} inboxes={inboxes ?? []} attached={attached} canEdit={canEdit} />
            </CardContent>
          </Card>
          {canEdit && c.status !== "active" && (
            <form action={deleteCampaign}>
              <input type="hidden" name="campaign_id" value={c.id} />
              <Button variant="destructive" size="sm">
                Delete campaign
              </Button>
            </form>
          )}
        </div>
      )}

      {tab === "activity" && <ActivityTab campaignId={c.id} timezone={c.timezone} />}
    </>
  );
}

async function LeadsTab({
  campaignId,
  canEdit,
  lists,
  statusCounts,
}: {
  campaignId: string;
  canEdit: boolean;
  lists: { id: string; name: string }[];
  statusCounts: Map<string, number>;
}) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("campaign_leads")
    .select("id, status, current_step_order, next_send_at, stopped_reason, leads!inner(id, email, first_name, last_name), sending_accounts(email)")
    .eq("campaign_id", campaignId)
    .order("enrolled_at", { ascending: false })
    .limit(100);
  return (
    <div className="grid gap-4">
      {canEdit && <EnrollForm campaignId={campaignId} lists={lists} />}
      <div className="flex flex-wrap gap-2">
        {[...statusCounts.entries()].map(([s, n]) => (
          <Badge key={s} variant="outline">
            {s}: {n}
          </Badge>
        ))}
      </div>
      <Card>
        <CardContent>
          {!rows?.length ? (
            <p className="text-muted-foreground text-sm">No leads in this campaign yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Steps sent</TableHead>
                  <TableHead>Next send</TableHead>
                  <TableHead>Inbox</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/leads/${r.leads.id}`} className="font-medium hover:underline">
                        {r.leads.email}
                      </Link>
                      <div className="text-muted-foreground text-xs">{[r.leads.first_name, r.leads.last_name].filter(Boolean).join(" ")}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.status}</Badge>
                      {r.stopped_reason && <div className="text-muted-foreground text-xs">{r.stopped_reason}</div>}
                    </TableCell>
                    <TableCell className="tabular-nums">{r.current_step_order}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.next_send_at ? new Date(r.next_send_at).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-xs">{r.sending_accounts?.email ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function ActivityTab({ campaignId, timezone }: { campaignId: string; timezone: string }) {
  const supabase = await createClient();
  const { data: sends } = await supabase
    .from("sends")
    .select("id, status, subject, sent_at, scheduled_at, error, leads!inner(email), sending_accounts(email), sequence_steps(step_order), email_variants(ab_group)")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <Card>
      <CardContent>
        {!sends?.length ? (
          <p className="text-muted-foreground text-sm">No sends yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sends.map((s) => (
                <TableRow key={s.id} data-testid="send-row">
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(s.sent_at ?? s.scheduled_at ?? Date.now()).toLocaleString("en-US", { timeZone: timezone })}
                  </TableCell>
                  <TableCell>{s.leads.email}</TableCell>
                  <TableCell>
                    {s.sequence_steps?.step_order ?? "—"}
                    {s.email_variants?.ab_group ? ` · ${s.email_variants.ab_group}` : ""}
                  </TableCell>
                  <TableCell className="max-w-64 truncate">{s.subject}</TableCell>
                  <TableCell className="text-xs">{s.sending_accounts?.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={s.status === "sent" ? "success" : s.status === "bounced" || s.status === "failed" ? "destructive" : "outline"}>
                      {s.status}
                    </Badge>
                    {s.error && <div className="text-muted-foreground max-w-56 truncate text-xs">{s.error}</div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
