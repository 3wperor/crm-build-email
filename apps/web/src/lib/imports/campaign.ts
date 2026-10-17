import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type EnrollResult = { candidates: number; enrolled: number; skipped: number; reasons?: Record<string, number> };

const REASON_LABELS: Record<string, string> = {
  already_in_campaign: "already in this campaign",
  suppressed: "on the suppression list",
  lead_status: "replied, bounced or unsubscribed",
  invalid: "invalid address",
  verifying: "still being verified (try again in a minute)",
  risky: "risky (role address or no MX; allow in campaign settings)",
  in_other_campaign: "already in another running campaign",
};

/** "Added 12 leads. Skipped 3: 2 on the suppression list, 1 invalid address." */
export function describeEnroll(r: EnrollResult): string {
  if (r.candidates === 0) return "No leads found to add. Import or paste some first.";
  const head = `Added ${r.enrolled.toLocaleString()} lead${r.enrolled === 1 ? "" : "s"}.`;
  if (!r.skipped) return head;
  const parts = Object.entries(r.reasons ?? {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${REASON_LABELS[k] ?? k}`);
  return `${head} Skipped ${r.skipped.toLocaleString()}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}

/**
 * Enroll an import's leads into the campaign it was started from. Runs once
 * per import (after verification, or right away when auto-verify is off).
 */
export async function enrollImportIntoCampaign(orgId: string, importId: string): Promise<EnrollResult | null> {
  const admin = createAdminClient();
  const { data: imp } = await admin.from("imports").select("id, list_id, campaign_id, campaign_result").eq("org_id", orgId).eq("id", importId).maybeSingle();
  if (!imp?.campaign_id || imp.campaign_result) return null;
  let args: { p_campaign_id: string; p_list_id?: string; p_lead_ids?: string[] } = { p_campaign_id: imp.campaign_id };
  if (imp.list_id) args = { ...args, p_list_id: imp.list_id };
  else {
    const { data: leads } = await admin.from("leads").select("id").eq("org_id", orgId).eq("import_id", importId).limit(50000);
    args = { ...args, p_lead_ids: (leads ?? []).map((l) => l.id) };
  }
  const { data, error } = await admin.rpc("enroll_leads", args);
  const result: EnrollResult & { error?: string } = error ? { candidates: 0, enrolled: 0, skipped: 0, error: error.message } : (data as EnrollResult);
  await admin.from("imports").update({ campaign_result: result as never }).eq("id", importId);
  return result;
}
