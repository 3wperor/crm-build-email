import "server-only";
import { checkSend, computeNextSendAt, nextDayWindowOpening } from "@crm/core";
import { createMailAdapter } from "@crm/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribeUrls } from "@/lib/links";
import { loadAccountPassword, mailAdapterOptions, toMailConfig, ACCOUNT_CONNECTION_COLUMNS } from "@/lib/sending-accounts";
import { campaignWindow, MAX_SEND_ATTEMPTS, RETRY_BACKOFF_MS, sendGap } from "./config";
import { setEnrollment } from "./planner";

export type AttemptResult =
  | { kind: "wait"; until: string; reason: string }
  | { kind: "done"; outcome: "sent" | "skipped" | "stopped" | "deferred" | "held" | "bounced" | "failed"; detail?: string };

/**
 * One attempt to deliver a scheduled send. Re-runs every guard right before
 * SMTP (kill switch, suppression, lead state, window), then reserves a slot
 * atomically (caps + pacing) and sends. Idempotent: anything not in
 * `scheduled` state is left alone, so retries can never double-send.
 */
export async function attemptSend(orgId: string, sendId: string, now = new Date()): Promise<AttemptResult> {
  const admin = createAdminClient();
  const { data: send, error } = await admin
    .from("sends")
    .select(
      "id, status, campaign_lead_id, lead_id, step_id, sending_account_id, message_id, in_reply_to, references, subject, body_text, body_html, " +
        "campaigns!inner(id, status, timezone, send_window_start, send_window_end, send_days, include_risky, organizations!inner(sending_paused)), " +
        "leads!inner(email, status, verification_status), campaign_leads!inner(status, current_step_order), sequence_steps(step_order, sequence_id)",
    )
    .eq("org_id", orgId)
    .eq("id", sendId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!send) return { kind: "done", outcome: "skipped", detail: "send not found" };

  const s = send as unknown as SendRow;
  const window = campaignWindow(s.campaigns);

  // A previous attempt crashed after handing the message to SMTP: never resend.
  if (s.status === "sending") {
    const next = await nextStepAt(s, now);
    await admin.rpc("complete_send", {
      p_org_id: orgId,
      p_send_id: sendId,
      p_error: "outcome_unknown: worker restarted after SMTP handoff",
      ...(next ? { p_next_send_at: next.toISOString() } : {}), // omitted = last step
    });
    return { kind: "done", outcome: "sent", detail: "outcome unknown" };
  }
  if (s.status !== "scheduled") return { kind: "done", outcome: "skipped", detail: s.status };

  const { count: suppressed } = await admin
    .from("suppression_list")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("email", s.leads.email);

  const guard = checkSend({
    now,
    orgPaused: s.campaigns.organizations.sending_paused,
    campaignStatus: s.campaigns.status,
    enrollmentStatus: s.campaign_leads.status,
    leadStatus: s.leads.status,
    verificationStatus: s.leads.verification_status,
    includeRisky: s.campaigns.include_risky,
    suppressed: (suppressed ?? 0) > 0,
    window,
  });
  if (!guard.ok) {
    await cancel(admin, sendId, guard.reason);
    if (guard.action === "stop") {
      await setEnrollment(admin, s.campaign_lead_id, { status: guard.enrollmentStatus, stopped_reason: guard.reason, next_send_at: null });
      return { kind: "done", outcome: "stopped", detail: guard.reason };
    }
    // hold: re-planned as soon as the campaign/org resumes; defer: at retryAt.
    await setEnrollment(admin, s.campaign_lead_id, {
      next_send_at: guard.action === "defer" ? guard.retryAt.toISOString() : now.toISOString(),
    });
    return { kind: "done", outcome: guard.action === "defer" ? "deferred" : "held", detail: guard.reason };
  }

  const gap = sendGap();
  const { data: slot, error: slotError } = await admin.rpc("reserve_send_slot", {
    p_org_id: orgId,
    p_send_id: sendId,
    p_min_gap_s: gap.minSeconds,
    p_max_gap_s: gap.maxSeconds,
  });
  if (slotError) throw new Error(slotError.message);
  const reservation = slot as { ok: boolean; reason?: string; retry_at?: string };
  if (!reservation.ok) {
    if (reservation.reason === "pacing" && reservation.retry_at) return { kind: "wait", until: reservation.retry_at, reason: "pacing" };
    if (reservation.reason === "not_scheduled") return { kind: "done", outcome: "skipped", detail: "not scheduled" };
    // A daily cap is full: this lead goes out tomorrow.
    await cancel(admin, sendId, reservation.reason ?? "cap");
    await setEnrollment(admin, s.campaign_lead_id, { next_send_at: nextDayWindowOpening(now, window).toISOString() });
    return { kind: "done", outcome: "deferred", detail: reservation.reason };
  }

  const { data: account } = await admin.from("sending_accounts").select(`${ACCOUNT_CONNECTION_COLUMNS}, display_name`).eq("id", s.sending_account_id!).single();
  if (!account) throw new Error("sending account vanished");
  const password = await loadAccountPassword(orgId, account.id);
  const adapter = createMailAdapter(toMailConfig(account, password), mailAdapterOptions());
  const urls = unsubscribeUrls(sendId);

  const result = await adapter.send({
    fromName: account.display_name,
    to: s.leads.email,
    subject: s.subject ?? "",
    text: s.body_text ?? "",
    html: s.body_html ?? "",
    messageId: s.message_id!,
    inReplyTo: s.in_reply_to,
    references: s.references,
    headers: {
      "List-Unsubscribe": `<${urls.oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  if (result.ok) {
    const next = await nextStepAt(s, now);
    const { error: completeError } = await admin.rpc("complete_send", {
      p_org_id: orgId,
      p_send_id: sendId,
      ...(next ? { p_next_send_at: next.toISOString() } : {}), // omitted = last step
    });
    if (completeError) throw new Error(completeError.message);
    return { kind: "done", outcome: "sent" };
  }

  if (result.hardBounce) {
    await admin.from("sends").update({ status: "bounced", error: result.error }).eq("id", sendId);
    await admin.from("events").insert({ org_id: orgId, send_id: sendId, type: "bounce", meta: { stage: "smtp", error: result.error } });
    // Suppression trigger marks the lead bounced and stops every enrollment.
    await admin
      .from("suppression_list")
      .upsert({ org_id: orgId, email: s.leads.email, reason: "hard_bounce", source: `send:${sendId}` }, { onConflict: "org_id,email", ignoreDuplicates: true });
    await admin.rpc("stop_lead_sequences", { p_org_id: orgId, p_lead_id: s.lead_id, p_status: "bounced", p_reason: "hard_bounce" });
    return { kind: "done", outcome: "bounced", detail: result.error };
  }

  // The email did not leave: give the slot back.
  await admin.rpc("release_send_slot", { p_org_id: orgId, p_send_id: sendId });
  await admin.from("sends").update({ status: "failed", error: result.error }).eq("id", sendId);

  if (result.accountProblem) {
    await admin
      .from("sending_accounts")
      .update({ status: "disconnected", health: "failing", health_detail: `SMTP: ${result.error}`, last_checked_at: now.toISOString() })
      .eq("id", account.id);
    // Step 1 can move to another inbox; follow-ups must stay in-thread and wait for a fix.
    const isFirst = s.campaign_leads.current_step_order === 0;
    await setEnrollment(admin, s.campaign_lead_id, {
      next_send_at: new Date(now.getTime() + RETRY_BACKOFF_MS).toISOString(),
      ...(isFirst ? { sending_account_id: null } : {}),
    });
    return { kind: "done", outcome: "failed", detail: `inbox disconnected: ${result.error}` };
  }

  const { data: enrollment } = await admin.from("campaign_leads").select("attempt_count").eq("id", s.campaign_lead_id).single();
  const attempts = (enrollment?.attempt_count ?? 0) + 1;
  await setEnrollment(
    admin,
    s.campaign_lead_id,
    attempts >= MAX_SEND_ATTEMPTS
      ? { status: "failed", stopped_reason: `send_failed: ${result.error}`.slice(0, 300), attempt_count: attempts, next_send_at: null }
      : { attempt_count: attempts, next_send_at: new Date(now.getTime() + RETRY_BACKOFF_MS * attempts).toISOString() },
  );
  return { kind: "done", outcome: "failed", detail: result.error };
}

type SendRow = {
  id: string;
  status: string;
  campaign_lead_id: string;
  lead_id: string;
  step_id: string | null;
  sending_account_id: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  references: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  campaigns: {
    id: string;
    status: string;
    timezone: string;
    send_window_start: string;
    send_window_end: string;
    send_days: number[];
    include_risky: boolean;
    organizations: { sending_paused: boolean };
  };
  leads: { email: string; status: string; verification_status: string };
  campaign_leads: { status: string; current_step_order: number };
  sequence_steps: { step_order: number; sequence_id: string } | null;
};

async function cancel(admin: ReturnType<typeof createAdminClient>, sendId: string, reason: string) {
  await admin.from("sends").update({ status: "cancelled", error: reason }).eq("id", sendId).in("status", ["scheduled", "pending_approval"]);
}

/** When the step after this send is due, or null if this was the last step. */
async function nextStepAt(s: SendRow, now: Date): Promise<Date | null> {
  if (!s.sequence_steps) return null;
  const { data: next } = await createAdminClient()
    .from("sequence_steps")
    .select("delay_days, delay_hours")
    .eq("sequence_id", s.sequence_steps.sequence_id)
    .gt("step_order", s.sequence_steps.step_order)
    .order("step_order")
    .limit(1)
    .maybeSingle();
  if (!next) return null;
  return computeNextSendAt({
    now,
    step: { delayDays: next.delay_days, delayHours: next.delay_hours },
    lastSentAt: now,
    window: campaignWindow(s.campaigns),
  });
}
