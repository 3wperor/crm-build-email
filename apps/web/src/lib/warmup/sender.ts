import "server-only";
import { textToHtml, WARMUP_HEADER } from "@crm/core";
import { createMailAdapter } from "@crm/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendGap } from "@/lib/scheduler/config";
import { ACCOUNT_CONNECTION_COLUMNS, loadAccountPassword, mailAdapterOptions, toMailConfig } from "@/lib/sending-accounts";

export type WarmupAttempt = { kind: "wait"; until: string } | { kind: "done"; outcome: "sent" | "bounced" | "failed" | "cancelled" | "skipped"; detail?: string };

/** One attempt to send a queued warmup email. Idempotent: only `scheduled` rows are claimed. */
export async function attemptWarmupSend(id: string): Promise<WarmupAttempt> {
  const admin = createAdminClient();
  const gap = sendGap();
  const { data: slot, error } = await admin.rpc("reserve_warmup_slot", { p_message_id: id, p_min_gap_s: gap.minSeconds, p_max_gap_s: gap.maxSeconds });
  if (error) throw new Error(error.message);
  const r = slot as { ok: boolean; reason?: string; retry_at?: string };
  if (!r.ok) {
    if (r.reason === "pacing" && r.retry_at) return { kind: "wait", until: r.retry_at };
    if (r.reason === "not_scheduled") return { kind: "done", outcome: "skipped" };
    // Kill switch, warmup turned off/paused, or today's cap is full: drop it; the planner makes new ones.
    await admin.rpc("finish_warmup_send", { p_message_id: id, p_outcome: "cancelled", p_error: r.reason ?? "unavailable" });
    return { kind: "done", outcome: "cancelled", detail: r.reason };
  }

  const { data: msg } = await admin
    .from("warmup_messages")
    .select("id, org_id, from_account_id, message_id, in_reply_to, references, subject, body_text, to:sending_accounts!warmup_messages_org_id_to_account_id_fkey(email)")
    .eq("id", id)
    .single();
  const { data: account } = await admin.from("sending_accounts").select(`${ACCOUNT_CONNECTION_COLUMNS}, display_name`).eq("id", msg!.from_account_id).single();
  if (!msg || !account) {
    await admin.rpc("finish_warmup_send", { p_message_id: id, p_outcome: "failed", p_error: "inbox vanished" });
    return { kind: "done", outcome: "failed" };
  }

  const password = await loadAccountPassword(account.org_id, account.id);
  const adapter = createMailAdapter(toMailConfig(account, password), mailAdapterOptions());
  const result = await adapter.send({
    fromName: account.display_name,
    to: (msg.to as unknown as { email: string }).email,
    subject: msg.subject,
    text: msg.body_text,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">\n${textToHtml(msg.body_text)}\n</div>`,
    messageId: msg.message_id,
    inReplyTo: msg.in_reply_to,
    references: msg.references,
    headers: { [WARMUP_HEADER]: "1" },
  });
  const outcome = result.ok ? "sent" : result.hardBounce ? "bounced" : "failed";
  await admin.rpc("finish_warmup_send", { p_message_id: id, p_outcome: outcome, ...(result.ok ? {} : { p_error: result.error.slice(0, 300) }) });
  return { kind: "done", outcome, ...(result.ok ? {} : { detail: result.error }) };
}
