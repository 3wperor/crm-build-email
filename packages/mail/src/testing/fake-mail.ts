/**
 * In-process fake SMTP + IMAP servers for tests and local end-to-end runs.
 * Plain TypeScript (no enums / parameter properties) so Node can run it with
 * --experimental-strip-types. Not for production use.
 *
 * SMTP: EHLO, AUTH PLAIN/LOGIN, MAIL/RCPT/DATA (captures messages; RCPT to
 *       "bounce*" is rejected with 550).
 * IMAP: LOGIN, LIST (INBOX + Spam flagged \Junk), SELECT/EXAMINE with
 *       UIDVALIDITY/UIDNEXT, UID FETCH <range> (BODY[]), LOGOUT.
 */
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

export type Captured = { from: string; to: string[]; data: string };
type Stored = { uid: number; raw: string };
type Mailbox = { uidValidity: number; uidNext: number; messages: Stored[]; flags: string };

export type FakeMail = {
  smtpPort: number;
  imapPort: number;
  captured: Captured[];
  mailboxes: Map<string, Mailbox>;
  append(mailbox: string, raw: string): number;
  resetUidValidity(mailbox: string): void;
  close(): Promise<void>;
};

export const FAKE_USER = "me@example.test";
export const FAKE_PASS = "correct-horse";

