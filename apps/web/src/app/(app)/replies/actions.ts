"use server";

import { revalidatePath } from "next/cache";
import { REPLY_CLASSES, can, type ReplyClass } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const { data: outcome, error: outcomeError } = await createAdminClient().rpc("apply_reply_outcome", { p_org_id: ctx.org.id, p_reply_id: id });
  if (outcomeError) return { error: outcomeError.message };
  revalidatePath("/replies");
  revalidatePath(`/replies/${id}`);
  return { message: `Marked ${classification.replace(/_/g, " ")} (${outcome}).` };
}
