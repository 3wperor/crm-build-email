import { describe, expect, it } from "vitest";
import {
  classifyReplyHeuristic,
  extractMessageIds,
  extractReplyText,
  isAutoReply,
  isBounceMessage,
  parseBounce,
  parseOooReturnDate,
  pickReplyMatch,
} from "./replies";

const received = new Date("2026-09-28T12:00:00Z");
const quoted = "\n\nOn Mon, Sep 28, 2026 at 9:00 AM Jane <jane@acme.io> wrote:\n> Hi Ada, interested in a quick chat?\n> Jane";
const c = (text: string, subject = "Re: Quick question", headers?: Record<string, string>) =>
  classifyReplyHeuristic({ subject, text, headers, receivedAt: received });

describe("extractReplyText", () => {
  it("strips Gmail quotes, > lines and signatures", () => {
    expect(extractReplyText("Sounds good!\n--\nAda Lovelace\nCTO" + quoted)).toBe("Sounds good!");
  });
  it("handles Outlook separators and wrapped Gmail headers", () => {
    expect(extractReplyText("No thanks.\n\n-----Original Message-----\nFrom: Jane\nSent: Monday\nI'm interested?")).toBe("No thanks.");
    expect(extractReplyText("Yes please\n\nOn Mon, Sep 28, 2026 at 9:00 AM Jane Smith <jane@acme.io>\nwrote:\n> old")).toBe("Yes please");
    expect(extractReplyText("Ok\n\nFrom: Jane <j@a.io>\nSent: Monday, September 28\nTo: Ada\nSubject: x\n\nold")).toBe("Ok");
  });
});

describe("classifyReplyHeuristic", () => {
  it.each([
    ["Sounds good — let's chat Thursday?", "positive"],
    ["I'm interested, can you send more info?", "positive"],
    ["Yes, here's my calendar: https://calendly.com/ada", "positive"],
    ["Not interested, thanks.", "negative"],
    ["No thanks, we're all set with our current vendor.", "negative"],
    ["Please remove me from your list.", "unsubscribe"],
    ["Not interested. Stop emailing me.", "unsubscribe"],
    ["unsubscribe", "unsubscribe"],
    ["Who is this?", "neutral"],
  ])("%s → %s", (text, expected) => {
    expect(c(text + quoted).classification).toBe(expected);
  });

  it("explains itself with the matched phrase", () => {
    expect(c("Sounds good — let's chat Thursday?").reason).toBe('matched "let\'s chat"');
  });

  it("ignores words that only appear in the quoted original", () => {
    // The quote says "interested"; the reply itself says nothing classifiable.
    expect(c("Forwarding to my colleague." + quoted)).toMatchObject({ classification: "neutral", confidence: "low" });
  });

  it("detects out-of-office by headers, subject or wording, with a return date", () => {
    const byHeader = c("I am away.", "Re: Quick question", { "Auto-Submitted": "auto-replied" });
    expect(byHeader.classification).toBe("out_of_office");
    const bySubject = c("I'm back on October 5 and will reply then.", "Automatic reply: Quick question");
    expect(bySubject).toMatchObject({ classification: "out_of_office", oooUntil: new Date("2026-10-05T00:00:00Z") });
    const byBody = c("I am currently out of the office with limited access to email.");
    expect(byBody.classification).toBe("out_of_office");
    expect(byBody.oooUntil).toEqual(new Date(received.getTime() + 3 * 864e5)); // default +3 days
  });

  it("does not treat Auto-Submitted: no as an auto-reply", () => {
    expect(isAutoReply({ subject: "Re: hi", headers: { "Auto-Submitted": "no" } })).toBe(false);
  });
});

