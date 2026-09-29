import "server-only";
import { randomUUID } from "node:crypto";
import {
  AGENT_TOOLS,
  REPLY_CLASSES,
  isValidEmailSyntax,
  nextAbGroup,
  normalizeEmail,
  resolveAccountConfig,
  sendingAccountInputSchema,
  isValidTimeZone,
  type AgentToolName,
  type ReplyClass,
} from "@crm/core";
import type { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAccount, recordHealth, runConnectionTest, storeAccountPassword } from "@/lib/sending-accounts";
import { sendTestEmail } from "@/lib/test-email";
import { createVerificationRun } from "@/lib/verification/runs";
import { pauseCampaignFor, startCampaignFor } from "@/lib/campaigns/lifecycle";
import { loadBreakdown } from "@/lib/analytics";
import { inngest } from "@/inngest/client";
import { leadVerificationRequested } from "@/inngest/events";

export type AgentCtx = { orgId: string; apiKeyId: string | null; actor: string };
export type ToolArgs<N extends AgentToolName> = z.output<(typeof AGENT_TOOLS)[N]["input"]>;
type Impl<N extends AgentToolName> = (ctx: AgentCtx, args: ToolArgs<N>) => Promise<unknown>;

/** A tool failure the agent should see as a normal error message (not a crash). */
export class ToolError extends Error {}
const fail = (message: string): never => {
  throw new ToolError(message);
};

const db = () => createAdminClient();

async function campaignOf(orgId: string, id: string) {
  const { data } = await db().from("campaigns").select("id, name, status, approval_mode, daily_limit, daily_limit_per_inbox").eq("org_id", orgId).eq("id", id).maybeSingle();
  return data ?? fail(`Campaign ${id} not found`);
}

/** Which campaign (if any) a call affects, for the approval guardrail. */
export async function campaignForCall(orgId: string, tool: AgentToolName, args: Record<string, unknown>): Promise<string | null> {
  if (typeof args.campaign_id === "string") return args.campaign_id;
  if (tool === "send_test_email" && typeof args.variant_id === "string") {
    const { data } = await db()
      .from("email_variants")
      .select("sequence_steps!inner(sequences!inner(campaign_id))")
      .eq("org_id", orgId)
      .eq("id", args.variant_id)
      .maybeSingle();
    return (data as unknown as { sequence_steps: { sequences: { campaign_id: string } } } | null)?.sequence_steps.sequences.campaign_id ?? null;
  }
  return null;
}

/** Instances of "send" tools that cannot increase sending run without approval. */
export async function isHarmlessCall(ctx: AgentCtx, tool: AgentToolName, args: Record<string, unknown>): Promise<boolean> {
  if (tool === "set_daily_volume") {
    const c = await campaignOf(ctx.orgId, String(args.campaign_id));
    const perInbox = typeof args.daily_limit_per_inbox === "number" ? args.daily_limit_per_inbox : c.daily_limit_per_inbox;
    return Number(args.daily_limit) <= c.daily_limit && perInbox <= c.daily_limit_per_inbox;
  }
  if (tool === "send_test_email" && typeof args.to === "string") {
    const { data } = await db().from("memberships").select("users!inner(email)").eq("org_id", ctx.orgId);
    const members = (data ?? []).map((m) => normalizeEmail((m.users as unknown as { email: string }).email));
    return members.includes(normalizeEmail(args.to));
  }
  return false;
}

