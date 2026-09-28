/**
 * In-process fake SMTP + IMAP servers for tests and local end-to-end runs.
 * Plain TypeScript (no enums / parameter properties) so Node can run it with
 * --experimental-strip-types. Not for production use.
 *
 * Users: FAKE_USER plus any address on `localDomain` (password FAKE_PASS),
 *        each with its own INBOX + Spam.
 * SMTP: EHLO, AUTH PLAIN/LOGIN, MAIL/RCPT/DATA (captures messages; RCPT to
 *       "bounce*" is rejected with 550). Mail to a local user is also
 *       delivered to their INBOX, or to Spam if the recipient is in `spamRoute`.
 * IMAP: LOGIN, LIST (INBOX + Spam flagged \Junk), SELECT/EXAMINE with
 *       UIDVALIDITY/UIDNEXT, UID FETCH <range> (BODY[] / FLAGS),
 *       UID STORE +FLAGS, UID MOVE, LOGOUT.
 */
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

export type Captured = { from: string; to: string[]; data: string };
type Stored = { uid: number; raw: string; flags: Set<string> };
type Mailbox = { uidValidity: number; uidNext: number; messages: Stored[]; flags: string };

export type FakeMail = {
  smtpPort: number;
  imapPort: number;
  captured: Captured[];
  /** FAKE_USER's mailboxes. */
  mailboxes: Map<string, Mailbox>;
  /** Mailboxes of any user (created on first use). */
  mailboxesOf(user: string): Map<string, Mailbox>;
  /** Recipients whose incoming mail lands in Spam. */
  spamRoute: Set<string>;
  append(mailbox: string, raw: string, user?: string): number;
  resetUidValidity(mailbox: string): void;
  close(): Promise<void>;
};

type Users = { mailboxesOf(user: string): Map<string, Mailbox>; isLocal(user: string): boolean; spamRoute: Set<string> };

function newMailboxes(): Map<string, Mailbox> {
  return new Map<string, Mailbox>([
    ["INBOX", { uidValidity: 1, uidNext: 1, messages: [], flags: "\\HasNoChildren" }],
    ["Spam", { uidValidity: 7, uidNext: 1, messages: [], flags: "\\HasNoChildren \\Junk" }],
  ]);
}

function store(mb: Mailbox, raw: string, flags: string[] = []): number {
  const uid = mb.uidNext++;
  mb.messages.push({ uid, raw: raw.replace(/\r?\n/g, "\r\n"), flags: new Set(flags) });
  return uid;
}

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