describe("parseOooReturnDate", () => {
  it.each([
    ["I will be back on Monday, October 5th.", "2026-10-05"],
    ["Returning 2026-10-12.", "2026-10-12"],
    ["Out until 10/07.", "2026-10-07"],
    ["Back 5 January 2027", "2027-01-05"],
    ["I return on January 3", "2027-01-03"], // month already passed this year → next year
  ])("%s → %s", (text, iso) => {
    expect(parseOooReturnDate(text, received)?.toISOString().slice(0, 10)).toBe(iso);
  });
  it("returns null without a cue or date", () => {
    expect(parseOooReturnDate("I'm on vacation.", received)).toBeNull();
    expect(parseOooReturnDate("Back soon", received)).toBeNull();
  });
});

describe("bounces", () => {
  const dsn = [
    "From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    "Subject: Delivery Status Notification (Failure)",
    "Content-Type: multipart/report; report-type=delivery-status; boundary=b",
    "",
    "--b",
    "Content-Type: message/delivery-status",
    "",
    "Final-Recipient: rfc822; Ghost@Nowhere.io",
    "Action: failed",
    "Status: 5.1.1",
    "Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does",
    " not exist.",
    "",
    "--b",
    "Content-Type: text/rfc822-headers",
    "",
    "Message-ID: <abc123.xyz@acme.io>",
    "--b--",
  ].join("\r\n");

  it("recognizes DSNs", () => {
    expect(isBounceMessage({ from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)" })).toBe(true);
    expect(isBounceMessage({ from: "x@y.io", subject: "hi", contentType: "multipart/report; report-type=delivery-status" })).toBe(true);
    expect(isBounceMessage({ from: "ada@x.io", subject: "Re: Delivery" })).toBe(false);
  });

  it("parses status, recipient and diagnostic", () => {
    expect(parseBounce(dsn)).toEqual({
      permanent: true,
      status: "5.1.1",
      recipient: "ghost@nowhere.io",
      diagnostic: "smtp; 550-5.1.1 The email account that you tried to reach does not exist.",
    });
    expect(parseBounce("Action: delayed\nStatus: 4.4.1\n").permanent).toBe(false);
  });

  it("extracts embedded Message-IDs", () => {
    expect(extractMessageIds(dsn)).toEqual(["<abc123.xyz@acme.io>"]);
  });
});

describe("pickReplyMatch", () => {
  const cand = (sendId: string, messageId: string, sentAt = "2026-09-20T10:00:00Z", leadEmail = "ada@x.io") => ({
    sendId,
    leadId: `lead-${sendId}`,
    leadEmail,
    messageId,
    sentAt,
  });
  const base = { inReplyTo: null, references: [], fromEmail: "Ada@X.io", receivedAt: received, byMessageId: [], byLeadEmail: [] };

  it("prefers In-Reply-To, then the newest matching reference", () => {
    const byMessageId = [cand("s1", "<m1@a>"), cand("s2", "<m2@a>")];
    expect(pickReplyMatch({ ...base, inReplyTo: "<m2@a>", references: ["<m1@a>"], byMessageId })).toEqual({ sendId: "s2", leadId: "lead-s2", method: "in_reply_to" });
    expect(pickReplyMatch({ ...base, inReplyTo: "<unknown@x>", references: ["<m1@a>", "<m2@a>"], byMessageId })).toMatchObject({
      sendId: "s2",
      method: "references",
    });
  });

  it("falls back to the sender address within 30 days, most recent first", () => {
    const byLeadEmail = [cand("old", "<o@a>", "2026-08-01T10:00:00Z"), cand("s1", "<m1@a>", "2026-09-10T10:00:00Z"), cand("s2", "<m2@a>", "2026-09-25T10:00:00Z")];
    expect(pickReplyMatch({ ...base, byLeadEmail })).toMatchObject({ sendId: "s2", method: "from_email" });
    expect(pickReplyMatch({ ...base, byLeadEmail: [cand("old", "<o@a>", "2026-08-01T10:00:00Z")] })).toBeNull();
    expect(pickReplyMatch({ ...base, fromEmail: "other@x.io", byLeadEmail })).toBeNull();
  });
});
