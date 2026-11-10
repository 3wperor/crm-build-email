import { agentToolJsonSchemas } from "@crm/core";
import { hasProAccess, type Plan } from "@crm/core/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateApiKey } from "@/lib/agent/keys";
import { runAgentTool } from "@/lib/agent/run";

/** The AI agent is a Pro feature (also available during the trial). */
async function proOnly(orgId: string): Promise<Response | null> {
  const { data } = await createAdminClient().from("organizations").select("plan, trial_ends_at").eq("id", orgId).single();
  if (data && hasProAccess({ plan: data.plan as Plan, trial_ends_at: data.trial_ends_at })) return null;
  return Response.json({ status: "error", error: "The AI agent is part of the Pro plan. Upgrade under Billing in YCAReach." }, { status: 402 });
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Largest request we read (an upload_leads call with 1000 leads and custom fields fits comfortably). */
const MAX_BODY_BYTES = 4_000_000;
/** Calls per workspace per minute, across all of its keys. Every call is audited, so the audit log is the counter. */
const CALLS_PER_MINUTE = 240;

async function rateLimited(orgId: string): Promise<Response | null> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await createAdminClient()
    .from("agent_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("actor_type", "agent")
    .gte("created_at", since);
  if ((count ?? 0) < CALLS_PER_MINUTE) return null;
  return Response.json({ status: "error", error: "Too many requests. Wait a minute and try again." }, { status: 429, headers: { "Retry-After": "60" } });
}

const unauthorized = () => Response.json({ error: "Invalid or revoked API key" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

/** Tool catalog (names, descriptions, JSON Schemas). */
export async function GET(request: Request) {
  const key = await authenticateApiKey(request.headers.get("authorization"));
  if (!key) return unauthorized();
  const gate = await proOnly(key.orgId);
  if (gate) return gate;
  return Response.json({ workspace_key: key.name, tools: agentToolJsonSchemas() }, { headers: { "Cache-Control": "no-store" } });
}

/** { "tool": "list_campaigns", "args": { … } } → { status: ok | pending_approval | error, … } */
export async function POST(request: Request) {
  const key = await authenticateApiKey(request.headers.get("authorization"));
  if (!key) return unauthorized();
  const gate = await proOnly(key.orgId);
  if (gate) return gate;
  const limited = await rateLimited(key.orgId);
  if (limited) return limited;
  const tooLarge = () => Response.json({ status: "error", error: "Request body is too large." }, { status: 413 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  let body: { tool?: unknown; args?: unknown } | null;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return tooLarge();
    body = JSON.parse(raw);
  } catch {
    return Response.json({ status: "error", error: "Body must be JSON: { tool, args }" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || typeof body.tool !== "string" || body.tool.length > 100) return Response.json({ status: "error", error: "Missing tool" }, { status: 400 });
  const result = await runAgentTool({ orgId: key.orgId, apiKeyId: key.apiKeyId, actor: `agent:${key.apiKeyId}` }, body.tool, body.args ?? {});
  return Response.json(result, { status: result.status === "error" ? 422 : 200, headers: { "Cache-Control": "no-store" } });
}
