import Link from "next/link";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewCampaignForm } from "./new-campaign-form";
import { CampaignStatusBadge } from "./status-badge";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const { org, role } = await getOrgContext();
  const supabase = await createClient();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, daily_limit, created_at, last_error, campaign_leads(count)")
    .eq("org_id", org.id)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  const ids = (campaigns ?? []).map((c) => c.id);
  const { data: sent } = ids.length
    ? await supabase.from("sends").select("campaign_id").in("campaign_id", ids).in("status", ["sent", "bounced"])
    : { data: [] };
  const sentBy = new Map<string, number>();
  for (const s of sent ?? []) sentBy.set(s.campaign_id, (sentBy.get(s.campaign_id) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Multi-step sequences with send windows, volume limits and A/B variants."
        actions={can(role, "campaigns.write") && <NewCampaignForm />}
      />
      {!campaigns?.length ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No campaigns yet</CardTitle>
            <CardDescription>Create one, write your steps, add leads and an inbox, then start it.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Daily limit</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {c.last_error && <div className="text-destructive text-xs">{c.last_error}</div>}
                    </TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{(c.campaign_leads[0]?.count ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{(sentBy.get(c.id) ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.daily_limit}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{new Date(c.created_at).toLocaleDateString()}</TableCell>
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
