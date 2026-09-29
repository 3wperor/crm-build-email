/**
 * AI agent control plane: the tool catalog (names, descriptions, input
 * schemas, risk) shared by the web app's /api/agent and the MCP server, and
 * the guardrail that decides whether a call runs, waits for a human, or is
 * refused. Pure: no I/O.
 */
import { z } from "zod";
import { effectiveApprovalMode, type ApprovalMode } from "./approval";
import { CAMPAIGN_DAILY_LIMIT_MAX, CAMPAIGN_PER_INBOX_MAX } from "./campaigns";

/**
 * read   – never changes anything.
 * write  – drafts and configuration that cannot send email by itself.
 * send   – can cause email to go out (or more of it): needs approval unless
 *          both the workspace and the campaign are in full-auto.
 * safety – stops sending; always allowed (an agent may always hit the brakes).
 */
export type ToolRisk = "read" | "write" | "send" | "safety";

const uuid = z.string().uuid();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM (24h)");
const limit = z.number().int().min(1).max(200).default(50);

export const AGENT_TOOLS = {
  list_campaigns: { risk: "read", description: "List campaigns with status, limits and enrollment counts.", input: z.object({}) },
  get_campaign: {
    risk: "read",
    description: "One campaign: settings, sequence (steps + variants), attached inboxes, enrollment counts.",
    input: z.object({ campaign_id: uuid }),
  },
  create_campaign: {
    risk: "write",
    description: "Create a draft campaign with a one-step sequence and an empty variant A; attaches all active inboxes.",
    input: z.object({ name: z.string().trim().min(1).max(200), timezone: z.string().optional() }),
  },
  update_campaign: {
    risk: "write",
    description: "Rename or change tracking / auto-promote settings. Volume, window and approval mode have their own tools or are human-only.",
    input: z.object({
      campaign_id: uuid,
      name: z.string().trim().min(1).max(200).optional(),
      track_opens: z.boolean().optional(),
      track_clicks: z.boolean().optional(),
      auto_promote_winner: z.boolean().optional(),
    }),
  },
  create_sequence: {
    risk: "write",
    description: "Ensure the campaign has a sequence (campaigns get one on creation); returns its steps.",
    input: z.object({ campaign_id: uuid }),
  },
  add_sequence_step: {
    risk: "write",
    description: "Append a follow-up step with a delay; its variant A starts with the given subject/body (empty subject = reply in thread).",
    input: z.object({
      campaign_id: uuid,
      delay_days: z.number().int().min(0).max(365),
      delay_hours: z.number().int().min(0).max(23).default(0),
      subject: z.string().max(300).default(""),
      body: z.string().max(20000).default(""),
    }),
  },
  create_variant: {
    risk: "write",
    description: "Write copy for a step: fills the step's empty variant A, otherwise adds the next A/B variant. Merge tags like {{first_name|there}} work.",
    input: z.object({
      step_id: uuid,
      subject: z.string().max(300).default(""),
      body: z.string().min(1).max(20000),
      weight: z.number().int().min(0).max(10000).default(100),
    }),
  },
  upload_leads: {
    risk: "write",
    description: "Import up to 1000 leads (deduped; suppressed addresses skipped), optionally into a named list; verification runs automatically.",
    input: z.object({
      leads: z
        .array(
          z.object({
            email: z.string().max(320),
            first_name: z.string().max(200).optional(),
            last_name: z.string().max(200).optional(),
            company: z.string().max(200).optional(),
            title: z.string().max(200).optional(),
            custom: z.record(z.string(), z.string().max(2000)).optional(),
          }),
        )
        .min(1)
        .max(1000),
      list_name: z.string().trim().min(1).max(200).optional(),
    }),
  },
  verify_leads: {
    risk: "write",
    description: "Queue email verification for specific leads, or for every unverified lead.",
    input: z.object({ lead_ids: z.array(uuid).min(1).max(5000).optional(), all_unverified: z.boolean().optional() }),
  },
  list_leads: {
    risk: "read",
    description: "Search leads by email/name/company text, status, verification status or list.",
    input: z.object({
      search: z.string().max(200).optional(),
      status: z.string().max(40).optional(),
      verification_status: z.string().max(40).optional(),
      list_id: uuid.optional(),
      limit,
    }),
  },
  enroll_leads: {
    risk: "write",
    description: "Add leads to a campaign (by ids or list). Invalid, suppressed, replied and busy leads are skipped. Nothing sends until the campaign runs.",
    input: z.object({ campaign_id: uuid, lead_ids: z.array(uuid).min(1).max(5000).optional(), list_id: uuid.optional() }),
  },
  add_sending_account: {
    risk: "write",
    description: "Connect an SMTP/IMAP inbox with an app password. It is added PAUSED and tested; a human activates it before it can send.",
    input: z.object({
      email: z.string().max(320),
      password: z.string().min(1).max(500),
      provider: z.enum(["google", "smtp"]).default("google"),
      display_name: z.string().max(200).optional(),
      smtp_host: z.string().max(253).optional(),
      smtp_port: z.number().int().min(1).max(65535).optional(),
      imap_host: z.string().max(253).optional(),
      imap_port: z.number().int().min(1).max(65535).optional(),
      daily_cap: z.number().int().min(1).max(2000).default(30),
    }),
  },
  test_sending_account: { risk: "write", description: "Re-test an inbox's SMTP and IMAP connection and update its health.", input: z.object({ account_id: uuid }) },
  send_test_email: {
    risk: "send",
    description: "Send one variant as a [TEST] email. To a workspace member it goes out directly; to anyone else it needs approval.",
    input: z.object({ variant_id: uuid, to: z.string().max(320), account_id: uuid.optional(), lead_id: uuid.optional() }),
  },
  start_campaign: { risk: "send", description: "Start (or resume) a campaign.", input: z.object({ campaign_id: uuid }) },
  pause_campaign: { risk: "safety", description: "Pause a running campaign. Always allowed.", input: z.object({ campaign_id: uuid }) },
  set_daily_volume: {
    risk: "send",
    description: `Change a campaign's daily limit (max ${CAMPAIGN_DAILY_LIMIT_MAX}) and per-inbox limit (max ${CAMPAIGN_PER_INBOX_MAX}). Lowering runs directly; raising needs approval.`,
    input: z.object({
      campaign_id: uuid,
      daily_limit: z.number().int().min(0).max(CAMPAIGN_DAILY_LIMIT_MAX),
      daily_limit_per_inbox: z.number().int().min(0).max(CAMPAIGN_PER_INBOX_MAX).optional(),
    }),
  },
  set_send_window: {
    risk: "write",
    description: "Set a campaign's send window (local HH:MM start/end, days 1=Mon..7=Sun) and timezone.",
    input: z.object({
      campaign_id: uuid,
      start: time,
      end: time,
      days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      timezone: z.string().optional(),
    }),
  },
  get_analytics: {
    risk: "read",
    description: "Sent / bounced / opened / clicked / replied / positive / unsubscribed, total or by campaign, inbox or variant.",
    input: z.object({
      group: z.enum(["total", "campaign", "inbox", "variant"]).default("total"),
      days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
      campaign_id: uuid.optional(),
    }),
  },
  get_sending_status: {
    risk: "read",
    description: "Kill switch state, running campaigns, inbox health and today's usage vs caps, queued sends.",
    input: z.object({}),
  },
  list_replies: {
    risk: "read",
    description: "Recent replies with classification, lead and campaign.",
    input: z.object({ classification: z.string().max(40).optional(), limit }),
  },
  get_lead: { risk: "read", description: "A lead with enrollments, pipeline stage, and the sent/received thread.", input: z.object({ lead_id: uuid }) },
  classify_reply: {
    risk: "write",
    description: "Reclassify a reply (positive, neutral, negative, out_of_office, unsubscribe, bounce…) and apply the outcome.",
    input: z.object({ reply_id: uuid, classification: z.string().max(40) }),
  },
  move_lead_stage: {
    risk: "write",
    description: "Put a lead in a pipeline stage (by stage id or name); adds it to the pipeline if needed.",
    input: z.object({ lead_id: uuid, stage_id: uuid.optional(), stage_name: z.string().max(100).optional() }),
  },
  add_to_suppression: {
    risk: "safety",
    description: "Never email these addresses again (stops their sequences). Removing suppressions is human-only.",
    input: z.object({ emails: z.array(z.string().max(320)).min(1).max(1000), reason: z.string().max(200).optional() }),
  },
  get_agent_audit_log: { risk: "read", description: "Recent agent and system actions, newest first.", input: z.object({ limit }) },
  pause_all_sending: {
    risk: "safety",
    description: "KILL SWITCH: stop all sending in the workspace immediately. Only a human can resume.",
    input: z.object({ reason: z.string().max(300) }),
  },
} as const satisfies Record<string, { risk: ToolRisk; description: string; input: z.ZodType }>;

