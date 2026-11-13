import { notFound } from "next/navigation";
import { can, effectiveSentToday } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { HealthBadge, providerLabel } from "@/components/health-badge";
import { UsageBar } from "@/components/usage-bar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteAccountForm, RetestButton, RotatePasswordForm, SettingsForm } from "./account-forms";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Inbox" };
export const maxDuration = 60;

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const { org, role } = await getOrgContext();
  const supabase = await createClient();

  // Note: credential columns live in another table and are never selectable here.
  const { data: a } = await supabase
    .from("sending_accounts")
    .select(
      "id, email, display_name, provider, status, username, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure, daily_cap, sent_today, sent_today_date, timezone, health, health_score, health_detail, last_checked_at, warmup_enabled, created_at",
    )
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (!a) notFound();

  const canManage = can(role, "sending_accounts.manage");

  return (
    <>
      <PageHeader
        title={a.email}
        description={a.display_name ?? undefined}
        breadcrumbs={[{ label: "Inboxes", href: "/inboxes" }, { label: a.email }]}
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Connection <HealthBadge health={a.health} />
              {a.status !== "active" && <Badge variant="neutral">{a.status === "paused" ? "Paused" : "Disconnected"}</Badge>}
            </CardTitle>
            <CardDescription>
              {created
                ? "Inbox saved. Initial connection test results below."
                : a.last_checked_at
                  ? `Last checked ${formatDate(a.last_checked_at, org.default_timezone)}`
                  : "Not checked yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {a.health_detail && a.health !== "healthy" && <p className="text-danger text-sm">{a.health_detail}</p>}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground text-caption mb-1">Sent today</dt>
                <dd>
                  <UsageBar used={effectiveSentToday(a, new Date(), org.default_timezone)} cap={a.daily_cap} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-caption mb-1">Health score</dt>
                <dd className="tabular-nums">{a.health_score ?? "Not enough emails yet"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-caption mb-1">Warmup</dt>
                <dd>{a.warmup_enabled ? "On (beta)" : "Off"}</dd>
              </div>
            </dl>
            <details className="group text-sm">
              <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer list-none rounded-sm underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
                Advanced: connection details <span className="group-open:hidden">(show)</span>
                <span className="hidden group-open:inline">(hide)</span>
              </summary>
              <dl className="bg-muted/50 mt-3 grid grid-cols-1 gap-x-6 gap-y-3 rounded-md p-4 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-caption">Provider</dt>
                  <dd>{providerLabel(a.provider)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-caption">Username</dt>
                  <dd className="truncate">{a.username}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-caption">Sending server (SMTP)</dt>
                  <dd className="font-mono text-xs break-all">
                    {a.smtp_host}:{a.smtp_port} {a.smtp_secure ? "TLS" : "STARTTLS"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-caption">Receiving server (IMAP)</dt>
                  <dd className="font-mono text-xs break-all">
                    {a.imap_host}:{a.imap_port} {a.imap_secure ? "TLS" : "STARTTLS"}
                  </dd>
                </div>
              </dl>
            </details>
            <RetestButton accountId={a.id} disabled={!canManage} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Campaigns never exceed this inbox&apos;s daily cap.</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm account={a} disabled={!canManage} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>App password</CardTitle>
            <CardDescription>Stored encrypted. It is never displayed; replace it if it was revoked or rotated.</CardDescription>
          </CardHeader>
          <CardContent>
            <RotatePasswordForm accountId={a.id} disabled={!canManage} />
          </CardContent>
        </Card>

        {canManage && (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle>Danger zone</CardTitle>
              <CardDescription>Removes the inbox and its stored credential.</CardDescription>
            </CardHeader>
            <CardContent>
              <DeleteAccountForm accountId={a.id} email={a.email} disabled={!canManage} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
