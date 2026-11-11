import Link from "next/link";
import { can, extractReplyText, REPLY_CLASSES } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ReclassifySelect } from "./classification";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckCircle2, MessageSquareReply } from "lucide-react";
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
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>Reply</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Reply type</TableHead>
                  <TableHead>Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replies.map((r) => (
                  <TableRow key={r.id} data-testid="reply-row">
                    <TableCell>
                      <div className="font-medium">{[r.leads?.first_name, r.leads?.last_name].filter(Boolean).join(" ") || r.from_email}</div>
                      <div className="text-muted-foreground text-xs">
                        {r.from_email}
                        {r.leads?.company ? ` · ${r.leads.company}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-md whitespace-normal">
                      <Link href={`/replies/${r.id}`} className="hover:underline">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{r.subject || "(no subject)"}</span>
                          {needsAnswer(r) && <Badge variant="secondary">{r.draft_status === "ready" ? "AI draft ready" : "Needs reply"}</Badge>}
                        </div>
                        <div className="text-muted-foreground line-clamp-2 text-xs">{extractReplyText(r.body_text ?? "").slice(0, 200)}</div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.sends?.campaigns ? (
                        <Link href={`/campaigns/${r.sends.campaigns.id}`} className="hover:underline">
                          {r.sends.campaigns.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <ReclassifySelect replyId={r.id} value={r.classification} canEdit={canEdit} />
                      {r.classification_source && <div className="text-muted-foreground text-caption mt-1">{statusLabel("replySource", r.classification_source)}</div>}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs"><Time value={r.received_at} /></TableCell>
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
