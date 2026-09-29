import Link from "next/link";
import { can, type CrmPipeline } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { loadCrmAdapter } from "@/lib/crm";
import { PageHeader } from "@/components/coming-soon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { disconnectCrm, syncNow } from "./actions";
import { ConnectForm, MappingForm } from "./forms";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const { org, role } = await getOrgContext();
  const isAdmin = can(role, "org.update");
  const supabase = await createClient();
  const [{ data: conn }, { data: stages }] = await Promise.all([
    supabase.from("crm_connections").select("id, status, account_label, pipeline_id, stage_map, last_synced_at, last_error, updated_at").eq("org_id", org.id).eq("provider", "hubspot").maybeSingle(),
    supabase.from("pipeline_stages").select("id, name").eq("org_id", org.id).order("position"),
  ]);
  const { count: deals } = conn ? await supabase.from("crm_links").select("id", { count: "exact", head: true }).eq("connection_id", conn.id).eq("object", "deal") : { count: 0 };

  let pipelines: CrmPipeline[] = [];
  let pipelineError: string | null = null;
  if (conn && isAdmin) {
    try {
      pipelines = await (await loadCrmAdapter(conn.id)).listPipelines();
    } catch (e) {
      pipelineError = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        description="YCAReach stays your source of truth. Connected CRMs receive a contact and a deal for every lead in your pipeline."
        actions={
          <Link href="/settings" className="text-sm underline underline-offset-4">
            ← Settings
          </Link>
        }
      />
      <Card data-testid="hubspot">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            HubSpot{" "}
            {conn &&
              (conn.status === "connected" ? <Badge variant="success">✓ Connected</Badge> : <Badge variant="destructive">✕ {conn.status === "error" ? "Needs attention" : "Disabled"}</Badge>)}
          </CardTitle>
          <CardDescription>
            Create a <em>private app</em> in HubSpot (Settings → Integrations → Private apps) with scopes <code>crm.objects.contacts.read/write</code> and{" "}
            <code>crm.objects.deals.read/write</code>, then paste its access token. It&apos;s stored encrypted. Sync runs every 15 minutes; deleting here never
            deletes anything in HubSpot.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {conn && (
            <div className="grid gap-1 text-sm" data-testid="hubspot-status">
              <div>
                {conn.account_label ?? "HubSpot"} · {deals ?? 0} deal{deals === 1 ? "" : "s"} synced · last sync{" "}
                {conn.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : "never"}
              </div>
              {conn.last_error && <div className="text-destructive">{conn.last_error}</div>}
              {pipelineError && <div className="text-destructive">{pipelineError}</div>}
            </div>
          )}
          {isAdmin ? (
            <>
              {conn && pipelines.length > 0 && (
                <MappingForm
                  pipelineId={conn.pipeline_id}
                  pipelines={pipelines}
                  stages={stages ?? []}
                  map={conn.stage_map as Record<string, string>}
                  version={conn.updated_at}
                />
              )}
              <ConnectForm reconnect={!!conn} />
              {conn && (
                <div className="flex gap-2">
                  <form action={syncNow}>
                    <input type="hidden" name="connection_id" value={conn.id} />
                    <Button size="sm">Sync now</Button>
                  </form>
                  <form action={disconnectCrm}>
                    <input type="hidden" name="connection_id" value={conn.id} />
                    <Button size="sm" variant="outline">
                      Disconnect
                    </Button>
                  </form>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Only owners and admins can manage integrations.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
