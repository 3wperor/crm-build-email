import Link from "next/link";
import { can, extractReplyText, REPLY_CLASSES } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ReclassifySelect } from "./classification";

export const metadata = { title: "Replies" };

export default async function RepliesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const filter = REPLY_CLASSES.includes(c as never) ? c : null;
  const { org, role } = await getOrgContext();
  const supabase = await createClient();

  let query = supabase
    .from("replies")
    .select("id, from_email, subject, body_text, classification, classification_source, received_at, outcome, leads(first_name, last_name, company), sends(campaigns(id, name))")
    .eq("org_id", org.id)
    .order("received_at", { ascending: false })
    .limit(100);
  if (filter) query = query.eq("classification", filter);
  const [{ data: replies }, { data: all }] = await Promise.all([query, supabase.from("replies").select("classification").eq("org_id", org.id)]);

  const counts = new Map<string, number>();
  for (const r of all ?? []) counts.set(r.classification ?? "neutral", (counts.get(r.classification ?? "neutral") ?? 0) + 1);
  const canEdit = can(role, "replies.classify");

  return (
    <>
      <PageHeader title="Replies" description="Detected across your inboxes every few minutes. Replying stops the sequence and adds the lead to the pipeline." />
      <nav className="mb-4 flex flex-wrap gap-1 text-sm">
        {[null, ...REPLY_CLASSES].map((k) => (
          <Link
            key={k ?? "all"}
            href={k ? `/replies?c=${k}` : "/replies"}
            className={cn("rounded-md border px-3 py-1 capitalize", filter === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {(k ?? "all").replace(/_/g, " ")} <span className="opacity-70">{k ? (counts.get(k) ?? 0) : (all?.length ?? 0)}</span>
          </Link>
        ))}
      </nav>
      {!replies?.length ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">No replies {filter ? `classified ${filter.replace(/_/g, " ")}` : "yet"}</CardTitle>
            <CardDescription>Replies to your campaigns show up here automatically.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>Reply</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Classification</TableHead>
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
                        <div className="truncate text-sm font-medium">{r.subject || "(no subject)"}</div>
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
                      <div className="text-muted-foreground mt-1 text-[10px] uppercase">{r.classification_source}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{new Date(r.received_at).toLocaleString()}</TableCell>
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
