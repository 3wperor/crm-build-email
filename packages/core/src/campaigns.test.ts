import { describe, expect, it } from "vitest";
import { campaignSettingsSchema, campaignStartProblems, nextAbGroup, type StartCheckInput } from "./campaigns";

const settings = {
  name: "Q4",
  timezone: "America/New_York",
  sendWindowStart: "09:00",
  sendWindowEnd: "17:00",
  sendDays: ["1", "2", "3", "3"],
  dailyLimit: "50",
  dailyLimitPerInbox: "25",
  includeRisky: "on",
};

describe("campaignSettingsSchema", () => {
  it("parses form values", () => {
    expect(campaignSettingsSchema.parse(settings)).toMatchObject({
      sendDays: [1, 2, 3],
      dailyLimit: 50,
      dailyLimitPerInbox: 25,
      includeRisky: true,
      approvalMode: "draft",
      accountIds: [],
    });
  });

  it("rejects bad windows and limits", () => {
    expect(campaignSettingsSchema.safeParse({ ...settings, sendWindowEnd: "09:00" }).success).toBe(false);
    expect(campaignSettingsSchema.safeParse({ ...settings, sendWindowStart: "25:00" }).success).toBe(false);
    expect(campaignSettingsSchema.safeParse({ ...settings, sendDays: [] }).success).toBe(false);
    expect(campaignSettingsSchema.safeParse({ ...settings, timezone: "Nowhere/City" }).success).toBe(false);
    expect(campaignSettingsSchema.safeParse({ ...settings, dailyLimit: "20000" }).success).toBe(false);
  });

  it("allows overnight windows", () => {
    expect(campaignSettingsSchema.safeParse({ ...settings, sendWindowStart: "22:00", sendWindowEnd: "02:00" }).success).toBe(true);
  });
});

describe("campaignStartProblems", () => {
  const ready: StartCheckInput = {
    steps: [
      { step_order: 1, variants: [{ subject: "Hi", body: "Body", is_active: true, weight: 100 }] },
      { step_order: 2, variants: [{ subject: "", body: "Follow-up", is_active: true, weight: 100 }] },
    ],
    inboxes: [{ status: "active", health: "healthy" }],
    physicalAddress: "1 Main St",
    enrolled: 10,
    dailyLimit: 50,
    dailyLimitPerInbox: 30,
  };

  it("is ready when everything is in place (follow-ups may have empty subjects)", () => {
    expect(campaignStartProblems(ready)).toEqual([]);
  });

  it("lists every problem", () => {
    const problems = campaignStartProblems({
      steps: [{ step_order: 1, variants: [{ subject: "", body: "b", is_active: true, weight: 100 }] }, { step_order: 2, variants: [] }],
      inboxes: [{ status: "active", health: "failing" }],
      physicalAddress: " ",
      enrolled: 0,
      dailyLimit: 0,
      dailyLimitPerInbox: 5,
    });
    expect(problems).toEqual([
      "Every active variant of step 1 needs a subject.",
      "Step 2 needs an active variant with a body.",
      "Attach at least one active, healthy inbox.",
      "Set your physical mailing address in Settings (required in every email footer).",
      "Add leads to the campaign.",
      "Daily limits must be above zero.",
    ]);
  });

  it("requires steps", () => {
    expect(campaignStartProblems({ ...ready, steps: [] })[0]).toMatch(/at least one step/);
  });
});

describe("nextAbGroup", () => {
  it("returns the next free letter", () => {
    expect(nextAbGroup([])).toBe("A");
    expect(nextAbGroup(["A", "B"])).toBe("C");
    expect(nextAbGroup(["A", "C"])).toBe("B");
  });
});
