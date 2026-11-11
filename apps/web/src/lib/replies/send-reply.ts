import "server-only";
import { randomUUID } from "node:crypto";
import { extractReplyText, textToHtml } from "@crm/core";
import { createMailAdapter } from "@crm/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBlockedMessage } from "@/lib/billing";
import { newMessageId } from "@/lib/scheduler/config";
import { ACCOUNT_CONNECTION_COLUMNS, loadAccountPassword, mailAdapterOptions, toMailConfig } from "@/lib/sending-accounts";

export const REPLIES_PER_HOUR = 60;
const MAX_BODY = 20_000;

export type SendReplyInput = {
  orgId: string;
  replyId: string;
  body: string;
  /** 'user:<id>' | 'agent:<id>' */
  actor: string;
  userId?: string | null;
  apiKeyId?: string | null;
  aiDrafted?: boolean;
};

export type SendReplyResult = { ok: true; id: string; to: string; from: string } | { ok: false; error: string };

export function replySubject(subject: string | null): string {
  const s = (subject ?? "").trim();
  return /^re:/i.test(s) ? s : `Re: ${s || "your message"}`;
}

/** "On <date>, <from> wrote:" + their text quoted, so the lead sees what we're answering. */
export function quoteReply(from: string, receivedAt: string, text: string): string {
  const quoted = extractReplyText(text)
    .slice(0, 3000)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `On ${new Date(receivedAt).toUTCString()}, ${from} wrote:\n${quoted}`;
}

/**
 * Sends an answer to a lead's reply from the inbox that received it, in the
 * same thread (In-Reply-To / References). Honors the kill switch, the plan,
 * suppression and a per-workspace hourly limit. Marks the reply handled.
 */
export async function sendReplyMessage(input: SendReplyInput): Promise<SendReplyResult> {
  const admin = createAdminClient();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, error: "Write a message first." };
  if (body.length > MAX_BODY) return { ok: false, error: "That message is too long." };

  const { data: org } = await admin.from("organizations").select("sending_paused").eq("id", input.orgId).single();
  if (!org) return { ok: false, error: "Workspace not found." };
  if (org.sending_paused) return { ok: false, error: "All sending is paused. Resume sending (top of the page) to reply." };
  const planBlock = await sendBlockedMessage(input.orgId);
  if (planBlock) return { ok: false, error: planBlock };

  const { data: reply } = await admin
    .from("replies")
    .select("id, lead_id, sending_account_id, message_id, references, subject, from_email, body_text, received_at")
    .eq("org_id", input.orgId)
    .eq("id", input.replyId)
    .maybeSingle();
  if (!reply) return { ok: false, error: "Reply not found." };
  if (!reply.sending_account_id) return { ok: false, error: "The inbox that received this reply was removed. Reply from your email app instead." };

  const { data: suppressed } = await admin.from("suppression_list").select("email").eq("org_id", input.orgId).eq("email", reply.from_email).maybeSingle();
  if (suppressed) return { ok: false, error: "This address is on your suppression list, so YCAReach won't email it." };

  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await admin.from("reply_messages").select("id", { count: "exact", head: true }).eq("org_id", input.orgId).gte("created_at", since);
  if ((count ?? 0) >= REPLIES_PER_HOUR) return { ok: false, error: `You've sent ${REPLIES_PER_HOUR} replies in the last hour. Try again a little later.` };

  const { data: account } = await admin
    .from("sending_accounts")
    .select(`${ACCOUNT_CONNECTION_COLUMNS}, display_name, status`)
    .eq("org_id", input.orgId)
    .eq("id", reply.sending_account_id)
    .maybeSingle();
  if (!account || account.status === "disconnected") return { ok: false, error: "The inbox that received this reply isn't connected. Reconnect it under Inboxes." };

  const subject = replySubject(reply.subject);
  const text = `${body}\n\n${quoteReply(reply.from_email, reply.received_at, reply.body_text ?? "")}`;
  const html = `${textToHtml(body)}\n<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${textToHtml(extractReplyText(reply.body_text ?? "").slice(0, 3000))}</blockquote>`;
  const id = randomUUID();
  const messageId = newMessageId(id, account.email);
  const references = [...new Set([...(reply.references ?? []), reply.message_id])].slice(-20);

  let result;
  try {
    const password = await loadAccountPassword(input.orgId, account.id);
    result = await createMailAdapter(toMailConfig(account, password), mailAdapterOptions()).send({
      fromName: account.display_name,
      to: reply.from_email,
      subject,
      text,
      html,
      messageId,
      inReplyTo: reply.message_id,
      references,
    });
  } catch (e) {
    result = { ok: false as const, error: e instanceof Error ? e.message : "Send failed" };
  }

  const now = new Date().toISOString();
  await admin.from("reply_messages").insert({
    id,
    org_id: input.orgId,
    reply_id: reply.id,
    lead_id: reply.lead_id,
    sending_account_id: account.id,
    message_id: messageId,
    in_reply_to: reply.message_id,
    references,
    to_email: reply.from_email,
    subject,
    body_text: body,
    status: result.ok ? "sent" : "failed",
    error: result.ok ? null : result.error.slice(0, 300),
    ai_drafted: !!input.aiDrafted,
    sent_by: input.userId ?? null,
    sent_at: result.ok ? now : null,
  });
  await admin.from("agent_audit_log").insert({
    org_id: input.orgId,
    actor: input.actor,
    actor_type: input.actor.startsWith("agent:") ? "agent" : "user",
    api_key_id: input.apiKeyId ?? null,
    action: "reply.send",
    target: `reply:${reply.id}`,
    payload: { to: reply.from_email, ai_drafted: !!input.aiDrafted },
    result: result.ok ? "ok" : "error",
  });
  if (!result.ok) return { ok: false, error: `Couldn't send: ${result.error}` };

  await admin.from("replies").update({ handled_at: now }).eq("id", reply.id);
  return { ok: true, id, to: reply.from_email, from: account.email };
}
