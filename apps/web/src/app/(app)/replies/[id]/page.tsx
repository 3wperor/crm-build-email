import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReclassifySelect } from "../classification";

export const metadata = { title: "Reply" };

type ThreadItem = { kind: "sent" | "reply"; id: string; at: string; from: string; subject: string | null; body: string; meta?: string };

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

  // Full conversation with this lead: every email we sent and every reply.
  const leadId = reply.lead_id;
  const [{ data: sends }, { data: replies }, { data: opp }] = await Promise.all([
    leadId
      ? supabase.from("sends").select("id, subject, body_text, sent_at, status, sending_accounts(email), sequence_steps(step_order)").eq("lead_id", leadId).in("status", ["sent", "bounced"])
      : Promise.resolve({ data: [] }),
    leadId ? supabase.from("replies").select("id, subject, body_text, received_at, from_email, classification").eq("lead_id", leadId) : Promise.resolve({ data: [] }),
    leadId ? supabase.from("opportunities").select("pipeline_stages(name)").eq("lead_id", leadId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const thread: ThreadItem[] = [
    ...(sends ?? []).map((s) => ({
      kind: "sent" as const,
      id: s.id,
      at: s.sent_at ?? "",
      from: s.sending_accounts?.email ?? "you",
      subject: s.subject,
      body: s.body_text ?? "",
      meta: `Step ${s.sequence_steps?.step_order ?? "?"}${s.status === "bounced" ? " · bounced" : ""}`,
    })),
    ...(replies ?? []).map((r) => ({
      kind: "reply" as const,
      id: r.id,
      at: r.received_at,
      from: r.from_email,
      subject: r.subject,
      body: r.body_text ?? "",
      meta: r.classification?.replace(/_/g, " "),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const lead = reply.leads;
  return (
    <>
      <Link href="/replies" className="text-muted-foreground text-sm hover:underline">
        ← Replies
      </Link>
      <div className="mt-2 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{reply.subject || "(no subject)"}</h1>
          <p className="text-muted-foreground text-sm">
            {[lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || reply.from_email} · {reply.from_email}
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

      <div className="grid gap-3" data-testid="thread">
        {thread.map((t) => (
          <Card key={`${t.kind}-${t.id}`} className={t.kind === "reply" ? "border-primary/40" : "bg-muted/30"}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">
                {t.kind === "sent" ? "Sent" : "Reply"} · {t.from}
                {t.meta && <span className="text-muted-foreground font-normal"> · {t.meta}</span>}
              </CardTitle>
              <span className="text-muted-foreground text-xs">{t.at ? new Date(t.at).toLocaleString() : ""}</span>
            </CardHeader>
            <CardContent>
              {t.subject && <div className="mb-2 text-sm font-medium">{t.subject}</div>}
              <pre className="font-sans text-sm whitespace-pre-wrap">{t.body}</pre>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
