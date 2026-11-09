import "server-only";
import { extractReplyText, type ReplyClass } from "@crm/core";
import { parseReplyDraft, replyDraftPrompt } from "@crm/core/ai";
import { runAi } from "@/lib/ai/provider";
import { createAdminClient } from "@/lib/supabase/admin";

export type DraftResult = { ok: true; body: string } | { ok: false; error: string };

/**
 * Writes an AI draft answer for one reply and stores it on the reply.
 * Skips replies that were already answered. `notes` lets the user steer a
 * regenerated draft ("offer Tuesday", "keep it shorter").
 */
export async function generateReplyDraft(orgId: string, replyId: string, opts: { notes?: string | null; force?: boolean } = {}): Promise<DraftResult> {
  const admin = createAdminClient();
  const { data: reply } = await admin
    .from("replies")
    .select("id, lead_id, send_id, subject, body_text, classification, handled_at, received_at, leads(first_name, company, title), sending_accounts(display_name), sends(subject, body_text)")
    .eq("org_id", orgId)
    .eq("id", replyId)
    .maybeSingle();
  if (!reply) return { ok: false, error: "Reply not found." };
  if (reply.handled_at && !opts.force) {
    await admin.from("replies").update({ draft_status: "skipped" }).eq("id", replyId);
    return { ok: false, error: "This reply was already answered." };
  }

  // Earlier back-and-forth with this lead (newest four), for context.
  const earlier: { from: "us" | "them"; text: string; at: string }[] = [];
  if (reply.lead_id) {
    const [{ data: others }, { data: ours }] = await Promise.all([
      admin.from("replies").select("body_text, received_at").eq("org_id", orgId).eq("lead_id", reply.lead_id).neq("id", replyId).lt("received_at", reply.received_at).order("received_at", { ascending: false }).limit(4),
      admin.from("reply_messages").select("body_text, created_at").eq("org_id", orgId).eq("lead_id", reply.lead_id).eq("status", "sent").order("created_at", { ascending: false }).limit(4),
    ]);
    for (const r of others ?? []) earlier.push({ from: "them", text: extractReplyText(r.body_text ?? ""), at: r.received_at });
    for (const m of ours ?? []) earlier.push({ from: "us", text: m.body_text, at: m.created_at });
    earlier.sort((a, b) => a.at.localeCompare(b.at));
  }

  const prompt = replyDraftPrompt({
    ourEmail: reply.sends ? { subject: reply.sends.subject, body: reply.sends.body_text } : null,
    theirReply: { subject: reply.subject, text: extractReplyText(reply.body_text ?? "") },
    earlier: earlier.slice(-4),
    lead: { first_name: reply.leads?.first_name ?? null, company: reply.leads?.company ?? null, title: reply.leads?.title ?? null },
    sender: { name: reply.sending_accounts?.display_name ?? null },
    classification: reply.classification as ReplyClass | null,
    notes: opts.notes,
  });

  const res = await runAi(orgId, "draft_reply", prompt);
  const body = res.ok ? parseReplyDraft(res.text) : null;
  if (!body) {
    await admin.from("replies").update({ draft_status: "failed" }).eq("id", replyId);
    return { ok: false, error: res.ok ? "The AI couldn't write a usable draft. Try again or write your own." : res.error };
  }
  await admin.from("replies").update({ draft_status: "ready", draft_body: body, draft_generated_at: new Date().toISOString() }).eq("id", replyId);
  return { ok: true, body };
}
