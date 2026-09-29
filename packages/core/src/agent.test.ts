import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, AGENT_TOOL_NAMES, agentGuard, agentToolJsonSchemas, isAgentTool, looksLikeApiKey } from "./agent";

describe("agent tool catalog", () => {
  it("covers every tool from the spec plus enroll + kill switch", () => {
    const spec = [
      "list_campaigns", "get_campaign", "create_campaign", "update_campaign",
      "upload_leads", "verify_leads", "list_leads",
      "add_sending_account", "test_sending_account", "send_test_email",
      "start_campaign", "pause_campaign", "set_daily_volume", "set_send_window",
      "get_analytics", "get_sending_status",
      "list_replies", "get_lead", "classify_reply",
      "create_sequence", "add_sequence_step", "create_variant",
      "move_lead_stage", "add_to_suppression",
      "get_agent_audit_log",
    ];
    for (const t of spec) expect(isAgentTool(t)).toBe(true);
    expect(isAgentTool("pause_all_sending")).toBe(true);
    expect(isAgentTool("enroll_leads")).toBe(true);
    expect(isAgentTool("resume_sending")).toBe(false);
    expect(isAgentTool("toString")).toBe(false);
  });

  it("never exposes a way to resume sending, change approval mode or unsuppress", () => {
    expect(AGENT_TOOL_NAMES.some((n) => /resume|unsuppress|remove_suppression|approval/.test(n))).toBe(false);
    const update = AGENT_TOOLS.update_campaign.input.safeParse({ campaign_id: "00000000-0000-4000-8000-000000000001", approval_mode: "auto" });
    expect(update.success && !("approval_mode" in update.data)).toBe(true);
  });

  it("classifies risk so the brakes are always available", () => {
    expect(AGENT_TOOLS.pause_all_sending.risk).toBe("safety");
    expect(AGENT_TOOLS.pause_campaign.risk).toBe("safety");
    expect(AGENT_TOOLS.add_to_suppression.risk).toBe("safety");
    expect(AGENT_TOOLS.start_campaign.risk).toBe("send");
    expect(AGENT_TOOLS.set_daily_volume.risk).toBe("send");
    expect(AGENT_TOOLS.send_test_email.risk).toBe("send");
    expect(AGENT_TOOLS.list_leads.risk).toBe("read");
  });

  it("enforces hard caps in the input schemas", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(AGENT_TOOLS.set_daily_volume.input.safeParse({ campaign_id: id, daily_limit: 100000 }).success).toBe(false);
    expect(AGENT_TOOLS.set_send_window.input.safeParse({ campaign_id: id, start: "25:00", end: "17:00", days: [1] }).success).toBe(false);
    expect(AGENT_TOOLS.upload_leads.input.safeParse({ leads: [] }).success).toBe(false);
  });

  it("publishes JSON schemas for MCP clients", () => {
    const s = agentToolJsonSchemas();
    expect(s).toHaveLength(AGENT_TOOL_NAMES.length);
    const start = s.find((t) => t.name === "start_campaign")!;
    expect(start.inputSchema).toMatchObject({ type: "object", required: ["campaign_id"] });
    expect(start.description).toContain("[send]");
  });
});

describe("agentGuard", () => {
  it("always allows reads, writes and safety actions", () => {
    for (const risk of ["read", "write", "safety"] as const) expect(agentGuard({ risk, orgMode: "draft", campaignMode: "draft" })).toEqual({ action: "allow" });
  });

  it("needs approval for sending actions unless BOTH workspace and campaign are full-auto", () => {
    expect(agentGuard({ risk: "send", orgMode: "draft", campaignMode: "auto" }).action).toBe("approval");
    expect(agentGuard({ risk: "send", orgMode: "auto", campaignMode: "draft" }).action).toBe("approval");
    expect(agentGuard({ risk: "send", orgMode: "auto", campaignMode: "auto" }).action).toBe("allow");
  });

  it("uses the workspace mode when no campaign is involved", () => {
    expect(agentGuard({ risk: "send", orgMode: "draft" }).action).toBe("approval");
    expect(agentGuard({ risk: "send", orgMode: "auto", campaignMode: null }).action).toBe("allow");
  });

  it("lets harmless instances of send tools through (lowering volume, tests to members)", () => {
    expect(agentGuard({ risk: "send", orgMode: "draft", campaignMode: "draft", harmless: true }).action).toBe("allow");
  });

  it("explains why approval is needed", () => {
    const d = agentGuard({ risk: "send", orgMode: "auto", campaignMode: "draft" });
    expect(d.action === "approval" && d.reason).toContain("campaign is in draft mode");
  });
});

describe("looksLikeApiKey", () => {
  it("checks the key format", () => {
    expect(looksLikeApiKey("ycr_" + "a".repeat(43))).toBe(true);
    expect(looksLikeApiKey("ycr_short")).toBe(false);
    expect(looksLikeApiKey("sk_" + "a".repeat(44))).toBe(false);
  });
});
