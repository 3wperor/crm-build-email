import { describe, expect, it } from "vitest";
import {
  deriveHealth,
  effectiveSentToday,
  localDate,
  resolveAccountConfig,
  sendingAccountInputSchema,
  sendingAccountUpdateSchema,
} from "./sending-accounts";

describe("sendingAccountInputSchema", () => {
  it("applies Google presets, strips spaces from app passwords and uses the email as username", () => {
    const parsed = sendingAccountInputSchema.parse({
      provider: "google",
      email: "  Me@Gmail.com ",
      password: "abcd efgh ijkl mnop",
      dailyCap: "25",
    });
    const cfg = resolveAccountConfig(parsed);
    expect(cfg).toMatchObject({
      email: "me@gmail.com",
      username: "me@gmail.com",
      password: "abcdefghijklmnop",
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      smtpSecure: true,
      imapHost: "imap.gmail.com",
      imapPort: 993,
      dailyCap: 25,
      timezone: null,
    });
  });

  it("requires connection settings for generic SMTP and parses checkbox booleans", () => {
    expect(() => sendingAccountInputSchema.parse({ provider: "smtp", email: "a@b.io", password: "x" })).toThrow();

    const parsed = sendingAccountInputSchema.parse({
      provider: "smtp",
      email: "a@b.io",
      password: "x",
      username: "login-name",
      smtpHost: "Mail.B.io",
      smtpPort: "587",
      smtpSecure: "false",
      imapHost: "mail.b.io",
      imapPort: "993",
      imapSecure: "on",
    });
    const cfg = resolveAccountConfig(parsed);
    expect(cfg).toMatchObject({ smtpHost: "mail.b.io", smtpPort: 587, smtpSecure: false, imapSecure: true, username: "login-name" });
  });

  it("rejects bad input", () => {
    const base = { provider: "google", email: "me@gmail.com", password: "p" };
    expect(sendingAccountInputSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
    expect(sendingAccountInputSchema.safeParse({ ...base, password: "" }).success).toBe(false);
    expect(sendingAccountInputSchema.safeParse({ ...base, dailyCap: 0 }).success).toBe(false);
    expect(sendingAccountInputSchema.safeParse({ ...base, dailyCap: 5000 }).success).toBe(false);
    expect(sendingAccountInputSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(sendingAccountInputSchema.safeParse({ ...base, provider: "outlook" }).success).toBe(false);
    expect(
      sendingAccountInputSchema.safeParse({
        ...base,
        provider: "smtp",
        smtpHost: "evil host; rm",
        smtpPort: 25,
        imapHost: "h",
        imapPort: 993,
      }).success,
    ).toBe(false);
  });
});

describe("sendingAccountUpdateSchema", () => {
  it("accepts a valid update", () => {
    expect(
      sendingAccountUpdateSchema.parse({ dailyCap: "40", timezone: "Europe/Berlin", status: "paused", displayName: "" }),
    ).toEqual({ dailyCap: 40, timezone: "Europe/Berlin", status: "paused", displayName: null });
  });
});

describe("deriveHealth", () => {
  const ok = { ok: true as const, latencyMs: 10 };
  const bad = { ok: false as const, error: "Authentication failed" };

  it("maps check results to health", () => {
    expect(deriveHealth({ smtp: ok, imap: ok })).toEqual({ health: "healthy", score: 100, detail: null });
    expect(deriveHealth({ smtp: ok, imap: bad })).toMatchObject({ health: "degraded", detail: "IMAP: Authentication failed" });
    expect(deriveHealth({ smtp: bad, imap: ok })).toMatchObject({ health: "degraded", detail: "SMTP: Authentication failed" });
    expect(deriveHealth({ smtp: bad, imap: bad })).toMatchObject({ health: "failing", score: 0 });
  });
});

describe("effectiveSentToday", () => {
  // 2026-09-28 02:00 UTC = still 2026-09-27 in New York.
  const now = new Date("2026-09-28T02:00:00Z");

  it("computes the local date in the account timezone", () => {
    expect(localDate(now, "UTC")).toBe("2026-09-28");
    expect(localDate(now, "America/New_York")).toBe("2026-09-27");
  });

  it("returns the counter only when it refers to today in the account's timezone", () => {
    expect(effectiveSentToday({ sent_today: 12, sent_today_date: "2026-09-27", timezone: "America/New_York" }, now)).toBe(12);
    expect(effectiveSentToday({ sent_today: 12, sent_today_date: "2026-09-27", timezone: null }, now)).toBe(0);
    expect(effectiveSentToday({ sent_today: 12, sent_today_date: "2026-09-28", timezone: null }, now)).toBe(12);
    expect(effectiveSentToday({ sent_today: 12, sent_today_date: null, timezone: null }, now)).toBe(0);
  });
});
