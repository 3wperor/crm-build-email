import "server-only";
import { campaignStartProblems } from "@crm/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/inngest/client";
import { schedulerTickRequested } from "@/inngest/events";

export type LifecycleResult = { ok: true; message: string } | { ok: false; error: string; problems?: string[] };

/** Start or resume a campaign after the readiness checks. Shared by the UI and the agent. Caller checks permissions. */
export async function startCampaignFor(orgId: string, id: string): Promise<LifecycleResult> {
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("campaigns")
    .select(
      "id, status, daily_limit, daily_limit_per_inbox, sequences(sequence_steps(step_order, email_variants(subject, body, is_active, weight))), campaign_sending_accounts(sending_accounts(status, health))",
    )
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!c) return { ok: false, error: "Campaign not found" };
  if (!["draft", "paused"].includes(c.status)) return { ok: false, error: `Campaign is ${c.status}.` };

  const [{ data: org }, { count: enrolled }] = await Promise.all([
    admin.from("organizations").select("physical_address").eq("id", orgId).single(),
    // Any enrollment counts: resuming a campaign whose leads have all finished is harmless.
    admin.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
  ]);
  const problems = campaignStartProblems({
    steps: (c.sequences[0]?.sequence_steps ?? []).map((s) => ({ step_order: s.step_order, variants: s.email_variants })),
    inboxes: c.campaign_sending_accounts.map((l) => l.sending_accounts),
    physicalAddress: org?.physical_address ?? null,
    enrolled: enrolled ?? 0,
    dailyLimit: c.daily_limit,
    dailyLimitPerInbox: c.daily_limit_per_inbox,
  });
  if (problems.length) return { ok: false, error: "This campaign isn't ready to start yet.", problems };

  const now = new Date().toISOString();
  await admin.from("campaigns").update({ status: "active", started_at: now, last_error: null }).eq("id", id);
  await admin.from("campaign_leads").update({ next_send_at: now }).eq("campaign_id", id).in("status", ["queued", "active"]).is("next_send_at", null);
  await inngest.send(schedulerTickRequested.create({ reason: `campaign ${id} started` })).catch(() => {});
  return { ok: true, message: c.status === "paused" ? "Campaign resumed." : "Campaign started." };
}

/** Pause a running campaign and pull back anything scheduled but not yet sending. */
export async function pauseCampaignFor(orgId: string, id: string): Promise<LifecycleResult> {
  const admin = createAdminClient();
  const { data: c } = await admin.from("campaigns").select("id, status").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (!c) return { ok: false, error: "Campaign not found" };
  if (c.status !== "active") return { ok: false, error: "Campaign isn't running." };
  await admin.from("campaigns").update({ status: "paused" }).eq("id", id);
  const { data: cancelled } = await admin
    .from("sends")
    .update({ status: "cancelled", error: "campaign_paused" })
    .eq("campaign_id", id)
    .eq("status", "scheduled")
    .select("campaign_lead_id");
  const leadIds = (cancelled ?? []).map((s) => s.campaign_lead_id);
  if (leadIds.length) await admin.from("campaign_leads").update({ next_send_at: new Date().toISOString() }).in("id", leadIds);
  return { ok: true, message: "Campaign paused." };
}
