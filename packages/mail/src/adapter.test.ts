import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMailAdapter, ProviderNotImplementedError, SmtpImapAdapter, testConnection, type MailAccountConfig } from "./adapter";

const USER = "me@example.test";
const PASS = "correct-horse";

export const captured: { from: string; to: string[]; data: string }[] = [];

/** Minimal SMTP server: EHLO, AUTH PLAIN/LOGIN, MAIL/RCPT/DATA (captures messages). No TLS. */
function fakeSmtp(): Server {
  return createServer((sock: Socket) => {
    let loginStep: 0 | 1 | 2 = 0;
    let loginUser = "";
    let inData = false;
    let data = "";
    let from = "";
    let to: string[] = [];
    sock.write("220 fake.test ESMTP\r\n");
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            captured.push({ from, to, data });
            sock.write("250 2.0.0 OK queued\r\n");
          } else {
            data += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
          }
          continue;
        }
        if (loginStep === 1) {
          loginUser = Buffer.from(line, "base64").toString();
          loginStep = 2;
          sock.write("334 UGFzc3dvcmQ6\r\n");
          continue;
        }
        if (loginStep === 2) {
          loginStep = 0;
          const ok = loginUser === USER && Buffer.from(line, "base64").toString() === PASS;
          sock.write(ok ? "235 2.7.0 ok\r\n" : "535 5.7.8 Authentication credentials invalid\r\n");
          continue;
        }
        const [verb, ...rest] = line.split(" ");
        switch (verb?.toUpperCase()) {
          case "EHLO":
            sock.write("250-fake.test\r\n250 AUTH PLAIN LOGIN\r\n");
            break;
          case "AUTH": {
            if (rest[0]?.toUpperCase() === "LOGIN") {
              loginStep = 1;
              sock.write("334 VXNlcm5hbWU6\r\n");
              break;
            }
            const [, u, p] = Buffer.from(rest[1] ?? "", "base64").toString().split("\0");
            sock.write(u === USER && p === PASS ? "235 2.7.0 ok\r\n" : "535 5.7.8 Authentication credentials invalid\r\n");
            break;
          }
          case "MAIL":
            from = /<([^>]*)>/.exec(line)?.[1] ?? "";
            to = [];
            data = "";
            sock.write("250 2.1.0 OK\r\n");
            break;
          case "RCPT": {
            const rcpt = /<([^>]*)>/.exec(line)?.[1] ?? "";
            if (rcpt.startsWith("bounce")) {
              sock.write("550 5.1.1 The email account that you tried to reach does not exist\r\n");
            } else {
              to.push(rcpt);
              sock.write("250 2.1.5 OK\r\n");
            }
            break;
          }
          case "DATA":
            inData = true;
            sock.write("354 Go ahead\r\n");
            break;
          case "QUIT":
            sock.end("221 bye\r\n");
            break;
          default:
            sock.write("250 ok\r\n");
        }
      }
    });
    sock.on("error", () => {});
  });
}

/** Minimal IMAP server: LOGIN, EXAMINE/SELECT INBOX, LOGOUT; everything else OK. */
function fakeImap(): Server {
  return createServer((sock: Socket) => {
    sock.write("* OK [CAPABILITY IMAP4rev1] fake ready\r\n");
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const [tag, cmdRaw] = line.split(" ");
        const cmd = cmdRaw?.toUpperCase();
        if (cmd === "CAPABILITY") {
          sock.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`);
        } else if (cmd === "LOGIN") {
          const ok = line.includes(USER) && line.includes(PASS);
          sock.write(ok ? `${tag} OK [CAPABILITY IMAP4rev1] logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        } else if (cmd === "SELECT" || cmd === "EXAMINE") {
          sock.write(`* FLAGS (\\Seen)\r\n* 0 EXISTS\r\n* OK [UIDVALIDITY 1] ok\r\n* OK [UIDNEXT 1] ok\r\n${tag} OK [READ-ONLY] done\r\n`);
        } else if (cmd === "LIST") {
          sock.write(`* LIST () "/" INBOX\r\n${tag} OK done\r\n`);
        } else if (cmd === "NAMESPACE") {
          sock.write(`* NAMESPACE (("" "/")) NIL NIL\r\n${tag} OK done\r\n`);
        } else if (cmd === "LOGOUT") {
          sock.end(`* BYE bye\r\n${tag} OK done\r\n`);
        } else if (tag) {
          sock.write(`${tag} OK done\r\n`);
        }
      }
    });
    sock.on("error", () => {});
  });
}

const listen = (s: Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

let smtp: Server;
let imap: Server;
let smtpPort: number;
let imapPort: number;

beforeAll(async () => {
  smtp = fakeSmtp();
  imap = fakeImap();
  [smtpPort, imapPort] = await Promise.all([listen(smtp), listen(imap)]);
});

afterAll(() => {
  smtp.close();
  imap.close();
});

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
    captured.length = 0;
    const r = await new SmtpImapAdapter(config(PASS), localOpts).send(msg);
    expect(r).toMatchObject({ ok: true, messageId: "<abc123@example.test>" });
    expect(captured).toHaveLength(1);
    const data = captured[0]!.data;
    expect(captured[0]!.to).toEqual(["ada@example.org"]);
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

describe("createMailAdapter", () => {
  it("does not implement outlook yet", () => {
    expect(() => createMailAdapter({ ...config(PASS), provider: "outlook" })).toThrow(ProviderNotImplementedError);
  });
});
