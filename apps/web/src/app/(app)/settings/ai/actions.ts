"use server";

import { revalidatePath } from "next/cache";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { AI_MIGRATION_MISSING } from "@/lib/ai/provider";
import { friendlyError, isMissingSchema } from "@/lib/errors";
import { runAiDiagnostics, type AiCheck } from "@/lib/ai/diagnostics";
import { isSiteAdmin } from "@/lib/site-admin";

export type AiSettingsState = { error?: string; message?: string } | undefined;

const FORBIDDEN = { error: "Only owners and admins can change AI settings." };

export async function saveAiToggles(_prev: AiSettingsState, formData: FormData): Promise<AiSettingsState> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "org.update")) return FORBIDDEN;
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      ai_classification_enabled: formData.get("ai_classification_enabled") === "on",
      ai_drafts_enabled: formData.get("ai_drafts_enabled") === "on",
    })
    .eq("id", ctx.org.id);
  if (error) return { error: isMissingSchema(error) ? AI_MIGRATION_MISSING : friendlyError(error) };
  revalidatePath("/settings/ai");
  return { message: "Saved." };
}

/** Site admins only: check every link in the AI chain and report the real reasons. */
export async function checkAiSetup(): Promise<{ checks?: AiCheck[]; error?: string }> {
  const ctx = await getOrgContext();
  if (!isSiteAdmin(ctx.user.email)) return { error: "Only the site admin can run this check." };
  try {
    return { checks: await runAiDiagnostics(ctx.org.id) };
  } catch (e) {
    console.error("checkAiSetup failed:", e);
    return { error: `The check itself failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
