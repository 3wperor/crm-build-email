"use server";

import { revalidatePath } from "next/cache";
import { can, isValidEmailSyntax, normalizeEmail } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export type SuppressionState = { error?: string; message?: string; added?: number; already?: number; invalid?: number } | undefined;

const MAX_BATCH = 5000;

export async function addSuppressions(_prev: SuppressionState, formData: FormData): Promise<SuppressionState> {
  const raw = String(formData.get("emails") ?? "");
  return suppress(raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean));
}

/** From a spreadsheet upload: the browser extracts the email column and sends it in batches. */
export async function addSuppressionBatch(emails: string[]): Promise<SuppressionState> {
  if (!Array.isArray(emails)) return { error: "Invalid upload." };
  return suppress(emails.map(String).slice(0, MAX_BATCH + 1));
}

async function suppress(tokens: string[]): Promise<SuppressionState> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "suppression.add")) return { error: "You don't have permission to add suppressions." };
  if (tokens.length === 0) return { error: "Paste at least one email address." };
  if (tokens.length > MAX_BATCH) return { error: `Max ${MAX_BATCH} addresses at a time.` };

  const valid = [...new Set(tokens.filter(isValidEmailSyntax).map(normalizeEmail))];
  const invalid = tokens.length - tokens.filter(isValidEmailSyntax).length;
  if (valid.length === 0) return { error: "No valid email addresses found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppression_list")
    .upsert(
      valid.map((email) => ({ org_id: ctx.org.id, email, reason: "manual", source: `user:${ctx.user.id}` })),
      { onConflict: "org_id,email", ignoreDuplicates: true },
    )
    .select("id");
  if (error) return { error: error.message };

  revalidatePath("/suppression");
  revalidatePath("/leads");
  const added = data?.length ?? 0;
  const parts = [`Added ${added}`];
  if (valid.length - added > 0) parts.push(`${valid.length - added} already suppressed`);
  if (invalid > 0) parts.push(`${invalid} invalid skipped`);
  return { message: parts.join(" · ") + ".", added, already: valid.length - added, invalid };
}

export async function removeSuppression(formData: FormData) {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "suppression.remove")) return;
  const supabase = await createClient();
  await supabase.from("suppression_list").delete().eq("org_id", ctx.org.id).eq("id", String(formData.get("id")));
  revalidatePath("/suppression");
  revalidatePath("/leads");
}
