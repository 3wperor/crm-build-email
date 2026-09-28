import Link from "next/link";
import { Settings2 } from "lucide-react";
import { can, extractReplyText } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Button } from "@/components/ui/button";
import { Board, type BoardCard } from "./board";

export const metadata = { title: "Pipeline" };

const REALTIME_TABLES = ["opportunities", "replies"];

export default async function PipelinePage() {
  const { org, role } = await getOrgContext();
  const supabase = await createClient();
  const [{ data: stages }, { data: opps }] = await Promise.all([
    supabase.from("pipeline_stages").select("id, name, kind, is_entry").eq("org_id", org.id).order("position"),
    supabase
      .from("opportunities")
      .select("id, stage_id, lead_id, booking_link, moved_at, source, leads!inner(email, first_name, last_name, company), campaigns(name)")
      .eq("org_id", org.id)
      .limit(1000),
  ]);

  // Latest reply per lead for the card snippet.
  const leadIds = (opps ?? []).map((o) => o.lead_id);
  const { data: replies } = leadIds.length
    ? await supabase.from("replies").select("lead_id, body_text, classification, received_at").in("lead_id", leadIds).order("received_at", { ascending: false })
    : { data: [] };
  const latest = new Map<string, NonNullable<typeof replies>[number]>();
  for (const r of replies ?? []) if (r.lead_id && !latest.has(r.lead_id)) latest.set(r.lead_id, r);

  const cards: BoardCard[] = (opps ?? []).map((o) => {
    const r = latest.get(o.lead_id);
    return {
      id: o.id,
      stage_id: o.stage_id,
      lead_id: o.lead_id,
      name: [o.leads.first_name, o.leads.last_name].filter(Boolean).join(" ") || o.leads.email,
      email: o.leads.email,
      company: o.leads.company,
      campaign: o.campaigns?.name ?? null,
      booking_link: o.booking_link,
      moved_at: o.moved_at,
      source: o.source,
      last_reply: r ? { snippet: extractReplyText(r.body_text ?? "").slice(0, 160), classification: r.classification, at: r.received_at } : null,
    };
  });

  return (
    <>
      <RealtimeRefresh orgId={org.id} tables={REALTIME_TABLES} />
      <PageHeader
        title="Pipeline"
        description="Leads enter by replying (or when you add them). Drag cards between stages."
        actions={
          can(role, "pipeline_stages.manage") && (
            <Button asChild variant="outline">
              <Link href="/pipeline/stages">
                <Settings2 /> Edit stages
              </Link>
            </Button>
          )
        }
      />
      <Board stages={stages ?? []} cards={cards} canEdit={can(role, "opportunities.write")} />
    </>
  );
}
