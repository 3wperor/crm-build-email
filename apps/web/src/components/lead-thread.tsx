import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ThreadItem = { kind: "sent" | "reply"; id: string; at: string; from: string; subject: string | null; body: string; meta?: string };

/** Everything we sent to a lead and everything they sent back, oldest first. */
export async function LeadThread({ leadId, highlightReplyId }: { leadId: string; highlightReplyId?: string }) {
  const supabase = await createClient();
  const [{ data: sends }, { data: replies }] = await Promise.all([
    supabase
      .from("sends")
      .select("id, subject, body_text, sent_at, status, sending_accounts(email), sequence_steps(step_order), campaigns(name)")
      .eq("lead_id", leadId)
      .in("status", ["sent", "bounced"]),
    supabase.from("replies").select("id, subject, body_text, received_at, from_email, classification").eq("lead_id", leadId),
  ]);
  const thread: ThreadItem[] = [
    ...(sends ?? []).map((s) => ({
      kind: "sent" as const,
      id: s.id,
      at: s.sent_at ?? "",
      from: s.sending_accounts?.email ?? "you",
      subject: s.subject,
      body: s.body_text ?? "",
      meta: [s.campaigns?.name, `step ${s.sequence_steps?.step_order ?? "?"}`, s.status === "bounced" ? "bounced" : null].filter(Boolean).join(" · "),
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

  if (!thread.length) return <p className="text-muted-foreground text-sm">No emails yet.</p>;
  return (
    <div className="grid gap-3" data-testid="thread">
      {thread.map((t) => (
        <Card
          key={`${t.kind}-${t.id}`}
          className={t.kind === "reply" ? (t.id === highlightReplyId ? "border-primary ring-primary/20 ring-2" : "border-primary/40") : "bg-muted/30"}
        >
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
  );
}
