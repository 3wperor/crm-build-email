"use server";

import { revalidatePath } from "next/cache";
import { can, warmupSettingsSchema } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formToObject, type FieldErrors } from "@/lib/forms";
import { inngest } from "@/inngest/client";
import { warmupTickRequested } from "@/inngest/events";

export type WarmupState = { error?: string; message?: string; fieldErrors?: FieldErrors } | undefined;

async function requireManager() {
  const ctx = await getOrgContext();
  return can(ctx.role, "sending_accounts.manage") ? ctx : null;
}

/** Turns warmup on/off for one inbox. Turning it on (re)starts the ramp and clears an auto-pause (DB trigger). */
export async function toggleWarmup(formData: FormData) {
  const ctx = await requireManager();
  if (!ctx) return;
  const enable = formData.get("enable") === "true";
  const supabase = await createClient();
  const { error } = await supabase
    .from("sending_accounts")
    .update({ warmup_enabled: enable })
    .eq("org_id", ctx.org.id)
    .eq("id", String(formData.get("account_id")));
  if (error) throw new Error(error.message);
  if (enable) await inngest.send(warmupTickRequested.create({ reason: "warmup enabled" }));
  revalidatePath("/warmup");
}

export async function saveWarmupSettings(_prev: WarmupState, formData: FormData): Promise<WarmupState> {
  const ctx = await requireManager();
  if (!ctx) return { error: "Only owners and admins can change warmup settings." };
  const parsed = warmupSettingsSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: "Fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("sending_accounts")
    .update({ warmup_daily_target: parsed.data.target, warmup_ramp_step: parsed.data.rampStep, warmup_reply_rate: parsed.data.replyRate })
    .eq("org_id", ctx.org.id)
    .eq("id", String(formData.get("account_id")));
  if (error) return { error: error.message };
  revalidatePath("/warmup");
  return { message: "Saved." };
}
