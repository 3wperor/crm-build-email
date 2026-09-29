import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AgentApi } from "./api.ts";
import { createMcpServer } from "./server.ts";

const KEY = "ycr_" + "k".repeat(43);

/** A fake YCAReach agent API. */
function fakeFetch(calls: { url: string; init?: RequestInit }[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if ((init?.headers as Record<string, string>)?.authorization !== `Bearer ${KEY}`) return new Response("{}", { status: 401 });
    if (!init?.method) {
      return Response.json({
        tools: [{ name: "start_campaign", description: "Start [send]", inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] } }],
      });
    }
    const { tool } = JSON.parse(String(init.body)) as { tool: string };
    if (tool === "start_campaign") return Response.json({ status: "pending_approval", approval_id: "a1", message: "Needs approval" });
    if (tool === "list_campaigns") return Response.json({ status: "ok", result: [{ id: "c1", name: "Q4" }] });
    return Response.json({ status: "error", error: `Unknown tool ${tool}` }, { status: 422 });
  }) as typeof fetch;
}

async function connect(key = KEY) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const server = createMcpServer(new AgentApi("https://app.test/", key, fakeFetch(calls)));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  return { client, calls };
}

describe("YCAReach MCP server", () => {
  it("lists the tools the web app publishes, and exposes instructions", async () => {
    const { client, calls } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["start_campaign"]);
    expect(calls[0]!.url).toBe("https://app.test/api/agent");
    expect(client.getInstructions()).toContain("pending_approval");
  });

  it("forwards calls with the API key and returns results as JSON text", async () => {
    const { client, calls } = await connect();
    const r = await client.callTool({ name: "list_campaigns", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse((r.content as { text: string }[])[0]!.text)).toEqual([{ id: "c1", name: "Q4" }]);
    expect(JSON.parse(String(calls.at(-1)!.init!.body))).toEqual({ tool: "list_campaigns", args: {} });
  });

  it("surfaces pending approvals (not an error) and errors (isError)", async () => {
    const { client } = await connect();
    const pending = await client.callTool({ name: "start_campaign", arguments: { campaign_id: "c1" } });
    expect(pending.isError).toBeFalsy();
    expect((pending.content as { text: string }[])[0]!.text).toContain('"status": "pending_approval"');
    const bad = await client.callTool({ name: "nope", arguments: {} });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0]!.text).toBe("Unknown tool nope");
  });

  it("reports a rejected API key clearly", async () => {
    const { client } = await connect("ycr_" + "x".repeat(43));
    const r = await client.callTool({ name: "list_campaigns", arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toContain("rejected the API key");
    await expect(client.listTools()).rejects.toThrow(/rejected the API key/);
  });
});
