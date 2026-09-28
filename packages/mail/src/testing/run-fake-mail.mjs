// Local end-to-end helper: node --experimental-strip-types packages/mail/src/testing/run-fake-mail.mjs
// SMTP :2525, IMAP :2143, HTTP control :2580
//   GET  /            captured SMTP messages       DELETE /  clear them
//   POST /imap/INBOX  append raw message body      GET /imap mailbox summary
import http from "node:http";
import { startFakeMail } from "./fake-mail.ts";

const fake = await startFakeMail({ smtpPort: 2525, imapPort: 2143 });
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/" && req.method === "DELETE") fake.captured.length = 0;
      if (req.url?.startsWith("/imap/") && req.method === "POST") {
        const uid = fake.append(decodeURIComponent(req.url.slice(6)), body);
        return res.end(JSON.stringify({ uid }));
      }
      if (req.url === "/imap") {
        return res.end(JSON.stringify(Object.fromEntries([...fake.mailboxes].map(([k, v]) => [k, { uidValidity: v.uidValidity, count: v.messages.length }]))));
      }
      res.end(JSON.stringify(fake.captured));
    });
  })
  .listen(2580, "127.0.0.1", () => console.log("fake mail up: smtp 2525, imap 2143, http 2580"));