export type AgentToolName = keyof typeof AGENT_TOOLS;
export const AGENT_TOOL_NAMES = Object.keys(AGENT_TOOLS) as AgentToolName[];

export function isAgentTool(name: string): name is AgentToolName {
  return Object.prototype.hasOwnProperty.call(AGENT_TOOLS, name);
}

/** JSON Schema for each tool's input (what MCP clients see). */
export function agentToolJsonSchemas(): { name: AgentToolName; description: string; inputSchema: Record<string, unknown> }[] {
  return AGENT_TOOL_NAMES.map((name) => ({
    name,
    description: `${AGENT_TOOLS[name].description} [${AGENT_TOOLS[name].risk}]`,
    inputSchema: z.toJSONSchema(AGENT_TOOLS[name].input, { io: "input" }) as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Guardrail
// ---------------------------------------------------------------------------

export type AgentGuardInput = {
  risk: ToolRisk;
  orgMode: ApprovalMode;
  /** The campaign the call affects, when there is one. */
  campaignMode?: ApprovalMode | null;
  /**
   * The call is a "send" tool in form but can't increase sending in this
   * instance (e.g. lowering volume, a test email to a workspace member).
   */
  harmless?: boolean;
};

export type GuardDecision = { action: "allow" } | { action: "approval"; reason: string };

/**
 * Draft-only by default: anything that can make (more) email go out waits for
 * a human unless the workspace AND the campaign are in full-auto. Actions
 * with no campaign are only automatic when the workspace is.
 */
export function agentGuard(i: AgentGuardInput): GuardDecision {
  if (i.risk !== "send" || i.harmless) return { action: "allow" };
  const mode = i.campaignMode === undefined || i.campaignMode === null ? i.orgMode : effectiveApprovalMode(i.orgMode, i.campaignMode);
  if (mode === "auto") return { action: "allow" };
  return {
    action: "approval",
    reason:
      i.orgMode !== "auto"
        ? "The workspace is in draft mode: a human must approve actions that send email."
        : "This campaign is in draft mode: a human must approve actions that send email.",
  };
}

/** API keys: "ycr_" + 43 base64url chars (32 random bytes). Only a SHA-256 hash is stored. */
export const API_KEY_PREFIX = "ycr_";
export function looksLikeApiKey(s: string): boolean {
  return /^ycr_[A-Za-z0-9_-]{43}$/.test(s);
}
