import { agentToolJsonSchemas } from "@crm/core";
import { authenticateApiKey } from "@/lib/agent/keys";
import { runAgentTool } from "@/lib/agent/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const unauthorized = () => Response.json({ error: "Invalid or revoked API key" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

/** Tool catalog (names, descriptions, JSON Schemas). */
export async function GET(request: Request) {
  const key = await authenticateApiKey(request.headers.get("authorization"));
  if (!key) return unauthorized();
  return Response.json({ workspace_key: key.name, tools: agentToolJsonSchemas() });
}

/** { "tool": "list_campaigns", "args": { … } } → { status: ok | pending_approval | error, … } */
export async function POST(request: Request) {
  const key = await authenticateApiKey(request.headers.get("authorization"));
  if (!key) return unauthorized();
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
