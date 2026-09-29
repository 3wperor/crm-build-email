import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AgentApi } from "./api.ts";

export const INSTRUCTIONS = [
  "YCAReach cold-email CRM. You act on one workspace through these tools.",
  "Guardrails are enforced server-side: actions that would send email (start_campaign, raising volume, test emails to non-members) return",
  "status 'pending_approval' unless the workspace and campaign are in full-auto; tell the user a human must approve it in Settings → AI agent.",
  "pause_campaign, add_to_suppression and pause_all_sending (the kill switch) always work. You cannot resume sending.",
  "Every call is audit-logged.",
].join(" ");

/** One MCP server bound to one API key. */
export function createMcpServer(api: AgentApi): Server {
  const server = new Server({ name: "ycareach", version: "1.0.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await api.listTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await api.call(req.params.name, req.params.arguments ?? {});
    if (r.status === "error") return { isError: true, content: [{ type: "text", text: r.error }] };
    if (r.status === "pending_approval") {
      return { content: [{ type: "text", text: JSON.stringify({ status: "pending_approval", approval_id: r.approval_id, message: r.message }, null, 2) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(r.result, null, 2) }] };
  });

  return server;
}
