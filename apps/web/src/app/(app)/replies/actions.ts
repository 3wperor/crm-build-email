"use server";

import { revalidatePath } from "next/cache";
import { REPLY_CLASSES, can, type ReplyClass } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateReplyDraft } from "@/lib/replies/drafts";
import { sendReplyMessage } from "@/lib/replies/send-reply";
import { statusLabel } from "@/lib/labels";

export type ReclassifyState = { error?: string; message?: string } | undefined;

/** Manual override; re-applies the outcome (e.g. neutral → unsubscribe suppresses). */
export async function reclassifyReply(_prev: ReclassifyState, formData: FormData): Promise<ReclassifyState> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "replies.classify")) return { error: "You don't have permission to reclassify replies." };
  const id = String(formData.get("reply_id"));
  const classification = String(formData.get("classification")) as ReplyClass;
  if (!REPLY_CLASSES.includes(classification)) return { error: "Unknown classification." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("replies")
    .update({ classification, classification_source: "manual" })
    .eq("org_id", ctx.org.id)
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Reply not found." };

  const { error: outcomeError } = await createAdminClient().rpc("apply_reply_outcome", { p_org_id: ctx.org.id, p_reply_id: id });
  if (outcomeError) return { error: outcomeError.message };
  revalidatePath("/replies");
  revalidatePath(`/replies/${id}`);
  return { message: `Marked as "${statusLabel("reply", classification)}".` };
}

// ---------------------------------------------------------------------------
// Answering replies from YCAReach
// ---------------------------------------------------------------------------

export type ReplyComposerState = { error?: string; message?: string; sent?: boolean } | undefined;

export async function sendReplyAction(_prev: ReplyComposerState, formData: FormData): Promise<ReplyComposerState> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "replies.send")) return { error: "You don't have permission to send replies." };
  const replyId = String(formData.get("reply_id"));
  const res = await sendReplyMessage({
    orgId: ctx.org.id,
    replyId,
    body: String(formData.get("body") ?? ""),
    actor: `user:${ctx.user.id}`,
    userId: ctx.user.id,
    aiDrafted: formData.get("ai_drafted") === "1",
  });
  if (!res.ok) return { error: res.error };
  revalidatePath("/replies");
  revalidatePath(`/replies/${replyId}`);
  revalidatePath("/", "layout");
  return { sent: true, message: `Sent to ${res.to} from ${res.from}.` };
}

export async function redraftReplyAction(_prev: ReplyComposerState, formData: FormData): Promise<ReplyComposerState> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "replies.send")) return { error: "You don't have permission to send replies." };
  const replyId = String(formData.get("reply_id"));
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 1000) || null;
  // RLS check that the reply is in this workspace before spending AI on it.
  const supabase = await createClient();
  const { data } = await supabase.from("replies").select("id").eq("org_id", ctx.org.id).eq("id", replyId).maybeSingle();
  if (!data) return { error: "Reply not found." };
  const res = await generateReplyDraft(ctx.org.id, replyId, { notes, force: true });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/replies/${replyId}`);
  return { message: "New draft ready." };
}

export async function setReplyHandled(formData: FormData) {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "replies.send")) return;
  const replyId = String(formData.get("reply_id"));
  const handled = formData.get("handled") === "1";
  const supabase = await createClient();
  await supabase
    .from("replies")
    .update({ handled_at: handled ? new Date().toISOString() : null })
    .eq("org_id", ctx.org.id)
    .eq("id", replyId);
  revalidatePath("/replies");
  revalidatePath(`/replies/${replyId}`);
  revalidatePath("/", "layout");
}
