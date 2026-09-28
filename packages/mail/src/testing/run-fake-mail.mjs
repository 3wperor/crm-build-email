// Local end-to-end helper: node --experimental-strip-types packages/mail/src/testing/run-fake-mail.mjs
// SMTP :2525, IMAP :2143, HTTP control :2580. Any user @example.test logs in with the fake password.
//   GET  /                  captured SMTP messages          DELETE /  clear them
//   POST /imap/INBOX[?user=] append raw message body
//   GET  /imap[?user=]       mailboxes: uidValidity, count, messages (uid, flags, subject, messageId)
//   POST /spam/<address>     route that recipient's incoming mail to Spam   DELETE /spam/<address> undo
import http from "node:http";
import { startFakeMail, FAKE_USER } from "./fake-mail.ts";

const fake = await startFakeMail({ smtpPort: 2525, imapPort: 2143 });
const header = (raw, name) => new RegExp(`^${name}:\\s*(.*)$`, "mi").exec(raw.split("\r\n\r\n")[0])?.[1]?.trim() ?? null;

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const url = new URL(req.url ?? "/", "http://x");
      const user = url.searchParams.get("user") ?? FAKE_USER;
      if (url.pathname === "/" && req.method === "DELETE") fake.captured.length = 0;
      if (url.pathname.startsWith("/imap/") && req.method === "POST") {
        const uid = fake.append(decodeURIComponent(url.pathname.slice(6)), body, user);
        return res.end(JSON.stringify({ uid }));
      }
      if (url.pathname === "/imap") {
        const boxes = fake.mailboxesOf(user);
        return res.end(
          JSON.stringify(
            Object.fromEntries(
              [...boxes].map(([k, v]) => [
                k,
                {
                  uidValidity: v.uidValidity,
                  count: v.messages.length,
                  messages: v.messages.map((m) => ({ uid: m.uid, flags: [...m.flags], subject: header(m.raw, "Subject"), messageId: header(m.raw, "Message-ID") })),
                },
              ]),
            ),
          ),
        );
      }
      if (url.pathname.startsWith("/spam/")) {
        const addr = decodeURIComponent(url.pathname.slice(6)).toLowerCase();
        if (req.method === "DELETE") fake.spamRoute.delete(addr);
        else fake.spamRoute.add(addr);
        return res.end(JSON.stringify({ spamRoute: [...fake.spamRoute] }));
      }
      res.end(JSON.stringify(fake.captured));
    });
  })
  .listen(2580, "127.0.0.1", () => console.log("fake mail up: smtp 2525, imap 2143, http 2580"));
