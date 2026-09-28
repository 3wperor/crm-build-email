import "server-only";
import { randomUUID } from "node:crypto";
import {
  buildEmail,
  checkSend,
  effectiveSentToday,
  nextDayWindowOpening,
  pickInbox,
  pickVariant,
  startOfLocalDay,
  type InboxCandidate,
} from "@crm/core";
import type { TablesUpdate } from "@crm/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribeUrls } from "@/lib/links";
import { campaignWindow, newMessageId } from "./config";

export type SendRequest = { orgId: string; sendId: string; accountId: string };

const PLAN_BATCH = 100;

type Admin = ReturnType<typeof createAdminClient>;

/** Plans every active campaign in orgs that aren't paused. Returns send jobs to dispatch. */
export async function planAll(now = new Date()): Promise<{ campaigns: number; requests: SendRequest[] }> {
  const admin = createAdminClient();
  const { data: campaigns, error } = await admin
    .from("campaigns")
    .select("id, organizations!inner(sending_paused)")
    .eq("status", "active")
    .eq("organizations.sending_paused", false)
    .limit(200);
  if (error) throw new Error(error.message);

  const requests: SendRequest[] = [];
  for (const c of campaigns ?? []) {
    requests.push(...(await planCampaign(admin, c.id, now)));
  }
  return { campaigns: campaigns?.length ?? 0, requests };
}

export async function setEnrollment(admin: Admin, id: string, patch: TablesUpdate<"campaign_leads">) {
  const { error } = await admin.from("campaign_leads").update(patch).eq("id", id);
  if (error) throw new Error(`enrollment ${id}: ${error.message}`);
}

/**
 * Turns due enrollments of one campaign into scheduled sends:
 * guard → caps → inbox → variant → render → insert send → dispatch.
 */
