import "server-only";
import { AGENT_TOOLS, agentGuard, isAgentTool, type AgentToolName, type ApprovalMode } from "@crm/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { campaignForCall, executeTool, isHarmlessCall, ToolError, type AgentCtx } from "./tools";

export type AgentCallResult =
  | { status: "ok"; result: unknown }
  | { status: "pending_approval"; approval_id: string; message: string }
  | { status: "error"; error: string };

type AuditResult = "ok" | "denied" | "error" | "pending_approval";

async function audit(ctx: AgentCtx, action: string, target: string | null, payload: Record<string, unknown>, result: AuditResult) {
  await createAdminClient()
    .from("agent_audit_log")
    .insert({ org_id: ctx.orgId, actor: ctx.actor, actor_type: "agent", api_key_id: ctx.apiKeyId, action, target, payload: payload as never, result });
}

/** Secrets never reach the audit log or the approval queue. */
function redact(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, /password|token|secret/i.test(k) ? "[redacted]" : v]));
}

function summarize(tool: AgentToolName, args: Record<string, unknown>): string {
  switch (tool) {
    case "start_campaign":
      return "Start (or resume) the campaign";
    case "set_daily_volume":
      return `Raise daily volume to ${args.daily_limit}${args.daily_limit_per_inbox !== undefined ? ` (${args.daily_limit_per_inbox} per inbox)` : ""}`;
    case "send_test_email":
      return `Send a test email to ${args.to}`;
    default:
      return tool.replace(/_/g, " ");
  }
}

/**
 * Every agent call goes through here: validate input, apply the guardrail,
 * then run it or queue it for a human, and audit the outcome either way.
 */
export async function runAgentTool(ctx: AgentCtx, tool: string, rawArgs: unknown): Promise<AgentCallResult> {
  if (!isAgentTool(tool)) {
    await audit(ctx, `agent.${tool}`.slice(0, 100), null, {}, "denied");
    return { status: "error", error: `Unknown tool ${tool}` };
  }
  const parsed = AGENT_TOOLS[tool].input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    await audit(ctx, tool, null, { error }, "denied");
    return { status: "error", error };
  }
  const args = parsed.data as Record<string, unknown>;
  const admin = createAdminClient();

  try {
    const campaignId = await campaignForCall(ctx.orgId, tool, args);
    const target = campaignId ? `campaign:${campaignId}` : null;
    const { data: org } = await admin.from("organizations").select("approval_mode").eq("id", ctx.orgId).single();
    let campaignMode: ApprovalMode | null = null;
    if (campaignId) {
      const { data: c } = await admin.from("campaigns").select("approval_mode").eq("org_id", ctx.orgId).eq("id", campaignId).maybeSingle();
      if (!c) throw new ToolError("Campaign not found");
      campaignMode = c.approval_mode as ApprovalMode;
    }
    const decision = agentGuard({
      risk: AGENT_TOOLS[tool].risk,
      orgMode: org!.approval_mode as ApprovalMode,
      campaignMode,
      harmless: AGENT_TOOLS[tool].risk === "send" ? await isHarmlessCall(ctx, tool, args) : false,
    });

    if (decision.action === "approval") {
      const { data: approval, error } = await admin
        .from("agent_approvals")
        .insert({ org_id: ctx.orgId, api_key_id: ctx.apiKeyId, tool, args: args as never, campaign_id: campaignId, summary: summarize(tool, args), reason: decision.reason })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await audit(ctx, tool, target, { args: redact(args), approval_id: approval!.id }, "pending_approval");
      return {
        status: "pending_approval",
        approval_id: approval!.id,
        message: `${decision.reason} Queued as approval ${approval!.id}; a human can approve it under Settings → AI agent.`,
      };
    }

    const result = await executeTool(ctx, tool, args);
    await audit(ctx, tool, target, { args: redact(args) }, "ok");
    return { status: "ok", result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await audit(ctx, tool, null, { args: redact(args), error }, e instanceof ToolError ? "denied" : "error");
    if (!(e instanceof ToolError)) console.error(`agent tool ${tool} failed`, e);
    return { status: "error", error };
  }
}

/** A human approved a queued call: run it now (as the agent, recorded as approved by the user). */
export async function executeApproval(orgId: string, approvalId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  // Claim it atomically so a double click can't run it twice.
  const { data: claimed } = await admin
    .from("agent_approvals")
    .update({ status: "executed", decided_by: userId, decided_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", approvalId)
    .eq("status", "pending")
    .select("tool, args, api_key_id, campaign_id")
    .maybeSingle();
  if (!claimed || !isAgentTool(claimed.tool)) return { ok: false, error: "This request was already decided." };
  const ctx: AgentCtx = { orgId, apiKeyId: claimed.api_key_id, actor: `agent:${claimed.api_key_id ?? "deleted-key"}` };
  const target = claimed.campaign_id ? `campaign:${claimed.campaign_id}` : null;
  try {
    const result = await executeTool(ctx, claimed.tool, claimed.args);
    await admin.from("agent_approvals").update({ result: (result ?? null) as never }).eq("id", approvalId);
    await audit(ctx, claimed.tool, target, { approval_id: approvalId, approved_by: `user:${userId}` }, "ok");
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await admin.from("agent_approvals").update({ status: "failed", error }).eq("id", approvalId);
    await audit(ctx, claimed.tool, target, { approval_id: approvalId, approved_by: `user:${userId}`, error }, "error");
    return { ok: false, error };
  }
}
