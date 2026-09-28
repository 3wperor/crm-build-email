import type { Provider } from "@crm/core";
import { HostNotAllowedError } from "./net-guard";

export type Protocol = "smtp" | "imap";
export type ClassifiedError = { error: string; hint?: string };

type ErrLike = {
  message?: string;
  code?: string;
  responseCode?: number;
  response?: string;
  authenticationFailed?: boolean;
  serverResponseCode?: string;
  responseText?: string;
};

const GMAIL_APP_PASSWORD_HINT =
  "Google requires an app password: turn on 2-Step Verification, then create one at https://myaccount.google.com/apppasswords and paste the 16 characters.";

/**
 * Turns raw nodemailer / imapflow / socket errors into a short, user-facing
 * message plus an actionable hint. Never includes credentials.
 */
export function classifyMailError(err: unknown, protocol: Protocol, provider: Provider): ClassifiedError {
  const e = (typeof err === "object" && err !== null ? err : { message: String(err) }) as ErrLike;
  const text = [e.message, e.response, e.responseText].filter(Boolean).join(" ");
  // nodemailer wraps socket failures as ESOCKET/ECONNECTION with the real code in the message.
  const socketCode = /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EAI_AGAIN)\b/.exec(text)?.[1];
  const code = socketCode ?? e.code ?? "";
  const label = protocol.toUpperCase();

  if (err instanceof HostNotAllowedError) return { error: err.message, hint: "Use your provider's public mail server hostname." };

  // --- Provider-specific signals first (most actionable) ---
  if (provider === "google") {
    if (/application-specific password required|InvalidSecondFactor|5\.7\.9/i.test(text)) {
      return { error: "Google rejected the password", hint: GMAIL_APP_PASSWORD_HINT };
    }
    if (/not enabled for IMAP/i.test(text)) {
      return { error: "IMAP is disabled for this Gmail account", hint: "Gmail → Settings → Forwarding and POP/IMAP → Enable IMAP." };
    }
    if (/5\.7\.14|web login required|WEBALERT/i.test(text)) {
      return { error: "Google blocked the sign-in", hint: "Sign in to Gmail in a browser, clear any security prompt, then retry." };
    }
  }

  // --- Authentication ---
  if (
    code === "EAUTH" ||
    e.authenticationFailed ||
    e.serverResponseCode === "AUTHENTICATIONFAILED" ||
    e.responseCode === 535 ||
    /authentication failed|invalid credentials|username and password not accepted|AUTHENTICATIONFAILED/i.test(text)
  ) {
    return {
      error: `${label} authentication failed`,
      hint: provider === "google" ? GMAIL_APP_PASSWORD_HINT : "Check the username and app password.",
    };
  }

  // --- DNS / network ---
  if (code === "ENOTFOUND" || code === "EDNS" || code === "EAI_AGAIN") {
    return { error: `${label} host not found`, hint: "Check the hostname." };
  }
  if (code === "ECONNREFUSED") return { error: `${label} connection refused`, hint: "Check the host and port." };
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return { error: `${label} host unreachable` };
  if (/TIMEOUT/i.test(code) || code === "ETIMEDOUT" || /timed? ?out/i.test(text)) {
    return { error: `${label} connection timed out`, hint: "Check the host, port and any firewall." };
  }
  if (code === "ECONNRESET" || code === "ECONNECTION") return { error: `${label} connection was closed by the server` };

  // --- TLS ---
  if (/wrong version number|WRONG_VERSION_NUMBER|ssl3_get_record/i.test(`${code} ${text}`)) {
    return {
      error: `${label} TLS mismatch`,
      hint: protocol === "smtp" ? "Port 465 uses SSL/TLS; port 587 uses STARTTLS (turn SSL/TLS off)." : "Port 993 uses SSL/TLS; port 143 uses STARTTLS.",
    };
  }
  if (/CERT|self[- ]signed|altname|UNABLE_TO_VERIFY/i.test(`${code} ${text}`)) {
    return { error: `${label} TLS certificate is invalid for this host`, hint: "Use the hostname that matches the server certificate." };
  }
  if (code === "ETLS" || /STARTTLS/i.test(text)) {
    return { error: `${label} server does not support encryption on this port`, hint: "Use an SSL/TLS port (465 / 993)." };
  }

  const msg = (e.message || "Unknown error").replace(/\s+/g, " ").slice(0, 200);
  return { error: `${label} error: ${msg}` };
}
