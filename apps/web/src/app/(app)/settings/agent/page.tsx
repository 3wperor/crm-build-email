import Link from "next/link";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { decideApproval, revokeApiKey } from "./actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getBillingStatus } from "@/lib/billing";
import { hasProAccess } from "@crm/core/billing";
import { CreateKeyForm } from "./key-form";
import { Time } from "@/components/time";
import { StatusBadge } from "@/components/status-badge";

export const metadata = { title: "Connect Claude" };

export default async function AgentSettingsPage() {
  const { org, role } = await getOrgContext();
  const supabase = await createClient();
  const canKeys = can(role, "api_keys.manage");
  const canDecide = can(role, "campaigns.write");
  const billing = await getBillingStatus(org.id);
  const pro = hasProAccess(billing);
  const [{ data: keys }, { data: approvals }] = await Promise.all([
    canKeys ? supabase.from("api_keys").select("id, name, prefix, created_at, last_used_at, revoked_at").eq("org_id", org.id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    supabase
      .from("agent_approvals")
      .select("id, tool, args, summary, reason, status, error, created_at, decided_at, campaigns(id, name), api_keys(name)")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const pending = (approvals ?? []).filter((a) => a.status === "pending");
  const decided = (approvals ?? []).filter((a) => a.status !== "pending").slice(0, 15);

  return (
    <>
      <PageHeader
        title="Connect Claude"
        description="Let Claude (or another AI assistant) work in YCAReach for you: write campaigns, add leads and draft replies, within the limits below."
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Guardrails</CardTitle>
            <CardDescription>
              Workspace mode: <Badge variant={org.approval_mode === "auto" ? "warning" : "outline"}>{org.approval_mode === "auto" ? "full-auto allowed" : "draft-only"}</Badge>{" "}
              (change it in <Link href="/settings" className="underline">Settings</Link>; per campaign under its Settings tab).
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground grid gap-1 text-sm">
            <p>• Reads, drafts and configuration run right away. Pausing a campaign, adding addresses to the do-not-email list and pausing all sending are always allowed.</p>
            <p>
              • Anything that sends (start/resume a campaign, raising volume, test emails to non-members) waits here for approval unless both the workspace and
              the campaign are full-auto.
            </p>
            <p>• The agent can never resume sending, change approval modes, take anyone off the do-not-email list or switch on an inbox it added. Daily limits and the do-not-email list always apply.</p>
            <p>• Every call, allowed or not, is written to the audit log.</p>
          </CardContent>
        </Card>

        <Card data-testid="approvals">
          <CardHeader>
            <CardTitle className="text-base">Waiting for approval {pending.length > 0 && <Badge variant="warning">{pending.length}</Badge>}</CardTitle>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing waiting.</p>
            ) : (
              <Table>
                <TableBody>
                  {pending.map((a) => (
                    <TableRow key={a.id} data-testid={`approval-${a.tool}`}>
                      <TableCell>
                        <div className="font-medium">{a.summary}</div>
                        <div className="text-muted-foreground text-xs">
                          {a.campaigns ? (
                            <Link href={`/campaigns/${a.campaigns.id}`} className="underline">
                              {a.campaigns.name}
                            </Link>
                          ) : (
                            "Workspace"
                          )}{" "}
                          · {a.api_keys?.name ?? "deleted key"} · <Time value={a.created_at} />
                        </div>
                        <pre className="text-muted-foreground mt-1 max-w-xl text-xs whitespace-pre-wrap">{JSON.stringify(a.args)}</pre>
                      </TableCell>
                      <TableCell className="text-right">
                        {canDecide && (
                          <div className="flex justify-end gap-2">
                            <form action={decideApproval}>
                              <input type="hidden" name="approval_id" value={a.id} />
                              <input type="hidden" name="decision" value="reject" />
                              <Button size="sm" variant="outline">
                                Reject
                              </Button>
                            </form>
                            <form action={decideApproval}>
                              <input type="hidden" name="approval_id" value={a.id} />
                              <input type="hidden" name="decision" value="approve" />
                              <Button size="sm">Approve</Button>
                            </form>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {decided.length > 0 && (
              <details className="mt-4">
                <summary className="text-muted-foreground cursor-pointer text-sm">Recently decided</summary>
                <ul className="mt-2 grid gap-1 text-sm" data-testid="decided">
                  {decided.map((a) => (
                    <li key={a.id}>
                      <StatusBadge kind="approval" value={a.status} /> {a.summary}
                      {a.campaigns ? ` · ${a.campaigns.name}` : ""}
                      {a.error && <span className="text-destructive"> · {a.error}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>

        {!pro && (
          <Alert data-testid="agent-pro-only">
            <AlertDescription>
              <span>
                The AI agent is part of the <strong>Pro</strong> plan.{" "}
                <Link href="/billing" className="font-medium underline underline-offset-4">
                  Upgrade to Pro
                </Link>{" "}
                to connect Claude.
              </span>
            </AlertDescription>
          </Alert>
        )}
        {canKeys && pro && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">API keys</CardTitle>
              <CardDescription>Claude signs in with one of these (technical name: MCP server key). Keys act on this workspace only; only a hash is stored.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <CreateKeyForm appUrl={publicEnv.appUrl} />
              {(keys ?? []).length > 0 && (
                <Table data-testid="api-keys">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead className="sr-only">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(keys ?? []).map((k) => (
                      <TableRow key={k.id}>
                        <TableCell className="font-medium">{k.name}</TableCell>
                        <TableCell>
                          <code className="text-xs">{k.prefix}…</code>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs"><Time value={k.last_used_at} fallback="Never" /></TableCell>
                        <TableCell className="text-right">
                          {k.revoked_at ? (
                            <Badge variant="outline">Revoked</Badge>
                          ) : (
                            <form action={revokeApiKey}>
                              <input type="hidden" name="key_id" value={k.id} />
                              <Button size="sm" variant="outline">
                                Revoke {k.name}
                              </Button>
                            </form>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
