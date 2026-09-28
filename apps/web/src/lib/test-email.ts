import "server-only";
import { randomUUID } from "node:crypto";
import { TEST_EMAILS_PER_HOUR, buildTestEmail, isValidEmailSyntax, normalizeEmail, type MergeLead } from "@crm/core";
import { createMailAdapter } from "@crm/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { newMessageId } from "@/lib/scheduler/config";
import { ACCOUNT_CONNECTION_COLUMNS, loadAccountPassword, mailAdapterOptions, toMailConfig } from "@/lib/sending-accounts";

export const SAMPLE_LEAD: MergeLead = {
  email: "ada@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
  company: "Analytical Engines",
  title: "CTO",
  custom_json: {},
};

export type TestEmailInput = {
  orgId: string;
  actor: string; // 'user:<id>' | 'agent:<id>'
  userId?: string | null;
  to: string;
  accountId: string;
  subject: string;
  body: string;
  variantId?: string | null;
  /** Render with this lead's data; null = built-in sample lead. */
  leadId?: string | null;
  /** Step-1 subject, so follow-ups with an empty subject preview as "Re: …". */
  threadSubject?: string | null;
};

export type TestEmailResult = { ok: true; subject: string; to: string; from: string } | { ok: false; error: string; hint?: string };

/**
 * Sends one test email. Never touches campaign stats, caps or suppression.
 * Honors the kill switch, and is rate-limited per actor.
 */
export async function sendTestEmail(input: TestEmailInput): Promise<TestEmailResult> {
  const admin = createAdminClient();
  const to = normalizeEmail(input.to);
  if (!isValidEmailSyntax(to)) return { ok: false, error: "Enter a valid recipient address." };

  const log = (status: "sent" | "failed" | "blocked", subject: string, error?: string) =>
    admin.from("test_sends").insert({
      org_id: input.orgId,
      user_id: input.userId ?? null,
      actor: input.actor,
      sending_account_id: input.accountId,
      variant_id: input.variantId ?? null,
      to_email: to,
      subject,
      status,
      error: error ?? null,
    });

  const { data: org } = await admin.from("organizations").select("sending_paused, physical_address").eq("id", input.orgId).single();
  if (!org) return { ok: false, error: "Workspace not found." };
  if (org.sending_paused) {
    await log("blocked", input.subject, "sending_paused");
    return { ok: false, error: "All sending is paused (kill switch). Resume sending to send tests." };
  }

  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count } = await admin
    .from("test_sends")
    .select("id", { count: "exact", head: true })
    .eq("org_id", input.orgId)
    .eq("actor", input.actor)
    .neq("status", "blocked")
    .gte("created_at", since);
  if ((count ?? 0) >= TEST_EMAILS_PER_HOUR) {
    return { ok: false, error: `Test email limit reached (${TEST_EMAILS_PER_HOUR} per hour). Try again later.` };
  }

  const { data: account } = await admin
    .from("sending_accounts")
    .select(`${ACCOUNT_CONNECTION_COLUMNS}, display_name`)
    .eq("org_id", input.orgId)
    .eq("id", input.accountId)
    .maybeSingle();
  if (!account) return { ok: false, error: "Choose an inbox to send from." };

  let lead = SAMPLE_LEAD;
  if (input.leadId) {
    const { data } = await admin
      .from("leads")
      .select("email, first_name, last_name, company, title, custom_json")
      .eq("org_id", input.orgId)
      .eq("id", input.leadId)
      .maybeSingle();
    if (data) lead = { ...data, custom_json: data.custom_json as Record<string, unknown> };
  }

  const email = buildTestEmail({
    subject: input.subject,
    body: input.body,
    ctx: { lead, sender: { name: account.display_name, email: account.email } },
    threadSubject: input.threadSubject ?? null,
    // Test links point at a page that explains they're inert (no real send behind them).
    unsubscribeUrl: `${publicEnv.appUrl}/u/test`,
    physicalAddress: org.physical_address,
  });

  let result;
  try {
    const password = await loadAccountPassword(input.orgId, account.id);
    result = await createMailAdapter(toMailConfig(account, password), mailAdapterOptions()).send({
      fromName: account.display_name,
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      messageId: newMessageId(randomUUID(), account.email),
      headers: { "X-YCAReach-Test": "1" },
    });
  } catch (e) {
    result = { ok: false as const, error: e instanceof Error ? e.message : "Send failed", hardBounce: false, accountProblem: false, retryable: false };
  }

  if (!result.ok) {
    await log("failed", email.subject, result.error);
    return { ok: false, error: result.error, hint: "hint" in result ? result.hint : undefined };
  }
  await log("sent", email.subject);
  return { ok: true, subject: email.subject, to, from: account.email };
}
