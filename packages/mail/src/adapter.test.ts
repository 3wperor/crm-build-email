import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_PASS, FAKE_USER, startFakeMail, type FakeMail } from "./testing/fake-mail";
import { createMailAdapter, ProviderNotImplementedError, SmtpImapAdapter, testConnection, type MailAccountConfig } from "./adapter";

const USER = FAKE_USER;
const PASS = FAKE_PASS;
let fake: FakeMail;
let smtpPort: number;
let imapPort: number;

beforeAll(async () => {
  fake = await startFakeMail();
  ({ smtpPort, imapPort } = fake);
});

afterAll(() => fake.close());
const config = (password: string): MailAccountConfig => ({
  provider: "smtp",
  email: USER,
  username: USER,
  password,
  smtpHost: "127.0.0.1",
  smtpPort,
  smtpSecure: false,
  imapHost: "127.0.0.1",
  imapPort,
  imapSecure: false,
});

const localOpts = { allowPrivateHosts: true, allowPlaintextAuth: true, timeoutMs: 3000 };

describe("SmtpImapAdapter against fake servers", () => {
  it("reports success for valid credentials", async () => {
    const result = await testConnection(new SmtpImapAdapter(config(PASS), localOpts));
    expect(result.smtp.ok).toBe(true);
    expect(result.imap.ok).toBe(true);
  });

  it("reports auth failures for both protocols", async () => {
    const result = await testConnection(new SmtpImapAdapter(config("wrong"), localOpts));
    expect(result.smtp).toMatchObject({ ok: false, error: "SMTP authentication failed" });
    expect(result.imap).toMatchObject({ ok: false, error: "IMAP authentication failed" });
  });

  it("refuses to send credentials in cleartext by default", async () => {
    const result = await testConnection(new SmtpImapAdapter(config(PASS), { allowPrivateHosts: true, timeoutMs: 3000 }));
    expect(result.smtp.ok).toBe(false);
    expect(result.imap.ok).toBe(false);
  });

  it("blocks private hosts by default (SSRF guard)", async () => {
    const result = await testConnection(new SmtpImapAdapter(config(PASS), { timeoutMs: 3000 }));
    expect(result.smtp).toMatchObject({ ok: false });
    expect((result.smtp as { error: string }).error).toMatch(/private or reserved/);
  });

  it("reports connection refused", async () => {
    const closed = { ...config(PASS), smtpPort: 1, imapPort: 1 };
    const result = await testConnection(new SmtpImapAdapter(closed, localOpts));
    expect(result.smtp).toMatchObject({ ok: false, error: "SMTP connection refused" });
    expect(result.imap).toMatchObject({ ok: false, error: "IMAP connection refused" });
  });
});

