import "server-only";
import { dueNotice, noticeEmail, type NoticeOrg } from "@crm/core/onboarding";
import type { BillingStatus } from "@crm/core/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { sendSystemEmail, systemMailConfigured } from "@/lib/system-mail";

export type ReminderSummary = { checked: number; sent: number; failed: number; skipped?: string };

/**
 * Emails workspace owners when their trial is about to end, has ended, ran out
 * of emails, or a payment failed. Each occurrence is claimed in org_notices
 * first (unique), so a reminder is sent at most once even if jobs overlap.
 */
export async function runBillingReminders(now = new Date()): Promise<ReminderSummary> {
  if (!systemMailConfigured()) return { checked: 0, sent: 0, failed: 0, skipped: "SYSTEM_EMAIL_ADDRESS / SYSTEM_EMAIL_APP_PASSWORD not set" };
  const admin = createAdminClient();
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, name, plan, trial_ends_at, subscription_status, current_period_end")
    .in("plan", ["trial", "expired"]);
  if (error) throw new Error(error.message);

  const summary: ReminderSummary = { checked: orgs?.length ?? 0, sent: 0, failed: 0 };
  for (const o of orgs ?? []) {
    let block: string | null = null;
    if (o.plan === "trial" && new Date(o.trial_ends_at) > now) {
      const { data } = await admin.rpc("billing_status", { p_org_id: o.id });
      block = (data as unknown as BillingStatus | null)?.block ?? null;
    }
    const due = dueNotice({ ...(o as Omit<NoticeOrg, "block">), block }, now);
    if (!due) continue;

    const { data: owners } = await admin.from("memberships").select("users!inner(email, full_name)").eq("org_id", o.id).eq("role", "owner");
    const people = (owners ?? []).map((m) => m.users as unknown as { email: string; full_name: string | null }).filter((u) => u.email);
    if (!people.length) continue;

    // Claim it: if this occurrence was already handled, the insert does nothing.
    const { data: claimed } = await admin
      .from("org_notices")
      .upsert({ org_id: o.id, kind: due.kind, key: due.key, recipients: people.map((p) => p.email) }, { onConflict: "org_id,kind,key", ignoreDuplicates: true })
      .select("id");
    const noticeId = claimed?.[0]?.id;
    if (!noticeId) continue;

    const email = noticeEmail(due.kind, {
      workspace: o.name,
      billingUrl: `${publicEnv.appUrl}/billing`,
      firstName: people.length === 1 ? (people[0]!.full_name?.split(/\s+/)[0] ?? null) : null,
    });
    const res = await sendSystemEmail(
      people.map((p) => p.email),
      email.subject,
      email.text,
    );
    if (res.ok) {
      summary.sent++;
      await admin.from("org_notices").update({ status: "sent" }).eq("id", noticeId);
    } else {
      summary.failed++;
      // Release the claim so the next run retries.
      await admin.from("org_notices").delete().eq("id", noticeId);
      console.error(`billing reminder ${due.kind} for ${o.id} failed: ${res.error}`);
    }
  }
  return summary;
}
