import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { LeadThread } from "@/components/lead-thread";
import { aiModeFor } from "@/lib/ai/provider";
import { ReclassifySelect } from "../classification";
import { ReplyComposer } from "./reply-composer";
import { Breadcrumbs } from "@/components/page-header";

export const metadata = { title: "Reply" };

export default async function ReplyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, role } = await getOrgContext();
  const supabase = await createClient();
  const { data: reply } = await supabase
    .from("replies")
    .select("*, leads(id, email, first_name, last_name, company, title, status), sending_accounts(email)")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (!reply) notFound();

  const leadId = reply.lead_id;
  const { data: opp } = leadId
    ? await supabase.from("opportunities").select("pipeline_stages(name)").eq("lead_id", leadId).maybeSingle()
    : { data: null };

  const lead = reply.leads;
  const ai = await aiModeFor(org.id);
  const leadName = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") || reply.from_email : reply.from_email;
  const canReply = can(role, "replies.send") && reply.classification !== "unsubscribe" && reply.classification !== "out_of_office";
  return (
    <>
      <Breadcrumbs items={[{ label: "Replies", href: "/replies" }, { label: leadName }]} />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-page-title">{reply.subject || "(no subject)"}</h1>
          <p className="text-muted-foreground text-sm">
            {lead ? (
              <Link href={`/leads/${lead.id}`} className="hover:underline">
                {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || reply.from_email}
              </Link>
            ) : (
              reply.from_email
            )}{" "}
            · {reply.from_email}
            {lead?.company ? ` · ${lead.company}` : ""}
          </p>
        </div>
        <div className="grid justify-items-end gap-2">
          <ReclassifySelect replyId={reply.id} value={reply.classification} canEdit={can(role, "replies.classify")} />
          <div className="flex gap-2 text-xs">
            {reply.outcome && <Badge variant="outline">outcome: {reply.outcome}</Badge>}
            {opp?.pipeline_stages && <Badge variant="secondary">pipeline: {opp.pipeline_stages.name}</Badge>}
            {lead && <Badge variant="outline">lead: {lead.status.replace(/_/g, " ")}</Badge>}
          </div>
          {reply.classification_reason && <p className="text-muted-foreground max-w-sm text-right text-xs">{reply.classification_reason}</p>}
        </div>
      </div>

      <div className="grid gap-6">
        <ReplyComposer
          replyId={reply.id}
          toName={leadName}
          toEmail={reply.from_email}
          fromEmail={reply.sending_accounts?.email ?? null}
          draft={reply.draft_body}
          draftStatus={reply.draft_status}
          draftAt={reply.draft_generated_at}
          handled={!!reply.handled_at}
          canSend={canReply}
          ai={ai}
        />
        {leadId ? <LeadThread leadId={leadId} highlightReplyId={reply.id} /> : null}
      </div>
    </>
  );
}
