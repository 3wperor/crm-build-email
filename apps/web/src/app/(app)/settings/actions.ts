"use server";

import { revalidatePath } from "next/cache";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export type SettingsState = { error?: string; ok?: boolean } | undefined;

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateOrgSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { org, role } = await getOrgContext();
  if (!can(role, "org.update")) return { error: "Only owners and admins can change workspace settings." };

  const name = String(formData.get("name") ?? "").trim();
  const physicalAddress = String(formData.get("physical_address") ?? "").trim();
  const timezone = String(formData.get("default_timezone") ?? "").trim();
  const approvalMode = String(formData.get("approval_mode") ?? "");
  const autoVerifyImports = formData.get("auto_verify_imports") === "on";
  const aiClassification = formData.get("ai_classification_enabled") === "on";

  if (!name || name.length > 120) return { error: "Name must be 1–120 characters." };
  if (!isValidTimezone(timezone)) return { error: `Unknown timezone: ${timezone}` };
  if (approvalMode !== "draft" && approvalMode !== "auto") return { error: "Invalid approval mode." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      name,
      physical_address: physicalAddress || null,
      default_timezone: timezone,
      approval_mode: approvalMode,
      auto_verify_imports: autoVerifyImports,
      ai_classification_enabled: aiClassification,
    })
    .eq("id", org.id);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
