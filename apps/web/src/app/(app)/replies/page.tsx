import Link from "next/link";
import { can, extractReplyText, REPLY_CLASSES } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ReclassifySelect } from "./classification";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckCircle2, MessageSquareReply, Sparkles } from "lucide-react";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Time } from "@/components/time";
import { statusLabel } from "@/lib/labels";

const NEEDS_REPLY_CLASSES = ["positive", "neutral"] as const;
const needsAnswer = (r: { classification: string | null; handled_at: string | null }) =>
  !r.handled_at && (NEEDS_REPLY_CLASSES as readonly string[]).includes(r.classification ?? "");

export const metadata = { title: "Replies" };

export default async function RepliesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const needsReply = c === "needs_reply";
  const filter = needsReply ? "needs_reply" : REPLY_CLASSES.includes(c as never) ? c : null;
  const { org, role } = await getOrgContext();
  const supabase = await createClient();

  let query = supabase
    .from("replies")
    .select("id, from_email, subject, body_text, classification, classification_source, received_at, outcome, handled_at, draft_status, leads(first_name, last_name, company), sends(campaigns(id, name))")
    .eq("org_id", org.id)
    .order("received_at", { ascending: false })
    .limit(100);
  if (needsReply) query = query.in("classification", NEEDS_REPLY_CLASSES).is("handled_at", null);
  else if (filter) query = query.eq("classification", filter);
  const [{ data: replies }, { data: all }] = await Promise.all([query, supabase.from("replies").select("classification, handled_at").eq("org_id", org.id)]);

  const counts = new Map<string, number>();
  for (const r of all ?? []) {
    counts.set(r.classification ?? "neutral", (counts.get(r.classification ?? "neutral") ?? 0) + 1);
    if (needsAnswer(r)) counts.set("needs_reply", (counts.get("needs_reply") ?? 0) + 1);
  }
  const canEdit = can(role, "replies.classify");

  return (
    <>
      <PageHeader title="Replies" description="We check your inboxes every few minutes. When someone replies, their follow-ups stop and they're added to your pipeline." />
      <LinkTabs
        label="Filter replies"
        items={[null, "needs_reply", ...REPLY_CLASSES].map((k) => ({
          href: k ? `/replies?c=${k}` : "/replies",
          label: statusLabel("reply", k ?? "all"),
          active: filter === k,
          count: k ? (counts.get(k) ?? 0) : (all?.length ?? 0),
        }))}
      />
      {!replies?.length ? (
        <EmptyState
          icon={needsReply ? CheckCircle2 : MessageSquareReply}
          title={needsReply ? "Nothing waiting for an answer" : filter ? `No replies sorted as "${statusLabel("reply", filter)}"` : "No replies yet"}
          description="Replies to your campaigns show up here automatically."
        />
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y">
            {replies.map((r) => {
              const waiting = needsAnswer(r);
              return (
                <li key={r.id} data-testid="reply-row" className="hover:bg-muted/40 relative grid gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[13rem_minmax(0,1fr)_auto] sm:px-5">
                  {waiting && <span aria-hidden="true" className="bg-primary absolute inset-y-0 left-0 w-0.5" />}
                  <div className="min-w-0">
                    <div className={cn("truncate text-sm", waiting ? "font-semibold" : "font-medium")}>
                      {[r.leads?.first_name, r.leads?.last_name].filter(Boolean).join(" ") || r.from_email}
                    </div>
                    <div className="text-muted-foreground text-caption truncate">{r.leads?.company || r.from_email}</div>
                  </div>
                  <Link href={`/replies/${r.id}`} className="focus-visible:ring-ring/50 min-w-0 rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-[3px]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn("truncate text-sm", waiting && "font-medium")}>{r.subject || "(no subject)"}</span>
                      {waiting &&
                        (r.draft_status === "ready" ? (
                          <span className="text-primary text-caption inline-flex items-center gap-1 font-medium">
                            <Sparkles className="size-3" /> AI draft ready
                          </span>
                        ) : (
                          <Badge variant="info">Needs reply</Badge>
                        ))}
                    </div>
                    <p className="text-muted-foreground text-small mt-0.5 line-clamp-1">{extractReplyText(r.body_text ?? "").slice(0, 200)}</p>
                    {r.sends?.campaigns && <p className="text-muted-foreground text-caption mt-1">From {r.sends.campaigns.name}</p>}
                  </Link>
                  <div className="relative z-[1] flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
                    <Time value={r.received_at} className="text-muted-foreground text-caption order-last whitespace-nowrap sm:order-none" />
                    <div title={r.classification_source ? statusLabel("replySource", r.classification_source) : undefined}>
                      <ReclassifySelect replyId={r.id} value={r.classification} canEdit={canEdit} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