describe("SmtpImapAdapter.send", () => {
  const msg = {
    fromName: "Jane Smith",
    to: "ada@example.org",
    subject: "Quick question",
    text: "Hi Ada\n\nUnsubscribe: https://x/u/t",
    html: "<p>Hi Ada</p>",
    messageId: "<abc123@example.test>",
    inReplyTo: "<prev@example.test>",
    references: ["<first@example.test>", "<prev@example.test>"],
    headers: { "List-Unsubscribe": "<https://x/u/t>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };

  it("delivers with our Message-ID, threading and unsubscribe headers", async () => {
    fake.captured.length = 0;
    const r = await new SmtpImapAdapter(config(PASS), localOpts).send(msg);
    expect(r).toMatchObject({ ok: true, messageId: "<abc123@example.test>" });
    expect(fake.captured).toHaveLength(1);
    const data = fake.captured[0]!.data;
    expect(fake.captured[0]!.to).toEqual(["ada@example.org"]);
    expect(data).toMatch(/^Message-ID: <abc123@example.test>/m);
    expect(data).toMatch(/^In-Reply-To: <prev@example.test>/m);
    expect(data).toMatch(/^References: <first@example.test> <prev@example.test>/m);
    expect(data).toMatch(/^List-Unsubscribe: <https:\/\/x\/u\/t>/m);
    expect(data).toMatch(/^List-Unsubscribe-Post: List-Unsubscribe=One-Click/m);
    expect(data).toMatch(/^From: Jane Smith <me@example.test>/m);
    expect(data).toContain("multipart/alternative");
  });

  it("classifies a 550 recipient rejection as a hard bounce", async () => {
    const r = await new SmtpImapAdapter(config(PASS), localOpts).send({ ...msg, to: "bounce@example.org" });
    expect(r).toMatchObject({ ok: false, hardBounce: true, accountProblem: false, retryable: false });
  });

  it("classifies auth failure as an account problem (no retry, no bounce)", async () => {
    const r = await new SmtpImapAdapter(config("wrong"), localOpts).send(msg);
    expect(r).toMatchObject({ ok: false, hardBounce: false, accountProblem: true, retryable: false });
  });

  it("classifies connection failure as retryable", async () => {
    const r = await new SmtpImapAdapter({ ...config(PASS), smtpPort: 1 }, localOpts).send(msg);
    expect(r).toMatchObject({ ok: false, hardBounce: false, accountProblem: false, retryable: true });
  });
});

describe("SmtpImapAdapter.fetchNewMessages", () => {
  const raw = (n: number) => `From: Ada <ada@example.org>\nTo: me@example.test\nSubject: Re: hi ${n}\nMessage-ID: <reply-${n}@example.org>\n\nHello ${n}\n`;

  it("starts from now on first sync, then returns only new mail from INBOX and Junk", async () => {
    const adapter = new SmtpImapAdapter(config(PASS), localOpts);
    fake.append("INBOX", raw(1)); // history before the first sync is skipped
    const first = await adapter.fetchNewMessages({}, { includeJunk: true });
    expect(first.messages).toEqual([]);
    expect(first.initialized.sort()).toEqual(["INBOX", "Spam"]);
    expect(first.cursors.INBOX).toEqual({ uidValidity: 1, lastUid: 1 });

    fake.append("INBOX", raw(2));
    fake.append("INBOX", raw(3));
    fake.append("Spam", raw(4));
    const second = await adapter.fetchNewMessages(first.cursors, { includeJunk: true });
    expect(second.messages.map((m) => `${m.mailbox}:${m.uid}`)).toEqual(["INBOX:2", "INBOX:3", "Spam:1"]);
    expect(second.messages[0]!.source.toString()).toContain("Hello 2");
    expect(second.cursors.INBOX!.lastUid).toBe(3);

    const third = await adapter.fetchNewMessages(second.cursors, { includeJunk: true });
    expect(third.messages).toEqual([]); // nothing new ("3:*"-style quirk filtered)
  });

  it("respects the per-mailbox limit and resumes from the cursor", async () => {
    const adapter = new SmtpImapAdapter(config(PASS), localOpts);
    const start = await adapter.fetchNewMessages({});
    for (let i = 0; i < 5; i++) fake.append("INBOX", raw(10 + i));
    const a = await adapter.fetchNewMessages(start.cursors, { limitPerMailbox: 3 });
    expect(a.messages).toHaveLength(3);
    const b = await adapter.fetchNewMessages(a.cursors, { limitPerMailbox: 3 });
    expect(b.messages).toHaveLength(2);
  });

  it("re-initializes when UIDVALIDITY changes", async () => {
    const adapter = new SmtpImapAdapter(config(PASS), localOpts);
    const start = await adapter.fetchNewMessages({});
    fake.resetUidValidity("INBOX");
    const r = await adapter.fetchNewMessages(start.cursors);
    expect(r.initialized).toEqual(["INBOX"]);
    expect(r.messages).toEqual([]);
  });
});

describe("createMailAdapter", () => {
  it("does not implement outlook yet", () => {
    expect(() => createMailAdapter({ ...config(PASS), provider: "outlook" })).toThrow(ProviderNotImplementedError);
  });
});
