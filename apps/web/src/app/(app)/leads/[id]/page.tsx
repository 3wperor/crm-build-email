import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { can } from "@crm/core";
import { VERIFICATION_REASON_LABELS, type VerificationReason } from "@crm/core/verification";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { LeadThread } from "@/components/lead-thread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteNote } from "./actions";
import { LeadFieldsForm, NoteForm, PipelineControl } from "./lead-forms";

export const metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, role, user } = await getOrgContext();
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (!lead) notFound();

  const [{ data: opp }, { data: stages }, { data: enrollments }, { data: notes }, { data: suppression }, { data: lists }] = await Promise.all([
    supabase.from("opportunities").select("stage_id, booking_link, source, moved_at, pipeline_stages(name)").eq("lead_id", id).maybeSingle(),
    supabase.from("pipeline_stages").select("id, name").eq("org_id", org.id).order("position"),
    supabase
      .from("campaign_leads")
      .select("id, status, current_step_order, next_send_at, stopped_reason, campaigns!inner(id, name, status), sending_accounts(email)")
      .eq("lead_id", id)
      .order("enrolled_at", { ascending: false }),
    supabase.from("lead_notes").select("id, body, created_at, user_id, users(email, full_name)").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("suppression_list").select("reason, created_at").eq("org_id", org.id).eq("email", lead.email).maybeSingle(),
    supabase.from("lead_list_members").select("lead_lists(id, name)").eq("lead_id", id),
  ]);

  const canEdit = can(role, "leads.write");
  const detail = lead.verification_detail as { level?: string; reasons?: string[]; mx?: string[] } | null;
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email;
  const custom = Object.entries((lead.custom_json ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)] as [string, string]);

  return (
    <>
      <Link href="/leads" className="text-muted-foreground text-sm hover:underline">
        ← Leads
      </Link>
      <div className="mt-2 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <p className="text-muted-foreground text-sm">
          {lead.email}
          {lead.title ? ` · ${lead.title}` : ""}
          {lead.company ? ` at ${lead.company}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="outline" data-testid="lead-status">
            {lead.status.replace(/_/g, " ")}
          </Badge>
          <Badge variant={lead.verification_status === "valid" ? "success" : lead.verification_status === "invalid" ? "destructive" : "outline"}>
            {lead.verification_status}
          </Badge>
          {suppression && <Badge variant="destructive">suppressed: {suppression.reason.replace(/_/g, " ")}</Badge>}
          {opp?.pipeline_stages && <Badge variant="secondary">pipeline: {opp.pipeline_stages.name}</Badge>}
          {(lists ?? []).map((l) =>
            l.lead_lists ? (
              <Link key={l.lead_lists.id} href={`/leads?list=${l.lead_lists.id}`}>
                <Badge variant="outline">list: {l.lead_lists.name}</Badge>
              </Link>
            ) : null,
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conversation</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadThread leadId={id} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadFieldsForm
                version={lead.updated_at}
                lead={{ id, first_name: lead.first_name, last_name: lead.last_name, company: lead.company, title: lead.title, custom }}
                canEdit={canEdit}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline</CardTitle>
              {opp && <CardDescription>In stage since {new Date(opp.moved_at).toLocaleDateString()} · {opp.source === "reply" ? "entered by reply" : "added manually"}</CardDescription>}
            </CardHeader>
            <CardContent>
              <PipelineControl
                version={`${opp?.stage_id ?? "none"}-${opp?.booking_link ?? ""}-${opp?.moved_at ?? ""}`}
                leadId={id}
                opportunity={opp}
                stages={stages ?? []}
                canEdit={can(role, "opportunities.write")}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {canEdit && <NoteForm leadId={id} />}
              {(notes ?? []).map((n) => (
                <div key={n.id} className="grid gap-1 rounded-md border p-2 text-sm" data-testid="note">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <div className="text-muted-foreground flex items-center justify-between text-xs">
                    <span>
                      {n.users?.full_name ?? n.users?.email ?? "someone"} · {new Date(n.created_at).toLocaleString()}
                    </span>
                    {(n.user_id === user.id || can(role, "org.update")) && (
                      <form action={deleteNote}>
                        <input type="hidden" name="note_id" value={n.id} />
                        <input type="hidden" name="lead_id" value={id} />
                        <Button size="icon" variant="ghost" className="size-6" aria-label="Delete note">
                          <Trash2 />
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Campaigns</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {!enrollments?.length && <p className="text-muted-foreground">Not in any campaign.</p>}
              {(enrollments ?? []).map((e) => (
                <div key={e.id} className="grid gap-0.5 rounded-md border p-2">
                  <Link href={`/campaigns/${e.campaigns.id}`} className="font-medium hover:underline">
                    {e.campaigns.name}
                  </Link>
                  <div className="text-muted-foreground text-xs">
                    {e.status} · {e.current_step_order} step(s) sent
                    {e.next_send_at ? ` · next ${new Date(e.next_send_at).toLocaleString()}` : ""}
                    {e.stopped_reason ? ` · ${e.stopped_reason}` : ""}
                    {e.sending_accounts?.email ? ` · from ${e.sending_accounts.email}` : ""}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Verification</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground grid gap-1 text-xs">
              <div>
                Status: <span className="text-foreground">{lead.verification_status}</span>
                {lead.verified_at ? ` · ${new Date(lead.verified_at).toLocaleDateString()}` : ""}
              </div>
              {detail?.level === "mx" && <div>Domain accepts mail (DNS check; mailbox not probed)</div>}
              {(detail?.reasons ?? []).map((r) => (
                <div key={r}>{VERIFICATION_REASON_LABELS[r as VerificationReason] ?? r}</div>
              ))}
              {detail?.mx?.length ? <div>MX: {detail.mx.slice(0, 3).join(", ")}</div> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
