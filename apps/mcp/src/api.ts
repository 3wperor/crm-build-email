/**
 * Talks to the YCAReach web app's agent API. All logic, guardrails and audit
 * logging live there; this process only translates MCP <-> HTTP.
 */
export type ToolInfo = { name: string; description: string; inputSchema: Record<string, unknown> };
export type AgentResult =
  | { status: "ok"; result: unknown }
  | { status: "pending_approval"; approval_id: string; message: string }
  | { status: "error"; error: string };

export class AgentApi {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  private headers() {
    return { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" };
  }

  async listTools(): Promise<ToolInfo[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/agent`, { headers: this.headers() });
    if (res.status === 401) throw new Error("YCAReach rejected the API key (invalid or revoked).");
    if (!res.ok) throw new Error(`YCAReach agent API returned ${res.status}`);
    return ((await res.json()) as { tools: ToolInfo[] }).tools;
  }

  async call(tool: string, args: unknown): Promise<AgentResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/agent`, { method: "POST", headers: this.headers(), body: JSON.stringify({ tool, args }) });
    if (res.status === 401) return { status: "error", error: "YCAReach rejected the API key (invalid or revoked)." };
    try {
      return (await res.json()) as AgentResult;
    } catch {
      return { status: "error", error: `YCAReach agent API returned ${res.status}` };
    }
  }
}
