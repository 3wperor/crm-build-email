/**
 * YCAReach MCP server.
 *
 *   stdio (Claude Desktop / Claude Code):
 *     YCAREACH_URL=https://app.example.com YCAREACH_API_KEY=ycr_… node --experimental-strip-types src/index.ts
 *   HTTP (Streamable HTTP, stateless) on MCP_PORT (default 3333), path /mcp:
 *     … src/index.ts --http
 *   In HTTP mode each request authenticates with its own "Authorization: Bearer ycr_…"
 *   (falling back to YCAREACH_API_KEY), so one server can front many workspaces.
 */
import http from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AgentApi } from "./api.ts";
import { createMcpServer } from "./server.ts";

const baseUrl = process.env.YCAREACH_URL ?? "http://localhost:3000";
const envKey = process.env.YCAREACH_API_KEY ?? "";

if (process.argv.includes("--http")) {
  const port = Number(process.env.MCP_PORT ?? 3333);
  http
    .createServer(async (req, res) => {
      if (!req.url?.startsWith("/mcp")) return void res.writeHead(404).end();
      if (req.method !== "POST") return void res.writeHead(405, { allow: "POST" }).end();
      const key = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? envKey;
      if (!key) return void res.writeHead(401, { "www-authenticate": "Bearer" }).end("Missing API key");
      let body = "";
      for await (const chunk of req) body += chunk;
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return void res.writeHead(400).end("Invalid JSON");
      }
      // Stateless: a fresh server + transport per request.
      const server = createMcpServer(new AgentApi(baseUrl, key));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    })
    .listen(port, () => console.error(`YCAReach MCP (HTTP) on :${port}/mcp → ${baseUrl}`));
} else {
  if (!envKey) {
    console.error("Set YCAREACH_API_KEY (create one in YCAReach → Settings → AI agent).");
    process.exit(1);
  }
  const server = createMcpServer(new AgentApi(baseUrl, envKey));
  await server.connect(new StdioServerTransport());
  console.error(`YCAReach MCP (stdio) → ${baseUrl}`);
}
