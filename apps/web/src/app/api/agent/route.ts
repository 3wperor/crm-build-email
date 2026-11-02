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

const unauthorized = () => Response.json({ error: "Invalid or revoked API key" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

/** Tool catalog (names, descriptions, JSON Schemas). */
export async function GET(request: Request) {
  const key = await authenticateApiKey(request.headers.get("authorization"));
  if (!key) return unauthorized();
  const gate = await proOnly(key.orgId);
  if (gate) return gate;
  return Response.json({ workspace_key: key.name, tools: agentToolJsonSchemas() });
}

/** { "tool": "list_campaigns", "args": { … } } → { status: ok | pending_approval | error, … } */
export async function POST(request: Request) {
  const key = await authenticateApiKey(request.headers.get("authorization"));
  if (!key) return unauthorized();
  const gate = await proOnly(key.orgId);
  if (gate) return gate;
  let body: { tool?: unknown; args?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ status: "error", error: "Body must be JSON: { tool, args }" }, { status: 400 });
  }
  if (typeof body.tool !== "string") return Response.json({ status: "error", error: "Missing tool" }, { status: 400 });
  const result = await runAgentTool({ orgId: key.orgId, apiKeyId: key.apiKeyId, actor: `agent:${key.apiKeyId}` }, body.tool, body.args ?? {});
  return Response.json(result, { status: result.status === "error" ? 422 : 200 });
}