const tools: { [N in AgentToolName]: Impl<N> } = {
  async list_campaigns(ctx) {
    const { data } = await db()
      .from("campaigns")
      .select("id, name, status, approval_mode, daily_limit, daily_limit_per_inbox, timezone, send_window_start, send_window_end, created_at, campaign_leads(count)")
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: false });
    return (data ?? []).map(({ campaign_leads, ...c }) => ({ ...c, enrolled: (campaign_leads as unknown as { count: number }[])[0]?.count ?? 0 }));
  },

  async get_campaign(ctx, { campaign_id }) {
    const { data } = await db()
      .from("campaigns")
      .select(
        "id, name, status, approval_mode, timezone, send_window_start, send_window_end, send_days, daily_limit, daily_limit_per_inbox, include_risky, track_opens, track_clicks, auto_promote_winner, last_error, " +
          "sequences(id, sequence_steps(id, step_order, delay_days, delay_hours, email_variants(id, ab_group, subject, body, weight, is_active, is_winner))), campaign_sending_accounts(sending_accounts(id, email, status, health))",
      )
      .eq("org_id", ctx.orgId)
      .eq("id", campaign_id)
      .maybeSingle();
    if (!data) fail("Campaign not found");
    const { data: rows } = await db().from("campaign_leads").select("status").eq("campaign_id", campaign_id);
    const enrollment: Record<string, number> = {};
    for (const r of rows ?? []) enrollment[r.status] = (enrollment[r.status] ?? 0) + 1;
    return { ...(data as object), enrollment };
  },

  async create_campaign(ctx, { name, timezone }) {
    const admin = db();
    const { data: org } = await admin.from("organizations").select("default_timezone").eq("id", ctx.orgId).single();
    const tz = timezone && isValidTimeZone(timezone) ? timezone : org!.default_timezone;
    const { data: campaign, error } = await admin.from("campaigns").insert({ org_id: ctx.orgId, name, timezone: tz }).select("id").single();
    if (error || !campaign) fail(error?.message ?? "Could not create campaign");
    const { data: seq } = await admin.from("sequences").insert({ org_id: ctx.orgId, campaign_id: campaign!.id }).select("id").single();
    const { data: step } = await admin.from("sequence_steps").insert({ org_id: ctx.orgId, sequence_id: seq!.id, step_order: 1, delay_days: 0 }).select("id").single();
    const { data: variant } = await admin.from("email_variants").insert({ org_id: ctx.orgId, step_id: step!.id, ab_group: "A", subject: "", body: "" }).select("id").single();
    const { data: inboxes } = await admin.from("sending_accounts").select("id").eq("org_id", ctx.orgId).eq("status", "active");
    if (inboxes?.length) {
      await admin.from("campaign_sending_accounts").insert(inboxes.map((i) => ({ org_id: ctx.orgId, campaign_id: campaign!.id, sending_account_id: i.id })));
    }
    return { campaign_id: campaign!.id, status: "draft", step_id: step!.id, variant_id: variant!.id, inboxes_attached: inboxes?.length ?? 0 };
  },

  async update_campaign(ctx, { campaign_id, ...fields }) {
    await campaignOf(ctx.orgId, campaign_id);
    const patch: { name?: string; track_opens?: boolean; track_clicks?: boolean; auto_promote_winner?: boolean } = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    );
    if (!Object.keys(patch).length) fail("Nothing to update");
    await db().from("campaigns").update(patch).eq("id", campaign_id);
    return { campaign_id, updated: Object.keys(patch) };
  },

  async create_sequence(ctx, { campaign_id }) {
    await campaignOf(ctx.orgId, campaign_id);
    const admin = db();
    let { data: seq } = await admin.from("sequences").select("id").eq("campaign_id", campaign_id).maybeSingle();
    if (!seq) ({ data: seq } = await admin.from("sequences").insert({ org_id: ctx.orgId, campaign_id }).select("id").single());
    const { data: steps } = await admin.from("sequence_steps").select("id, step_order, delay_days, delay_hours").eq("sequence_id", seq!.id).order("step_order");
    return { sequence_id: seq!.id, steps: steps ?? [] };
  },

  async add_sequence_step(ctx, { campaign_id, delay_days, delay_hours, subject, body }) {
    const c = await campaignOf(ctx.orgId, campaign_id);
    if (c.status === "active") fail("Pause the campaign before changing its steps.");
    const { sequence_id, steps } = (await tools.create_sequence(ctx, { campaign_id })) as { sequence_id: string; steps: { step_order: number }[] };
    const order = (steps.at(-1)?.step_order ?? 0) + 1;
    const admin = db();
    const { data: step, error } = await admin
      .from("sequence_steps")
      .insert({ org_id: ctx.orgId, sequence_id, step_order: order, delay_days, delay_hours })
      .select("id")
      .single();
    if (error) fail(error.message);
    const { data: v } = await admin.from("email_variants").insert({ org_id: ctx.orgId, step_id: step!.id, ab_group: "A", subject, body }).select("id").single();
    return { step_id: step!.id, step_order: order, variant_id: v!.id };
  },

  async create_variant(ctx, { step_id, subject, body, weight }) {
    const admin = db();
    const { data: variants } = await admin.from("email_variants").select("id, ab_group, subject, body").eq("org_id", ctx.orgId).eq("step_id", step_id);
    if (!variants?.length) fail("Step not found");
    const empty = variants!.length === 1 && !variants![0]!.subject && !variants![0]!.body ? variants![0]! : null;
    if (empty) {
      await admin.from("email_variants").update({ subject, body, weight }).eq("id", empty.id);
      return { variant_id: empty.id, ab_group: empty.ab_group, filled_existing: true };
    }
    const group = nextAbGroup(variants!.map((v) => v.ab_group));
    if (!group) fail("This step already has the maximum number of variants.");
    const { data: v, error } = await admin.from("email_variants").insert({ org_id: ctx.orgId, step_id, ab_group: group!, subject, body, weight }).select("id").single();
    if (error) fail(error.message);
    return { variant_id: v!.id, ab_group: group };
  },

  async upload_leads(ctx, { leads, list_name }) {
    const admin = db();
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    let invalid = 0;
    leads.forEach((l, i) => {
      const email = normalizeEmail(l.email);
      if (!isValidEmailSyntax(email)) return void invalid++;
      if (seen.has(email)) return;
      seen.add(email);
      rows.push({ row: i + 1, email, first_name: l.first_name ?? null, last_name: l.last_name ?? null, company: l.company ?? null, title: l.title ?? null, custom: l.custom ?? {} });
    });
    let listId: string | null = null;
    if (list_name) {
      const { data: existing } = await admin.from("lead_lists").select("id").eq("org_id", ctx.orgId).eq("name", list_name).maybeSingle();
      listId = existing?.id ?? (await admin.from("lead_lists").insert({ org_id: ctx.orgId, name: list_name }).select("id").single()).data!.id;
    }
    const { data: imp, error: impError } = await admin
      .from("imports")
      .insert({ org_id: ctx.orgId, list_id: listId, filename: `agent-${new Date().toISOString().slice(0, 10)}.json`, status: "processing", total_rows: leads.length })
      .select("id")
      .single();
    if (impError) fail(impError.message);
    const { data: result, error } = await admin.rpc("import_leads_chunk", { p_org_id: ctx.orgId, p_import_id: imp!.id, p_mode: "skip", p_rows: rows as never, ...(listId ? { p_list_id: listId } : {}) });
    if (error) fail(error.message);
    const raw = (result ?? {}) as { imported_rows?: number[]; existing_rows?: number[]; suppressed_rows?: number[] };
    const r = { imported: raw.imported_rows?.length ?? 0, already_existed: raw.existing_rows?.length ?? 0, suppressed: raw.suppressed_rows?.length ?? 0 };
    const duplicatesInBatch = leads.length - invalid - rows.length;
    await admin
      .from("imports")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        imported_count: r.imported,
        duplicate_count: r.already_existed + duplicatesInBatch,
        suppressed_count: r.suppressed,
        invalid_count: invalid,
      })
      .eq("id", imp!.id);
    const run = await createVerificationRun(ctx.orgId, { importId: imp!.id }, { source: "agent" });
    if (run) await inngest.send(leadVerificationRequested.create({ orgId: ctx.orgId, runId: run.runId }, { id: `verify-${run.runId}` }));
    return { import_id: imp!.id, list_id: listId, ...r, duplicates_in_batch: duplicatesInBatch, invalid, verification_queued: run?.total ?? 0 };
  },

  async verify_leads(ctx, { lead_ids, all_unverified }) {
    if (!lead_ids && !all_unverified) fail("Pass lead_ids or all_unverified: true");
    const run = await createVerificationRun(ctx.orgId, lead_ids ? { leadIds: lead_ids } : { allUnverified: true }, { source: "agent" });
    if (!run) return { queued: 0, message: "Nothing needed verifying." };
    await inngest.send(leadVerificationRequested.create({ orgId: ctx.orgId, runId: run.runId }, { id: `verify-${run.runId}` }));
    return { run_id: run.runId, queued: run.total };
  },

  async list_leads(ctx, { search, status, verification_status, list_id, limit }) {
    const cols = "id, email, first_name, last_name, company, title, status, verification_status";
    let q = db()
      .from("leads")
      .select(list_id ? `${cols}, lead_list_members!inner(list_id)` : cols)
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);
    if (verification_status) q = q.eq("verification_status", verification_status);
    if (list_id) q = q.eq("lead_list_members.list_id", list_id);
    if (search) {
      const s = search.replace(/[%,()]/g, " ").trim();
      q = q.or(`email.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%,company.ilike.%${s}%`);
    }
    const { data, error } = await q;
    if (error) fail(error.message);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(({ lead_list_members: _members, ...rest }) => rest);
  },

  async enroll_leads(ctx, { campaign_id, lead_ids, list_id }) {
    await campaignOf(ctx.orgId, campaign_id);
    if (!!lead_ids === !!list_id) fail("Pass exactly one of lead_ids or list_id");
    if (list_id) {
      const { data } = await db().from("lead_lists").select("id").eq("org_id", ctx.orgId).eq("id", list_id).maybeSingle();
      if (!data) fail("List not found");
    }
    const { data, error } = await db().rpc("enroll_leads", { p_campaign_id: campaign_id, ...(lead_ids ? { p_lead_ids: lead_ids } : { p_list_id: list_id! }) });
    if (error) fail(error.message);
    return data;
  },

  async add_sending_account(ctx, a) {
    const parsed = sendingAccountInputSchema.safeParse({
      provider: a.provider,
      email: a.email,
      password: a.password,
      displayName: a.display_name,
      dailyCap: a.daily_cap,
      ...(a.provider === "smtp"
        ? { smtpHost: a.smtp_host, smtpPort: a.smtp_port ?? 465, smtpSecure: true, imapHost: a.imap_host, imapPort: a.imap_port ?? 993, imapSecure: true }
        : {}),
    });
    if (!parsed.success) fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const cfg = resolveAccountConfig(parsed.data!);
    const admin = db();
    const { data: account, error } = await admin
      .from("sending_accounts")
      .insert({
        org_id: ctx.orgId,
        email: cfg.email,
        display_name: cfg.displayName,
        provider: cfg.provider,
        username: cfg.username,
        smtp_host: cfg.smtpHost,
        smtp_port: cfg.smtpPort,
        smtp_secure: cfg.smtpSecure,
        imap_host: cfg.imapHost,
        imap_port: cfg.imapPort,
        imap_secure: cfg.imapSecure,
        daily_cap: cfg.dailyCap,
        // An agent-added inbox never sends until a human activates it.
        status: "paused",
      })
      .select("id")
      .single();
    if (error) fail(error.code === "23505" ? `${cfg.email} is already connected.` : error.message);
    try {
      await storeAccountPassword(ctx.orgId, account!.id, cfg.password);
    } catch (e) {
      await admin.from("sending_accounts").delete().eq("id", account!.id);
      fail(e instanceof Error ? e.message : "Could not store the credential");
    }
    const test = await runConnectionTest(cfg);
    await recordHealth(ctx.orgId, account!.id, test);
    return { account_id: account!.id, status: "paused", note: "A human must activate this inbox in Inboxes before it can send.", test };
  },

  async test_sending_account(ctx, { account_id }) {
    const { data } = await db()
      .from("sending_accounts")
      .select("id, org_id, provider, email, username, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure")
      .eq("org_id", ctx.orgId)
      .eq("id", account_id)
      .maybeSingle();
    if (!data) fail("Inbox not found");
    return await checkAccount(data!);
  },

  async send_test_email(ctx, { variant_id, to, account_id, lead_id }) {
    const admin = db();
    const { data: v } = await admin
      .from("email_variants")
      .select("id, subject, body, sequence_steps!inner(step_order, sequences!inner(campaign_id, sequence_steps(step_order, email_variants(subject, ab_group))))")
      .eq("org_id", ctx.orgId)
      .eq("id", variant_id)
      .maybeSingle();
    if (!v) fail("Variant not found");
    const step = (v as unknown as { sequence_steps: { step_order: number; sequences: { campaign_id: string; sequence_steps: { step_order: number; email_variants: { subject: string; ab_group: string }[] }[] } } }).sequence_steps;
    const first = step.sequences.sequence_steps.find((s) => s.step_order === 1)?.email_variants.find((x) => x.ab_group === "A")?.subject ?? null;
    let inbox = account_id;
    if (!inbox) {
      const { data: link } = await admin.from("campaign_sending_accounts").select("sending_account_id").eq("campaign_id", step.sequences.campaign_id).limit(1).maybeSingle();
      inbox = link?.sending_account_id ?? fail("No inbox attached to this campaign; pass account_id");
    }
    const { data: acct } = await admin.from("sending_accounts").select("id").eq("org_id", ctx.orgId).eq("id", inbox!).maybeSingle();
    if (!acct) fail("Inbox not found");
    const r = await sendTestEmail({
      orgId: ctx.orgId,
      actor: ctx.actor,
      to,
      accountId: inbox!,
      subject: v!.subject,
      body: v!.body,
      variantId: v!.id,
      leadId: lead_id ?? null,
      threadSubject: step.step_order > 1 ? first : null,
    });
    if (!r.ok) fail(r.hint ? `${r.error} (${r.hint})` : r.error);
    return r;
  },

  async start_campaign(ctx, { campaign_id }) {
    const r = await startCampaignFor(ctx.orgId, campaign_id);
    if (!r.ok) fail(r.problems?.length ? `${r.error} ${r.problems.join(" ")}` : r.error);
    return r;
  },

  async pause_campaign(ctx, { campaign_id }) {
    const r = await pauseCampaignFor(ctx.orgId, campaign_id);
    if (!r.ok) fail(r.error);
    return r;
  },

  async set_daily_volume(ctx, { campaign_id, daily_limit, daily_limit_per_inbox }) {
    await campaignOf(ctx.orgId, campaign_id);
    const patch = { daily_limit, ...(daily_limit_per_inbox !== undefined ? { daily_limit_per_inbox } : {}) };
    await db().from("campaigns").update(patch).eq("id", campaign_id);
    return { campaign_id, ...patch, note: "Each inbox's own daily cap still applies across campaigns." };
  },

  async set_send_window(ctx, { campaign_id, start, end, days, timezone }) {
    await campaignOf(ctx.orgId, campaign_id);
    if (start === end) fail("Start and end can't be the same");
    if (timezone && !isValidTimeZone(timezone)) fail(`Unknown timezone ${timezone}`);
    const patch = { send_window_start: start, send_window_end: end, send_days: [...new Set(days)].sort(), ...(timezone ? { timezone } : {}) };
    await db().from("campaigns").update(patch).eq("id", campaign_id);
    return { campaign_id, ...patch };
  },

  async get_analytics(ctx, { group, days, campaign_id }) {
    const { data: org } = await db().from("organizations").select("default_timezone").eq("id", ctx.orgId).single();
    const rows = await loadBreakdown(db(), { orgId: ctx.orgId, group, tz: org!.default_timezone, days, campaignId: campaign_id ?? null });
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
    return rows.map((r) => {
      const sent = Number(r.sent);
      return {
        key: r.key,
        label: r.label,
        ...(r.sub ? { campaign: r.sub } : {}),
        sent,
        bounced: Number(r.bounced),
        opened: Number(r.opened),
        clicked: Number(r.clicked),
        replied: Number(r.replied),
        positive: Number(r.positive),
        unsubscribed: Number(r.unsubscribed),
        reply_rate_pct: pct(Number(r.replied), sent),
        bounce_rate_pct: pct(Number(r.bounced), sent),
      };
    });
  },

  async get_sending_status(ctx) {
    const admin = db();
    const [{ data: org }, { data: campaigns }, { data: inboxes }, { count: queued }] = await Promise.all([
      admin.from("organizations").select("sending_paused, sending_paused_at, sending_paused_by, sending_paused_reason, approval_mode").eq("id", ctx.orgId).single(),
      admin.from("campaigns").select("id, name, daily_limit").eq("org_id", ctx.orgId).eq("status", "active"),
      admin.from("sending_accounts").select("id, email, status, health, daily_cap, sent_today, sent_today_date, warmup_enabled").eq("org_id", ctx.orgId),
      admin.from("sends").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).in("status", ["scheduled", "sending"]),
    ]);
    return { kill_switch: org, active_campaigns: campaigns ?? [], inboxes: inboxes ?? [], queued_sends: queued ?? 0 };
  },

  async list_replies(ctx, { classification, limit }) {
    let q = db()
      .from("replies")
      .select("id, received_at, from_email, subject, classification, classification_reason, outcome, lead_id, leads(email, first_name, last_name), sends(campaigns(name))")
      .eq("org_id", ctx.orgId)
      .order("received_at", { ascending: false })
      .limit(limit);
    if (classification) q = q.eq("classification", classification);
    const { data, error } = await q;
    if (error) fail(error.message);
    return data ?? [];
  },

  async get_lead(ctx, { lead_id }) {
    const admin = db();
    const { data: lead } = await admin.from("leads").select("*").eq("org_id", ctx.orgId).eq("id", lead_id).maybeSingle();
    if (!lead) fail("Lead not found");
    const [{ data: enrollments }, { data: opp }, { data: sends }, { data: replies }] = await Promise.all([
      admin.from("campaign_leads").select("status, current_step_order, next_send_at, stopped_reason, campaigns(id, name)").eq("lead_id", lead_id),
      admin.from("opportunities").select("id, stage_id, pipeline_stages(name)").eq("lead_id", lead_id).maybeSingle(),
      admin.from("sends").select("id, status, subject, body_text, sent_at").eq("lead_id", lead_id).in("status", ["sent", "bounced"]).order("sent_at"),
      admin.from("replies").select("id, received_at, subject, body_text, classification").eq("lead_id", lead_id).order("received_at"),
    ]);
    const thread = [
      ...(sends ?? []).map((s) => ({ at: s.sent_at, direction: "sent", subject: s.subject, text: (s.body_text ?? "").slice(0, 2000), status: s.status })),
      ...(replies ?? []).map((r) => ({ at: r.received_at, direction: "received", subject: r.subject, text: (r.body_text ?? "").slice(0, 2000), classification: r.classification, reply_id: r.id })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { lead, enrollments: enrollments ?? [], pipeline: opp ?? null, thread };
  },

  async classify_reply(ctx, { reply_id, classification }) {
    if (!REPLY_CLASSES.includes(classification as ReplyClass)) fail(`classification must be one of ${REPLY_CLASSES.join(", ")}`);
    const admin = db();
    const { data, error } = await admin
      .from("replies")
      .update({ classification, classification_source: "agent" })
      .eq("org_id", ctx.orgId)
      .eq("id", reply_id)
      .select("id");
    if (error) fail(error.message);
    if (!data?.length) fail("Reply not found");
    const { data: outcome, error: e2 } = await admin.rpc("apply_reply_outcome", { p_org_id: ctx.orgId, p_reply_id: reply_id });
    if (e2) fail(e2.message);
    return { reply_id, classification, outcome };
  },

  async move_lead_stage(ctx, { lead_id, stage_id, stage_name }) {
    const admin = db();
    let q = admin.from("pipeline_stages").select("id, name").eq("org_id", ctx.orgId);
    q = stage_id ? q.eq("id", stage_id) : stage_name ? q.ilike("name", stage_name) : fail("Pass stage_id or stage_name");
    const { data: stage } = await q.maybeSingle();
    if (!stage) fail("Stage not found");
    const { data: lead } = await admin.from("leads").select("id").eq("org_id", ctx.orgId).eq("id", lead_id).maybeSingle();
    if (!lead) fail("Lead not found");
    const { error } = await admin
      .from("opportunities")
      .upsert({ org_id: ctx.orgId, lead_id, stage_id: stage!.id, source: "agent", moved_at: new Date().toISOString() }, { onConflict: "org_id,lead_id" });
    if (error) fail(error.message);
    return { lead_id, stage: stage!.name };
  },

  async add_to_suppression(ctx, { emails, reason }) {
    const valid = [...new Set(emails.map(normalizeEmail).filter(isValidEmailSyntax))];
    if (!valid.length) fail("No valid email addresses");
    const { data, error } = await db()
      .from("suppression_list")
      .upsert(
        valid.map((email) => ({ org_id: ctx.orgId, email, reason: "manual", source: `${ctx.actor}${reason ? `: ${reason}` : ""}`.slice(0, 300) })),
        { onConflict: "org_id,email", ignoreDuplicates: true },
      )
      .select("email");
    if (error) fail(error.message);
    return { suppressed: data?.length ?? 0, already_suppressed: valid.length - (data?.length ?? 0), invalid: emails.length - valid.length };
  },

  async get_agent_audit_log(ctx, { limit }) {
    const { data } = await db()
      .from("agent_audit_log")
      .select("created_at, actor, actor_type, action, target, result, payload")
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data ?? [];
  },

  async pause_all_sending(ctx, { reason }) {
    const { error } = await db().rpc("set_sending_paused", { p_org_id: ctx.orgId, p_paused: true, p_reason: reason, p_actor: ctx.actor });
    if (error) fail(error.message);
    return { sending_paused: true, note: "Only a human can resume sending." };
  },
};

export async function executeTool(ctx: AgentCtx, name: AgentToolName, args: unknown): Promise<unknown> {
  return (tools[name] as Impl<AgentToolName>)(ctx, args as never);
}

export const newApprovalId = () => randomUUID();
