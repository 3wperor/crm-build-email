import { describe, expect, it } from "vitest";
import { effectiveApprovalMode } from "./approval";

describe("effectiveApprovalMode", () => {
  it("is auto only when both org and campaign opt in", () => {
    expect(effectiveApprovalMode("auto", "auto")).toBe("auto");
    expect(effectiveApprovalMode("auto", "draft")).toBe("draft");
    expect(effectiveApprovalMode("draft", "auto")).toBe("draft");
    expect(effectiveApprovalMode("draft", "draft")).toBe("draft");
  });
});
