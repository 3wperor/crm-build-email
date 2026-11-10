import { describe, expect, it } from "vitest";
import {
  assumptionsText,
  channelFacts,
  gbp,
  goalFact,
  goalProgress,
  growthPlan,
  guessEmailProvider,
  valueFact,
  welcomeAnswersSchema,
} from "./growth";

describe("facts from the user's own answers", () => {
  it("formats pounds", () => {
    expect(gbp(36000)).toBe("£36,000");
    expect(gbp(250.4)).toBe("£250");
  });
  it("turns a customer's value into a yearly figure", () => {
    expect(valueFact(1000)).toBe("So just one extra customer a month is worth £12,000 a year.");
  });
  it("turns the goal into a yearly figure", () => {
    expect(goalFact(1000, 3)).toBe("3 new customers a month = £36,000 a year in new business. Let's see what it takes.");
    expect(goalFact(5000, 1)).toMatch(/^1 new customer a month = £60,000/);
  });
  it("picks a fact per channel, in a fixed order", () => {
    expect(channelFacts(["ads", "referrals"])).toEqual([
      expect.stringMatching(/^Referrals are great/),
      expect.stringMatching(/^No cost per click/),
    ]);
    expect(channelFacts([])).toEqual([]);
  });
});

describe("growth plan", () => {
  it("works out emails and time saved from the stated assumptions", () => {
    // 3 customers / (3% reply × 1 in 5) = 500 emails; 500 × 3 min = 25 hours
    expect(growthPlan({ customerValue: 1000, customersPerMonth: 3 })).toEqual({
      customerValue: 1000,
      customersPerMonth: 3,
      example: false,
      yearlyValue: 36000,
      emailsPerMonth: 500,
      hoursSavedPerMonth: 25,
      trialEmails: 200,
    });
  });
  it("rounds emails up to the nearest 50", () => {
    expect(growthPlan({ customerValue: 250, customersPerMonth: 1 }).emailsPerMonth).toBe(200); // 166.7 → 200
  });
  it("fills skipped answers with an example and says so", () => {
    const plan = growthPlan({ customerValue: null, customersPerMonth: 5 });
    expect(plan.example).toBe(true);
    expect(plan.customerValue).toBe(1000);
  });
  it("states its assumptions plainly", () => {
    expect(assumptionsText()).toBe(
      "Rough guide: if 3 in 100 people reply and 1 in 5 replies becomes a customer. You'll see your real numbers within a week.",
    );
  });
});

describe("saved answers", () => {
  it("parses form values and treats blanks as skipped", () => {
    expect(
      welcomeAnswersSchema.parse({ customerValue: "5000", customersPerMonth: "", channels: ["ads", "referrals"], offer: " Websites ", audience: "", hasList: "no" }),
    ).toEqual({ customerValue: 5000, customersPerMonth: null, channels: ["ads", "referrals"], offer: "Websites", audience: null, hasList: false });
    expect(welcomeAnswersSchema.parse({})).toEqual({ customerValue: null, customersPerMonth: null, channels: [], offer: null, audience: null, hasList: null });
  });
  it("accepts a single channel and rejects junk", () => {
    expect(welcomeAnswersSchema.parse({ channels: "ads" }).channels).toEqual(["ads"]);
    expect(welcomeAnswersSchema.safeParse({ channels: ["telepathy"] }).success).toBe(false);
    expect(welcomeAnswersSchema.safeParse({ customerValue: "-5" }).success).toBe(false);
    expect(welcomeAnswersSchema.safeParse({ customerValue: "lots" }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("guesses the email provider from the sign-up address", () => {
    expect(guessEmailProvider("Sam@Gmail.com")).toBe("gmail");
    expect(guessEmailProvider("sam@hotmail.co.uk")).toBe("outlook");
    expect(guessEmailProvider("sam@acme.co.uk")).toBeNull();
  });
  it("tracks the monthly goal", () => {
    expect(goalProgress(3, 1, 1000)).toEqual({ goal: 3, won: 1, pct: 33, reached: false, valueWon: 1000 });
    expect(goalProgress(3, 4, null)).toMatchObject({ pct: 100, reached: true, valueWon: null });
  });
});