export async function planCampaign(admin: Admin, campaignId: string, now = new Date()): Promise<SendRequest[]> {
  const { data: campaign, error } = await admin
    .from("campaigns")
    .select(
      "*, organizations!inner(id, sending_paused, physical_address, default_timezone), sequences(id, sequence_steps(id, step_order, delay_days, delay_hours, email_variants(id, subject, body, weight, is_active, is_winner)))",
    )
    .eq("id", campaignId)
    .single();
  if (error || !campaign) throw new Error(error?.message ?? "campaign not found");
  const org = campaign.organizations;
  if (campaign.status !== "active" || org.sending_paused) return [];

  const window = campaignWindow(campaign);
  // One sequence per campaign (the FK is composite, so PostgREST embeds it as an array).
  const steps = [...(campaign.sequences[0]?.sequence_steps ?? [])].sort((a, b) => a.step_order - b.step_order);

  const { data: due, error: dueError } = await admin
    .from("campaign_leads")
    .select(
      "id, lead_id, status, current_step_order, sending_account_id, thread_subject, thread_message_id, last_message_id, leads!inner(id, email, first_name, last_name, company, title, custom_json, status, verification_status)",
    )
    .eq("campaign_id", campaignId)
    .in("status", ["queued", "active"])
    .lte("next_send_at", now.toISOString())
    .order("next_send_at")
    .limit(PLAN_BATCH);
  if (dueError) throw new Error(dueError.message);
  if (!due?.length) return [];

  // Inboxes attached to the campaign and today's usage.
  const { data: links } = await admin
    .from("campaign_sending_accounts")
    .select("sending_accounts!inner(id, email, display_name, status, health, daily_cap, sent_today, sent_today_date, timezone)")
    .eq("campaign_id", campaignId);
  const accounts = (links ?? []).map((l) => l.sending_accounts);
  if (accounts.length === 0) {
    await admin.from("campaigns").update({ last_error: "No inboxes attached to this campaign" }).eq("id", campaignId);
    return [];
  }
  const accountIds = accounts.map((a) => a.id);
  const dayStart = startOfLocalDay(now, campaign.timezone).toISOString();

  const [{ data: claimedToday }, { data: inflight }, { data: suppressed }] = await Promise.all([
    admin.from("sends").select("sending_account_id").eq("campaign_id", campaignId).gte("claimed_at", dayStart),
    admin.from("sends").select("campaign_id, campaign_lead_id, sending_account_id").in("status", ["scheduled", "sending"]).in("sending_account_id", accountIds),
    admin.from("suppression_list").select("email").eq("org_id", org.id).in("email", due.map((d) => d.leads.email)),
  ]);
  const suppressedSet = new Set((suppressed ?? []).map((s) => s.email));
  const inflightLeads = new Set((inflight ?? []).map((s) => s.campaign_lead_id));
  const countBy = <T,>(rows: T[] | null, key: (r: T) => string | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const campaignTodayByAccount = countBy(claimedToday, (r) => r.sending_account_id);
  const campaignInflightByAccount = countBy((inflight ?? []).filter((s) => s.campaign_id === campaignId), (r) => r.sending_account_id);
  const inflightByAccount = countBy(inflight, (r) => r.sending_account_id);
  let campaignRemaining =
    campaign.daily_limit - (claimedToday?.length ?? 0) - (inflight ?? []).filter((s) => s.campaign_id === campaignId).length;

  const candidates: (InboxCandidate & { email: string; name: string | null })[] = accounts.map((a) => ({
    id: a.id,
    email: a.email,
    name: a.display_name,
    status: a.status,
    health: a.health,
    remaining: Math.min(
      a.daily_cap - effectiveSentToday(a, now, org.default_timezone) - (inflightByAccount.get(a.id) ?? 0),
      campaign.daily_limit_per_inbox - (campaignTodayByAccount.get(a.id) ?? 0) - (campaignInflightByAccount.get(a.id) ?? 0),
    ),
  }));

  const requests: SendRequest[] = [];
  const nextDay = nextDayWindowOpening(now, window).toISOString();

  for (const e of due) {
    if (inflightLeads.has(e.id)) continue;
    const lead = e.leads;

    const step = steps.find((s) => s.step_order > e.current_step_order);
    if (!step) {
      await setEnrollment(admin, e.id, { status: "completed", next_send_at: null });
      continue;
    }

    const guard = checkSend({
      now,
      orgPaused: org.sending_paused,
      campaignStatus: campaign.status,
      enrollmentStatus: e.status,
      leadStatus: lead.status,
      verificationStatus: lead.verification_status,
      includeRisky: campaign.include_risky,
      suppressed: suppressedSet.has(lead.email),
      window,
    });
    if (!guard.ok) {
      if (guard.action === "stop") await setEnrollment(admin, e.id, { status: guard.enrollmentStatus, stopped_reason: guard.reason, next_send_at: null });
      else if (guard.action === "defer") await setEnrollment(admin, e.id, { next_send_at: guard.retryAt.toISOString() });
      continue;
    }

    if (campaignRemaining <= 0) {
      await setEnrollment(admin, e.id, { next_send_at: nextDay });
      continue;
    }

    const inboxId = pickInbox(candidates, e.sending_account_id);
    if (!inboxId) {
      const anyUsable = candidates.some((c) => c.status === "active" && c.health !== "failing");
      if (!anyUsable) await admin.from("campaigns").update({ last_error: "No healthy active inbox available" }).eq("id", campaignId);
      // Out of capacity today (or sticky inbox full): try again tomorrow; unhealthy inboxes: in 30 minutes.
      await setEnrollment(admin, e.id, { next_send_at: anyUsable ? nextDay : new Date(now.getTime() + 30 * 60_000).toISOString() });
      continue;
    }
    const inbox = candidates.find((c) => c.id === inboxId)!;

    const variant = pickVariant(step.email_variants, `${lead.id}:${step.id}`);
    if (!variant || (!variant.subject.trim() && step.step_order === 1) || !variant.body.trim()) {
      await setEnrollment(admin, e.id, { status: "failed", stopped_reason: "no_usable_variant", next_send_at: null });
      await admin.from("campaigns").update({ last_error: `Step ${step.step_order} has no usable variant` }).eq("id", campaignId);
      continue;
    }

    const sendId = randomUUID();
    const urls = unsubscribeUrls(sendId);
    const email = buildEmail({
      subject: variant.subject,
      body: variant.body,
      ctx: { lead: { ...lead, custom_json: lead.custom_json as Record<string, unknown> }, sender: { name: inbox.name, email: inbox.email } },
      threadSubject: e.thread_subject,
      unsubscribeUrl: urls.page,
      physicalAddress: org.physical_address,
    });

    const references = [e.thread_message_id, e.last_message_id].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
    const { error: insertError } = await admin.from("sends").insert({
      id: sendId,
      org_id: org.id,
      campaign_id: campaignId,
      campaign_lead_id: e.id,
      lead_id: lead.id,
      step_id: step.id,
      variant_id: variant.id,
      sending_account_id: inbox.id,
      status: "scheduled",
      message_id: newMessageId(sendId, inbox.email),
      in_reply_to: e.last_message_id,
      references,
      subject: email.subject,
      body_text: email.text,
      body_html: email.html,
      scheduled_at: now.toISOString(),
    });
    if (insertError) {
      // 23505: a live send for this step already exists (race with another tick) — skip.
      if (insertError.code === "23505") continue;
      throw new Error(insertError.message);
    }

    await setEnrollment(admin, e.id, { status: "active", sending_account_id: inbox.id, next_send_at: null });
    inbox.remaining -= 1;
    campaignRemaining -= 1;
    requests.push({ orgId: org.id, sendId, accountId: inbox.id });
  }

  if (requests.length) await admin.from("campaigns").update({ last_error: null }).eq("id", campaignId);
  return requests;
}
