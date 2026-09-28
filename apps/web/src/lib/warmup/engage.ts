import "server-only";
import { randomUUID } from "node:crypto";
import { composeWarmupReply, engagementFor, shouldReply } from "@crm/core";
import type { EngageAction, FetchedMessage } from "@crm/mail";
import type { createAdminClient } from "@/lib/supabase/admin";
import { newMessageId } from "@/lib/scheduler/config";
import { warmupReplyDelaySeconds } from "./config";
import type { PlannedWarmup } from "./planner";

type Admin = ReturnType<typeof createAdminClient>;

type Received = {
  first: boolean;
  id: string;
  org_id?: string;
  from_account_id?: string;
  thread_root_id?: string;
  thread_length?: number;
  subject?: string;
  message_id?: string;
  references?: string[];
};

/**
 * A warmup email reached one of our inboxes. Returns null when it isn't one we
 * queued (then it is processed like any other mail). Otherwise the mailbox
 * actions to apply (open, maybe star, move out of spam) and, the first time
 * it is seen, maybe a reply to queue.
 */
export async function handleWarmupMessage(
  admin: Admin,
  account: { id: string; org_id: string },
  msg: FetchedMessage,
  messageId: string,
): Promise<{ engage: EngageAction; reply: PlannedWarmup | null } | null> {
  const { data, error } = await admin.rpc("record_warmup_received", {
    p_account_id: account.id,
    p_message_id: messageId,
    p_in_spam: msg.mailbox.toUpperCase() !== "INBOX",
  });
  if (error) throw new Error(error.message);
  const r = data as Received | null;
  if (!r) return null;

  const engage: EngageAction = { mailbox: msg.mailbox, uid: msg.uid, ...engagementFor(messageId) };
  if (!r.first) return { engage, reply: null };

  const { data: me } = await admin
    .from("sending_accounts")
    .select("email, display_name, warmup_enabled, warmup_reply_rate, status")
    .eq("id", account.id)
    .single();
  const { data: them } = await admin.from("sending_accounts").select("display_name").eq("id", r.from_account_id!).maybeSingle();
  if (!me || !them || !me.warmup_enabled || me.status !== "active" || !shouldReply(messageId, me.warmup_reply_rate, r.thread_length!)) {
    return { engage, reply: null };
  }

  const id = randomUUID();
  const text = composeWarmupReply(id, { subject: r.subject!, toName: them.display_name, fromName: me.display_name });
  const scheduledAt = new Date(Date.now() + warmupReplyDelaySeconds() * 1000).toISOString();
  const { error: insertError } = await admin.from("warmup_messages").insert({
    id,
    org_id: account.org_id,
    from_account_id: account.id,
    to_account_id: r.from_account_id!,
    thread_root_id: r.thread_root_id!,
    thread_length: r.thread_length! + 1,
    is_reply: true,
    message_id: newMessageId(id, me.email),
    in_reply_to: r.message_id!,
    references: [...(r.references ?? []), r.message_id!].slice(-10),
    subject: text.subject,
    body_text: text.text,
    scheduled_at: scheduledAt,
  });
  if (insertError) throw new Error(insertError.message);
  await admin.from("warmup_messages").update({ replied: true }).eq("id", r.id);
  return { engage, reply: { orgId: account.org_id, id, accountId: account.id, scheduledAt } };
}
