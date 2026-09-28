import "server-only";
import { randomUUID } from "node:crypto";
import { composeWarmupEmail, pickWarmupPeer, warmupDay, warmupDueNow, warmupHealth, warmupQuota, zonedParts } from "@crm/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { newMessageId } from "@/lib/scheduler/config";
import { WARMUP_MAX_PER_TICK, warmupJitterSeconds } from "./config";

type Admin = ReturnType<typeof createAdminClient>;
export type PlannedWarmup = { orgId: string; id: string; accountId: string; scheduledAt: string };

type PoolAccount = {
  id: string;
  org_id: string;
  email: string;
  display_name: string | null;
  timezone: string | null;
  daily_cap: number;
  warmup_started_at: string | null;
  warmup_daily_target: number;
  warmup_ramp_step: number;
  organizations: { default_timezone: string; sending_paused: boolean };
};

/**
 * One planning pass: auto-pause unhealthy inboxes, then queue today's share of
 * new warmup emails for every healthy inbox in a pool of at least two.
 */
export async function planWarmup(now = new Date()): Promise<{ planned: PlannedWarmup[]; paused: string[]; stuck: PlannedWarmup[] }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sending_accounts")
    .select(
      "id, org_id, email, display_name, timezone, daily_cap, warmup_started_at, warmup_daily_target, warmup_ramp_step, organizations!inner(default_timezone, sending_paused)",
    )
    .eq("warmup_enabled", true)
    .eq("status", "active")
    .is("warmup_paused_reason", null)
    .neq("health", "failing");
  if (error) throw new Error(error.message);

  const byOrg = new Map<string, PoolAccount[]>();
  for (const a of (data ?? []) as unknown as PoolAccount[]) byOrg.set(a.org_id, [...(byOrg.get(a.org_id) ?? []), a]);

  const planned: PlannedWarmup[] = [];
  const paused: string[] = [];
  for (const [orgId, accounts] of byOrg) {
    const { data: stats, error: statsError } = await admin.rpc("warmup_stats", { p_org_id: orgId, p_days: 7 });
    if (statsError) throw new Error(statsError.message);
    const statsBy = new Map((stats ?? []).map((s) => [s.account_id, s]));

    // Health first: an unhealthy inbox leaves the pool (and stops receiving too).
    const healthy: PoolAccount[] = [];
    for (const a of accounts) {
      const s = statsBy.get(a.id);
      const h = warmupHealth({ received: Number(s?.received ?? 0), spam: Number(s?.spam ?? 0), bounced: Number(s?.bounced ?? 0) });
      if (h.pauseReason) {
        await pauseWarmup(admin, a, h.pauseReason);
        paused.push(a.id);
      } else healthy.push(a);
    }
    if (healthy.length < 2 || accounts[0]!.organizations.sending_paused) continue;

    for (const a of healthy) {
      const tz = a.timezone ?? a.organizations.default_timezone;
      const local = zonedParts(now, tz);
      const quota = warmupQuota({
        day: warmupDay(new Date(a.warmup_started_at ?? now), now, tz),
        weekday: local.weekday,
        target: a.warmup_daily_target,
        rampStep: a.warmup_ramp_step,
        dailyCap: a.daily_cap,
      });
      const due = Math.min(WARMUP_MAX_PER_TICK, warmupDueNow({ quota, createdToday: Number(statsBy.get(a.id)?.created_today ?? 0), minuteOfDay: local.hour * 60 + local.minute }));
      if (due <= 0) continue;

      const peers = healthy.filter((p) => p.id !== a.id);
      const { data: todays } = await admin
        .from("warmup_messages")
        .select("to_account_id")
        .eq("from_account_id", a.id)
        .gte("created_at", new Date(now.getTime() - 24 * 3600_000).toISOString());
      const sentTo = new Map<string, number>();
      for (const t of todays ?? []) sentTo.set(t.to_account_id, (sentTo.get(t.to_account_id) ?? 0) + 1);

      const rows = [];
      for (let i = 0; i < due; i++) {
        const id = randomUUID();
        const peerId = pickWarmupPeer(peers.map((p) => p.id), sentTo, id)!;
        sentTo.set(peerId, (sentTo.get(peerId) ?? 0) + 1);
        const peer = peers.find((p) => p.id === peerId)!;
        const text = composeWarmupEmail(id, { toName: peer.display_name, fromName: a.display_name });
        const scheduledAt = new Date(now.getTime() + warmupJitterSeconds() * 1000).toISOString();
        rows.push({
          id,
          org_id: orgId,
          from_account_id: a.id,
          to_account_id: peerId,
          message_id: newMessageId(id, a.email),
          subject: text.subject,
          body_text: text.text,
          scheduled_at: scheduledAt,
        });
        planned.push({ orgId, id, accountId: a.id, scheduledAt });
      }
      const { error: insertError } = await admin.from("warmup_messages").insert(rows);
      if (insertError) throw new Error(insertError.message);
    }
  }

  // Anything still queued long after its time lost its event: hand it out again (sending is idempotent).
  const { data: stuckRows } = await admin
    .from("warmup_messages")
    .select("id, org_id, from_account_id, scheduled_at")
    .eq("status", "scheduled")
    .lt("scheduled_at", new Date(now.getTime() - 30 * 60_000).toISOString())
    .limit(200);
  const stuck = (stuckRows ?? []).map((r) => ({ orgId: r.org_id, id: r.id, accountId: r.from_account_id, scheduledAt: r.scheduled_at }));
  return { planned, paused, stuck };
}

async function pauseWarmup(admin: Admin, a: { id: string; org_id: string; email: string }, reason: string) {
  await admin.from("sending_accounts").update({ warmup_paused_reason: reason }).eq("id", a.id);
  await admin
    .from("warmup_messages")
    .update({ status: "cancelled", error: "warmup paused" })
    .eq("from_account_id", a.id)
    .eq("status", "scheduled")
    .eq("is_reply", false);
  await admin.from("agent_audit_log").insert({
    org_id: a.org_id,
    actor: "system:warmup",
    actor_type: "system",
    action: "warmup.auto_pause",
    target: `sending_account:${a.id}`,
    payload: { email: a.email, reason },
  });
}
