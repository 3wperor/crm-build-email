"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  can,
  campaignSettingsSchema,
  nextAbGroup,
  stepSchema,
  variantSchema,
} from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, formToObject, type FieldErrors } from "@/lib/forms";
import { sendTestEmail } from "@/lib/test-email";
import { pauseCampaignFor, startCampaignFor } from "@/lib/campaigns/lifecycle";

export type CampaignState = { error?: string; message?: string; fieldErrors?: FieldErrors; problems?: string[] } | undefined;

const FORBIDDEN = { error: "You don't have permission to change campaigns." };

async function requireWriter() {
  const ctx = await getOrgContext();
  return can(ctx.role, "campaigns.write") ? ctx : null;
}

/** RLS-scoped load: proves the campaign belongs to the caller's org. */
async function loadCampaign(orgId: string, campaignId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("id, status, org_id, daily_limit, daily_limit_per_inbox, sequences(id)")
    .eq("org_id", orgId)
    .eq("id", campaignId)
    .maybeSingle();
  return data;
}

const refresh = (id: string) => revalidatePath(`/campaigns/${id}`);

// ---------------------------------------------------------------------------
// Create / delete
// ---------------------------------------------------------------------------

export async function createCampaign(_prev: CampaignState, formData: FormData): Promise<CampaignState> {
  const ctx = await requireWriter();
  if (!ctx) return FORBIDDEN;
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 200) return { error: "Name must be 1–200 characters." };

  const supabase = await createClient();
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({ org_id: ctx.org.id, name, timezone: ctx.org.default_timezone, created_by: ctx.user.id })
    .select("id")
    .single();
  if (error || !campaign) return { error: error?.message ?? "Could not create campaign" };

  // Every campaign starts with a one-step sequence and an empty variant A.
  const { data: seq } = await supabase.from("sequences").insert({ org_id: ctx.org.id, campaign_id: campaign.id }).select("id").single();
  const { data: step } = await supabase
    .from("sequence_steps")
    .insert({ org_id: ctx.org.id, sequence_id: seq!.id, step_order: 1, delay_days: 0 })
    .select("id")
    .single();
  await supabase.from("email_variants").insert({ org_id: ctx.org.id, step_id: step!.id, ab_group: "A", subject: "", body: "" });

  // Attach every active inbox by default; adjustable in settings.
  const { data: inboxes } = await supabase.from("sending_accounts").select("id").eq("org_id", ctx.org.id).eq("status", "active");
  if (inboxes?.length) {
    await supabase
      .from("campaign_sending_accounts")
      .insert(inboxes.map((i) => ({ org_id: ctx.org.id, campaign_id: campaign.id, sending_account_id: i.id })));
  }

  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}`);
}

export async function deleteCampaign(formData: FormData) {
  const ctx = await requireWriter();
  if (!ctx) return;
  const id = String(formData.get("campaign_id"));
  const c = await loadCampaign(ctx.org.id, id);
  if (!c || c.status === "active") return;
  const supabase = await createClient();
  await supabase.from("campaigns").delete().eq("org_id", ctx.org.id).eq("id", id);
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateCampaignSettings(_prev: CampaignState, formData: FormData): Promise<CampaignState> {
  const ctx = await requireWriter();
  if (!ctx) return FORBIDDEN;
  const id = String(formData.get("campaign_id"));
  if (!(await loadCampaign(ctx.org.id, id))) return { error: "Campaign not found" };

  const parsed = campaignSettingsSchema.safeParse({
    ...formToObject(formData),
    sendDays: formData.getAll("sendDays").map(String),
    accountIds: formData.getAll("accountIds").map(String),
  });
  if (!parsed.success) return { error: "Fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const s = parsed.data;
  if (s.approvalMode === "auto" && !can(ctx.role, "org.update")) {
    return { error: "Only owners and admins can enable full-auto for the AI agent." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("campaigns")
    .update({
      name: s.name,
      timezone: s.timezone,
      send_window_start: s.sendWindowStart,
      send_window_end: s.sendWindowEnd,
      send_days: s.sendDays,
      daily_limit: s.dailyLimit,
      daily_limit_per_inbox: s.dailyLimitPerInbox,
      include_risky: s.includeRisky,
      track_opens: s.trackOpens,
      track_clicks: s.trackClicks,
      auto_promote_winner: s.autoPromoteWinner,
      approval_mode: s.approvalMode,
    })
    .eq("org_id", ctx.org.id)
    .eq("id", id);
  if (error) return { error: error.message };

  // Sync attached inboxes (only inboxes from this org — RLS + composite FK enforce it too).
  const { data: current } = await supabase.from("campaign_sending_accounts").select("sending_account_id").eq("campaign_id", id);
  const currentIds = new Set((current ?? []).map((c) => c.sending_account_id));
  const wanted = new Set(s.accountIds);
  const toRemove = [...currentIds].filter((x) => !wanted.has(x));
  const toAdd = [...wanted].filter((x) => !currentIds.has(x));
  if (toRemove.length) await supabase.from("campaign_sending_accounts").delete().eq("campaign_id", id).in("sending_account_id", toRemove);
  if (toAdd.length) {
    const { error: addError } = await supabase
      .from("campaign_sending_accounts")
      .insert(toAdd.map((sending_account_id) => ({ org_id: ctx.org.id, campaign_id: id, sending_account_id })));
    if (addError) return { error: addError.message };
  }

  refresh(id);
  return { message: "Settings saved." };
}

// ---------------------------------------------------------------------------
// Sequence editing
// ---------------------------------------------------------------------------

export async function addStep(formData: FormData) {
  const ctx = await requireWriter();
  if (!ctx) return;
  const id = String(formData.get("campaign_id"));
  const c = await loadCampaign(ctx.org.id, id);
  const seqId = c?.sequences[0]?.id;
  if (!seqId) return;
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("sequence_steps")
    .select("step_order")
    .eq("sequence_id", seqId)
    .order("step_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: step } = await supabase
    .from("sequence_steps")
    .insert({ org_id: ctx.org.id, sequence_id: seqId, step_order: (last?.step_order ?? 0) + 1, delay_days: last ? 3 : 0 })
    .select("id")
    .single();
  // Empty subject on a follow-up = reply in the same thread ("Re: …").
  if (step) await supabase.from("email_variants").insert({ org_id: ctx.org.id, step_id: step.id, ab_group: "A", subject: "", body: "" });
  refresh(id);
}

export async function updateStep(_prev: CampaignState, formData: FormData): Promise<CampaignState> {
  const ctx = await requireWriter();
  if (!ctx) return FORBIDDEN;
  const parsed = stepSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: "Delay must be 0–365 days and 0–23 hours." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("sequence_steps")
    .update({ delay_days: parsed.data.delayDays, delay_hours: parsed.data.delayHours })
    .eq("org_id", ctx.org.id)
    .eq("id", String(formData.get("step_id")));
  if (error) return { error: error.message };
  refresh(String(formData.get("campaign_id")));
  return { message: "Saved." };
}

export async function deleteStep(formData: FormData) {
  const ctx = await requireWriter();
  if (!ctx) return;
  const campaignId = String(formData.get("campaign_id"));
  const stepId = String(formData.get("step_id"));
  const c = await loadCampaign(ctx.org.id, campaignId);
  if (!c || c.status === "active") return; // structure changes only while not sending
  const supabase = await createClient();
  const { count } = await supabase.from("sends").select("id", { count: "exact", head: true }).eq("step_id", stepId);
  if (count) return; // keep history intact
  await supabase.from("sequence_steps").delete().eq("org_id", ctx.org.id).eq("id", stepId);
  // Renumber remaining steps 1..n (ascending, so no unique collisions).
  const { data: rest } = await supabase.from("sequence_steps").select("id, step_order").eq("sequence_id", c.sequences[0]!.id).order("step_order");
  for (const [i, s] of (rest ?? []).entries()) {
    if (s.step_order !== i + 1) await supabase.from("sequence_steps").update({ step_order: i + 1 }).eq("id", s.id);
  }
  refresh(campaignId);
}

export async function saveVariant(_prev: CampaignState, formData: FormData): Promise<CampaignState> {
  const ctx = await requireWriter();
  if (!ctx) return FORBIDDEN;
  const parsed = variantSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: "Invalid variant", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("email_variants")
    .update({ subject: parsed.data.subject, body: parsed.data.body, weight: parsed.data.weight, is_active: parsed.data.isActive })
    .eq("org_id", ctx.org.id)
    .eq("id", String(formData.get("variant_id")));
  if (error) return { error: error.message };
  refresh(String(formData.get("campaign_id")));
  return { message: "Saved." };
}

export async function addVariant(formData: FormData) {
  const ctx = await requireWriter();
  if (!ctx) return;
  const stepId = String(formData.get("step_id"));
  const supabase = await createClient();
  const { data: existing } = await supabase.from("email_variants").select("ab_group, subject, body").eq("org_id", ctx.org.id).eq("step_id", stepId).order("ab_group");
  if (!existing) return;
  const first = existing[0];
  await supabase.from("email_variants").insert({
    org_id: ctx.org.id,
    step_id: stepId,
    ab_group: nextAbGroup(existing.map((v) => v.ab_group)),
    subject: first?.subject ?? "",
    body: first?.body ?? "",
    weight: 100,
  });
  refresh(String(formData.get("campaign_id")));
}

export async function deleteVariant(formData: FormData) {
  const ctx = await requireWriter();
  if (!ctx) return;
  const supabase = await createClient();
  const variantId = String(formData.get("variant_id"));
  const { data: v } = await supabase.from("email_variants").select("step_id").eq("org_id", ctx.org.id).eq("id", variantId).maybeSingle();
  if (!v) return;
  const { count } = await supabase.from("email_variants").select("id", { count: "exact", head: true }).eq("step_id", v.step_id);
  if ((count ?? 0) <= 1) return; // a step always keeps one variant
  await supabase.from("email_variants").delete().eq("id", variantId);
  refresh(String(formData.get("campaign_id")));
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function enrollLeads(_prev: CampaignState, formData: FormData): Promise<CampaignState> {
  const ctx = await requireWriter();
  if (!ctx) return FORBIDDEN;
  const id = String(formData.get("campaign_id"));
  const source = String(formData.get("source") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enroll_leads", {
    p_campaign_id: id,
    ...(source === "all" ? { p_all_eligible: true } : { p_list_id: source }),
  });
  if (error) return { error: error.message };
  const r = data as { enrolled: number; skipped: number };
  refresh(id);
  return {
    message:
      `Added ${r.enrolled.toLocaleString()} lead(s).` +
      (r.skipped ? ` Skipped ${r.skipped.toLocaleString()} (already added, in another active campaign, suppressed, invalid, risky or replied).` : ""),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function startCampaign(_prev: CampaignState, formData: FormData): Promise<CampaignState> {
  const ctx = await requireWriter();
  if (!ctx) return FORBIDDEN;
  const id = String(formData.get("campaign_id"));
  const r = await startCampaignFor(ctx.org.id, id);
  if (!r.ok) return { error: r.error, problems: r.problems };
  refresh(id);
  revalidatePath("/campaigns");
  return { message: r.message };
}

export async function pauseCampaign(_prev: CampaignState, formData: FormData): Promise<CampaignState> {
  const ctx = await requireWriter();
  if (!ctx) return FORBIDDEN;
  const id = String(formData.get("campaign_id"));
  const r = await pauseCampaignFor(ctx.org.id, id);
  if (!r.ok) return { error: r.error };
  refresh(id);
  revalidatePath("/campaigns");
  return { message: r.message };
}

// ---------------------------------------------------------------------------
// Test email
// ---------------------------------------------------------------------------

export type TestEmailState =
  | { ok: true; message: string }
  | { ok: false; error: string; hint?: string }
  | undefined;

export async function sendTestEmailAction(_prev: TestEmailState, formData: FormData): Promise<TestEmailState> {
  const ctx = await requireWriter();
  if (!ctx) return { ok: false, error: FORBIDDEN.error };
  const f = formToObject(formData);
  const result = await sendTestEmail({
    orgId: ctx.org.id,
    actor: `user:${ctx.user.id}`,
    userId: ctx.user.id,
    to: f.to ?? "",
    accountId: f.account_id ?? "",
    subject: f.subject ?? "",
    body: f.body ?? "",
    variantId: f.variant_id || null,
    leadId: f.lead_id || null,
    threadSubject: f.thread_subject || null,
  });
  return result.ok
    ? { ok: true, message: `Sent "${result.subject}" to ${result.to} from ${result.from}.` }
    : { ok: false, error: result.error, hint: result.hint };
}

// ---------------------------------------------------------------------------
// A/B winners
// ---------------------------------------------------------------------------

/** Promote a variant (it gets every new send for its step) or clear the winner. Audited by the RPC. */
export async function setVariantWinner(formData: FormData) {
  const ctx = await requireWriter();
  if (!ctx) return;
  const campaignId = String(formData.get("campaign_id"));
  const variantId = String(formData.get("variant_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_variant_winner", {
    p_org_id: ctx.org.id,
    p_step_id: String(formData.get("step_id")),
    // null clears the winner; the generated type can't express a nullable argument.
    p_variant_id: (variantId || null) as string,
    p_reason: String(formData.get("reason") ?? "") || "manual",
  });
  if (error) throw new Error(error.message);
  refresh(campaignId);
}
