import "server-only";
import { randomUUID } from "node:crypto";
import { brandedEmailHtml } from "@/lib/system-mail-html";
import { createMailAdapter } from "@crm/mail";
import { mailAdapterOptions } from "@/lib/sending-accounts";

/**
 * Emails from YCAReach itself to customers (trial and billing reminders),
 * sent through the owner's own inbox with an app password. Not configured →
 * nothing is sent (the in-app banners still show).
 *
 *   SYSTEM_EMAIL_ADDRESS        e.g. hello@yourbrand.com
 *   SYSTEM_EMAIL_APP_PASSWORD   the app password for that inbox
 *   SYSTEM_EMAIL_NAME           sender name (default "YCAReach")
 *   SYSTEM_EMAIL_SMTP_HOST / _PORT   default smtp.gmail.com / 465
 */
export function systemMailConfigured(): boolean {
  return !!(process.env.SYSTEM_EMAIL_ADDRESS && process.env.SYSTEM_EMAIL_APP_PASSWORD);
}

export async function sendSystemEmail(to: string[], subject: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const address = process.env.SYSTEM_EMAIL_ADDRESS;
  const password = process.env.SYSTEM_EMAIL_APP_PASSWORD;
  if (!address || !password) return { ok: false, error: "system email not configured" };
  const host = process.env.SYSTEM_EMAIL_SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SYSTEM_EMAIL_SMTP_PORT || 465);
  const adapter = createMailAdapter(
    {
      provider: "smtp",
      email: address,
      username: address,
      password,
      smtpHost: host,
      smtpPort: port,
      smtpSecure: port === 465,
      imapHost: host, // unused: system mail only sends
      imapPort: 993,
      imapSecure: true,
    },
    mailAdapterOptions(),
  );
  for (const recipient of to) {
    const res = await adapter.send({
      fromName: process.env.SYSTEM_EMAIL_NAME || "YCAReach",
      to: recipient,
      subject,
      text,
      html: brandedEmailHtml(subject, text),
      messageId: `<${randomUUID()}@${address.split("@")[1] ?? "ycareach.local"}>`,
      headers: { "X-YCAReach-System": "1", "Auto-Submitted": "auto-generated" },
    });
    if (!res.ok) return { ok: false, error: res.error };
  }
  return { ok: true };
}