function smtpServer(captured: Captured[], users: Users, pass: string): Server {
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
          for (const rcpt of to) {
            const r = rcpt.toLowerCase();
            if (users.isLocal(r)) store(users.mailboxesOf(r).get(users.spamRoute.has(r) ? "Spam" : "INBOX")!, data);
          }
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
        const ok = users.isLocal(loginUser.toLowerCase()) && Buffer.from(line, "base64").toString() === pass;
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
          sock.write(users.isLocal((u ?? "").toLowerCase()) && p === pass ? "235 2.7.0 ok\r\n" : "535 5.7.8 Authentication credentials invalid\r\n");
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

function imapServer(users: Users, pass: string): Server {
  return createServer((sock) => {
    let mailboxes: Map<string, Mailbox> | null = null;
    let selected: Mailbox | null = null;
    const CAPS = "IMAP4rev1 MOVE UIDPLUS";
    sock.write(`* OK [CAPABILITY ${CAPS}] fake ready\r\n`);
    const flagList = (m: Stored) => [...m.flags].join(" ");
    lines(sock, (line) => {
      const m = /^(\S+)\s+(?:(UID)\s+)?(\S+)\s*(.*)$/i.exec(line);
      if (!m) return;
      const [, tag, uidPrefix, cmdRaw, args] = m;
      const cmd = cmdRaw!.toUpperCase();
      if (cmd === "CAPABILITY") return void sock.write(`* CAPABILITY ${CAPS}\r\n${tag} OK done\r\n`);
      if (cmd === "LOGIN") {
        const [u, p] = (args!.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? []).map((x) => unquote(x));
        const ok = !!u && users.isLocal(u.toLowerCase()) && p === pass;
        if (ok) mailboxes = users.mailboxesOf(u!.toLowerCase());
        return void sock.write(ok ? `${tag} OK [CAPABILITY ${CAPS}] logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
      }
      if (!mailboxes && cmd !== "LOGOUT") return void sock.write(`${tag} NO not authenticated\r\n`);
      const boxes = mailboxes!;
      const byName = (raw: string | undefined) => {
        const name = unquote(raw);
        return boxes.get(name.toUpperCase() === "INBOX" ? "INBOX" : name);
      };
      if (cmd === "LIST") {
        // `LIST "" ""` only asks for the hierarchy delimiter (RFC 3501 §6.3.8).
        if (/^""\s+""$/.test(args!.trim())) return void sock.write(`* LIST (\\Noselect) "/" ""\r\n${tag} OK done\r\n`);
        let out = "";
        for (const [name, mb] of boxes) out += `* LIST (${mb.flags}) "/" "${name}"\r\n`;
        return void sock.write(`${out}${tag} OK done\r\n`);
      }
      if (cmd === "SELECT" || cmd === "EXAMINE") {
        const mb = byName(args!.split(" ")[0]);
        if (!mb) return void sock.write(`${tag} NO no such mailbox\r\n`);
        selected = mb;
        return void sock.write(
          `* FLAGS (\\Seen \\Flagged \\Deleted)\r\n* ${mb.messages.length} EXISTS\r\n* OK [UIDVALIDITY ${mb.uidValidity}] ok\r\n* OK [UIDNEXT ${mb.uidNext}] ok\r\n${tag} OK [${cmd === "EXAMINE" ? "READ-ONLY" : "READ-WRITE"}] done\r\n`,
        );
      }
      if (cmd === "FETCH" && uidPrefix && selected) {
        const spec = args!.split(" ")[0]!;
        const inSet = uidSet(spec, selected.messages.at(-1)?.uid ?? 0);
        const wantBody = /BODY/i.test(args!);
        selected.messages.forEach((msg, i) => {
          if (!inSet(msg.uid)) return;
          if (!wantBody) return void sock.write(`* ${i + 1} FETCH (UID ${msg.uid} FLAGS (${flagList(msg)}))\r\n`);
          const body = Buffer.from(msg.raw, "latin1");
          sock.write(`* ${i + 1} FETCH (UID ${msg.uid} BODY[] {${body.length}}\r\n`);
          sock.write(body);
          sock.write(")\r\n");
        });
        return void sock.write(`${tag} OK done\r\n`);
      }
      if (cmd === "STORE" && uidPrefix && selected) {
        const sm = /^(\S+)\s+([+-]?)FLAGS(\.SILENT)?\s+\(([^)]*)\)/i.exec(args!);
        if (!sm) return void sock.write(`${tag} BAD store\r\n`);
        const inSet = uidSet(sm[1]!, selected.messages.at(-1)?.uid ?? 0);
        const flags = sm[4]!.split(/\s+/).filter(Boolean);
        selected.messages.forEach((msg, i) => {
          if (!inSet(msg.uid)) return;
          if (sm[2] === "+") flags.forEach((f) => msg.flags.add(f));
          else if (sm[2] === "-") flags.forEach((f) => msg.flags.delete(f));
          else msg.flags = new Set(flags);
          if (!sm[3]) sock.write(`* ${i + 1} FETCH (UID ${msg.uid} FLAGS (${flagList(msg)}))\r\n`);
        });
        return void sock.write(`${tag} OK done\r\n`);
      }
      if (cmd === "MOVE" && uidPrefix && selected) {
        const [spec, destRaw] = args!.split(/\s+(.+)/);
        const dest = byName(destRaw);
        if (!dest) return void sock.write(`${tag} NO [TRYCREATE] no such mailbox\r\n`);
        const inSet = uidSet(spec!, selected.messages.at(-1)?.uid ?? 0);
        const src = selected;
        const moving = src.messages.filter((msg) => inSet(msg.uid));
        const newUids = moving.map((msg) => store(dest, msg.raw, [...msg.flags]));
        if (moving.length) sock.write(`* OK [COPYUID ${dest.uidValidity} ${moving.map((x) => x.uid).join(",")} ${newUids.join(",")}] moved\r\n`);
        for (const msg of moving) {
          const seq = src.messages.indexOf(msg) + 1;
          src.messages.splice(seq - 1, 1);
          sock.write(`* ${seq} EXPUNGE\r\n`);
        }
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

export async function startFakeMail(
  opts: { smtpPort?: number; imapPort?: number; user?: string; pass?: string; localDomain?: string } = {},
): Promise<FakeMail> {
  const user = (opts.user ?? FAKE_USER).toLowerCase();
  const pass = opts.pass ?? FAKE_PASS;
  const domain = (opts.localDomain ?? user.split("@")[1] ?? "example.test").toLowerCase();
  const captured: Captured[] = [];
  const all = new Map<string, Map<string, Mailbox>>();
  const spamRoute = new Set<string>();
  const users: Users = {
    isLocal: (u) => u === user || u.endsWith(`@${domain}`),
    mailboxesOf(u) {
      const key = u.toLowerCase();
      if (!all.has(key)) all.set(key, newMailboxes());
      return all.get(key)!;
    },
    spamRoute,
  };
  const mailboxes = users.mailboxesOf(user);
  const smtp = smtpServer(captured, users, pass);
  const imap = imapServer(users, pass);
  const [smtpPort, imapPort] = await Promise.all([listen(smtp, opts.smtpPort ?? 0), listen(imap, opts.imapPort ?? 0)]);
  return {
    smtpPort,
    imapPort,
    captured,
    mailboxes,
    mailboxesOf: (u) => users.mailboxesOf(u),
    spamRoute,
    append(mailbox, raw, u = user) {
      const mb = users.mailboxesOf(u).get(mailbox);
      if (!mb) throw new Error(`no mailbox ${mailbox}`);
      return store(mb, raw);
    },
    resetUidValidity(mailbox) {
      const mb = mailboxes.get(mailbox)!;
      mb.uidValidity += 1;
    },
    close: () => new Promise<void>((r) => smtp.close(() => imap.close(() => r()))),
  };
}
