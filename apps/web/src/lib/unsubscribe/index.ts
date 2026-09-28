import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendIdFromUnsubscribeToken } from "@/lib/links";

export type UnsubscribeTarget = { orgId: string; sendId: string; leadId: string; email: string; orgName: string };

export async function resolveUnsubscribe(token: string): Promise<UnsubscribeTarget | null> {
  const sendId = sendIdFromUnsubscribeToken(token);
  if (!sendId) return null;
  const { data } = await createAdminClient()
    .from("sends")
    .select("id, org_id, lead_id, leads!inner(email), campaigns!inner(organizations!inner(name))")
    .eq("id", sendId)
    .maybeSingle();
  if (!data) return null;
  return { orgId: data.org_id, sendId: data.id, leadId: data.lead_id, email: data.leads.email, orgName: data.campaigns.organizations.name };
}

/** Idempotent: suppress the address org-wide (trigger stops every sequence) and log the event once. */
export async function unsubscribe(target: UnsubscribeTarget, via: "link" | "one-click"): Promise<void> {
  const admin = createAdminClient();
  const { data: inserted } = await admin
    .from("suppression_list")
    .upsert(
      { org_id: target.orgId, email: target.email, reason: "unsubscribe", source: `send:${target.sendId}` },
      { onConflict: "org_id,email", ignoreDuplicates: true },
    )
    .select("id");
  if (inserted?.length) {
    await admin.from("events").insert({ org_id: target.orgId, send_id: target.sendId, type: "unsubscribe", meta: { via } });
    await admin.rpc("stop_lead_sequences", { p_org_id: target.orgId, p_lead_id: target.leadId, p_status: "unsubscribed", p_reason: "unsubscribe" });
  }
}