function lines(sock: Socket, onLine: (line: string) => void) {
  let buf = "";
  sock.on("data", (chunk) => {
    buf += chunk.toString("latin1");
    let idx;
    while ((idx = buf.indexOf("\r\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      onLine(line);
    }
  });
  sock.on("error", () => {});
}

function smtpServer(captured: Captured[], user: string, pass: string): Server {
  return createServer((sock) => {
    let loginStep = 0;
    let loginUser = "";
    let inData = false;
    let data = "";
    let from = "";
    let to: string[] = [];
    sock.write("220 fake.test ESMTP\r\n");
    lines(sock, (line) => {
      if (inData) {
        if (line === ".") {
          inData = false;
          captured.push({ from, to, data });
          sock.write("250 2.0.0 OK queued\r\n");
        } else data += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
        return;
      }
      if (loginStep === 1) {
        loginUser = Buffer.from(line, "base64").toString();
        loginStep = 2;
        sock.write("334 UGFzc3dvcmQ6\r\n");
        return;
      }
      if (loginStep === 2) {
        loginStep = 0;
        const ok = loginUser === user && Buffer.from(line, "base64").toString() === pass;
        sock.write(ok ? "235 2.7.0 ok\r\n" : "535 5.7.8 Authentication credentials invalid\r\n");
        return;
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
          sock.write(u === user && p === pass ? "235 2.7.0 ok\r\n" : "535 5.7.8 Authentication credentials invalid\r\n");
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
          if (rcpt.startsWith("bounce")) sock.write("550 5.1.1 The email account that you tried to reach does not exist\r\n");
          else {
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
    });
  });
}

/** Parses "a:b,c" with "*" = max uid. RFC 3501: "n:*" includes the last message even if n > max. */
function uidSet(spec: string, maxUid: number): (uid: number) => boolean {
  const ranges = spec.split(",").map((part) => {
    const [a, b] = part.split(":");
    const lo = a === "*" ? maxUid : Number(a);
    const hi = b === undefined ? lo : b === "*" ? maxUid : Number(b);
    return [Math.min(lo, hi), Math.max(lo, hi)] as const;
  });
  return (uid) => ranges.some(([lo, hi]) => uid >= lo && uid <= hi);
}

function unquote(s: string | undefined): string {
  return (s ?? "").replace(/^"(.*)"$/, "$1");
}

function imapServer(mailboxes: Map<string, Mailbox>, user: string, pass: string): Server {
  return createServer((sock) => {
    let selected: Mailbox | null = null;
    sock.write("* OK [CAPABILITY IMAP4rev1] fake ready\r\n");
    lines(sock, (line) => {
      const m = /^(\S+)\s+(?:(UID)\s+)?(\S+)\s*(.*)$/i.exec(line);
      if (!m) return;
      const [, tag, uidPrefix, cmdRaw, args] = m;
      const cmd = cmdRaw!.toUpperCase();
      if (cmd === "CAPABILITY") return void sock.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`);
      if (cmd === "LOGIN") {
        const ok = line.includes(user) && line.includes(pass);
        return void sock.write(ok ? `${tag} OK [CAPABILITY IMAP4rev1] logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
      }
      if (cmd === "LIST") {
        // `LIST "" ""` only asks for the hierarchy delimiter (RFC 3501 §6.3.8).
        if (/^""\s+""$/.test(args!.trim())) return void sock.write(`* LIST (\\Noselect) "/" ""\r\n${tag} OK done\r\n`);
        let out = "";
        for (const [name, mb] of mailboxes) out += `* LIST (${mb.flags}) "/" "${name}"\r\n`;
        return void sock.write(`${out}${tag} OK done\r\n`);
      }
      if (cmd === "SELECT" || cmd === "EXAMINE") {
        const name = unquote(args!.split(" ")[0]);
        const mb = mailboxes.get(name.toUpperCase() === "INBOX" ? "INBOX" : name);
        if (!mb) return void sock.write(`${tag} NO no such mailbox\r\n`);
        selected = mb;
        return void sock.write(
          `* FLAGS (\\Seen)\r\n* ${mb.messages.length} EXISTS\r\n* OK [UIDVALIDITY ${mb.uidValidity}] ok\r\n* OK [UIDNEXT ${mb.uidNext}] ok\r\n${tag} OK [${cmd === "EXAMINE" ? "READ-ONLY" : "READ-WRITE"}] done\r\n`,
        );
      }
      if (cmd === "FETCH" && uidPrefix && selected) {
        const spec = args!.split(" ")[0]!;
        const maxUid = selected.messages.at(-1)?.uid ?? 0;
        const inSet = uidSet(spec, maxUid);
        selected.messages.forEach((msg, i) => {
          if (!inSet(msg.uid)) return;
          const body = Buffer.from(msg.raw, "latin1");
          sock.write(`* ${i + 1} FETCH (UID ${msg.uid} BODY[] {${body.length}}\r\n`);
          sock.write(body);
          sock.write(")\r\n");
        });
        return void sock.write(`${tag} OK done\r\n`);
      }
      if (cmd === "LOGOUT") return void sock.end(`* BYE bye\r\n${tag} OK done\r\n`);
      if (cmd === "NAMESPACE") return void sock.write(`* NAMESPACE (("" "/")) NIL NIL\r\n${tag} OK done\r\n`);
      sock.write(`${tag} OK done\r\n`);
    });
  });
}

const listen = (s: Server, port: number) =>
  new Promise<number>((resolve) => s.listen(port, "127.0.0.1", () => resolve((s.address() as AddressInfo).port)));

export async function startFakeMail(opts: { smtpPort?: number; imapPort?: number; user?: string; pass?: string } = {}): Promise<FakeMail> {
  const user = opts.user ?? FAKE_USER;
  const pass = opts.pass ?? FAKE_PASS;
  const captured: Captured[] = [];
  const mailboxes = new Map<string, Mailbox>([
    ["INBOX", { uidValidity: 1, uidNext: 1, messages: [], flags: "\\HasNoChildren" }],
    ["Spam", { uidValidity: 7, uidNext: 1, messages: [], flags: "\\HasNoChildren \\Junk" }],
  ]);
  const smtp = smtpServer(captured, user, pass);
  const imap = imapServer(mailboxes, user, pass);
  const [smtpPort, imapPort] = await Promise.all([listen(smtp, opts.smtpPort ?? 0), listen(imap, opts.imapPort ?? 0)]);
  return {
    smtpPort,
    imapPort,
    captured,
    mailboxes,
    append(mailbox, raw) {
      const mb = mailboxes.get(mailbox);
      if (!mb) throw new Error(`no mailbox ${mailbox}`);
      const uid = mb.uidNext++;
      mb.messages.push({ uid, raw: raw.replace(/\r?\n/g, "\r\n") });
      return uid;
    },
    resetUidValidity(mailbox) {
      const mb = mailboxes.get(mailbox)!;
      mb.uidValidity += 1;
    },
    close: () => new Promise<void>((r) => smtp.close(() => imap.close(() => r()))),
  };
}
