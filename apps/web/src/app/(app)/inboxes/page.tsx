import Link from "next/link";
import { Plus } from "lucide-react";
import { can, effectiveSentToday } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { HealthBadge, providerLabel } from "@/components/health-badge";
import { UsageBar } from "@/components/usage-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Inboxes" };

function relative(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default async function InboxesPage() {
  const { org, role } = await getOrgContext();
  const supabase = await createClient();
  const { data: accounts, error } = await supabase
      .from("sending_accounts")
      .select(
        "id, email, display_name, provider, status, daily_cap, sent_today, sent_today_date, timezone, health, health_detail, last_checked_at, warmup_enabled",
      )
      .eq("org_id", org.id)
      .order("created_at");
  const canManage = can(role, "sending_accounts.manage");
  const now = new Date();
  const orgTz = org.default_timezone;

  const totals = (accounts ?? []).reduce(
    (acc, a) => {
      if (a.status !== "active") return acc;
      acc.sent += effectiveSentToday(a, now, orgTz);
      acc.cap += a.daily_cap;
      return acc;
    },
    { sent: 0, cap: 0 },
  );

  return (
    <>
      <PageHeader
        title="Inboxes"
        description="Connected sending accounts. Replies are detected over IMAP."
        actions={
          canManage && (
            <Button asChild>
              <Link href="/inboxes/new">
                <Plus /> Add inbox
              </Link>
            </Button>
          )
        }
      />

      {error && <p className="text-destructive text-sm">{error.message}</p>}

      {accounts && accounts.length === 0 && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No inboxes yet</CardTitle>
            <CardDescription>
              Connect a Google Workspace / Gmail account or any SMTP + IMAP mailbox using an app password.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {accounts && accounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardDescription>Today across active inboxes</CardDescription>
            <UsageBar used={totals.sent} cap={totals.cap} className="max-w-xs" />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Inbox</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Sent today</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Last checked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/inboxes/${a.id}`} className="font-medium hover:underline">
                        {a.email}
                      </Link>
                      <div className="text-muted-foreground flex items-center gap-1 text-xs">
                        {a.display_name ?? "—"}
                        {a.status !== "active" && (
                          <Badge variant="outline" className="capitalize">
                            {a.status}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{providerLabel(a.provider)}</TableCell>
                    <TableCell>
                      <UsageBar used={effectiveSentToday(a, now, orgTz)} cap={a.daily_cap} />
                    </TableCell>
                    <TableCell className="max-w-72 whitespace-normal">
                      <HealthBadge health={a.health} />
                      {a.health_detail && <div className="text-muted-foreground mt-1 text-xs">{a.health_detail}</div>}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{relative(a.last_checked_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
