import { DEFAULT_SEND_GAP, type SendWindow } from "@crm/core";

/** Per-inbox gap between sends. Overridable for local testing only. */
export function sendGap() {
  const min = Number(process.env.SEND_GAP_MIN_SECONDS ?? DEFAULT_SEND_GAP.minSeconds);
  const max = Number(process.env.SEND_GAP_MAX_SECONDS ?? DEFAULT_SEND_GAP.maxSeconds);
  return { minSeconds: Number.isFinite(min) ? min : DEFAULT_SEND_GAP.minSeconds, maxSeconds: Number.isFinite(max) ? max : DEFAULT_SEND_GAP.maxSeconds };
}

export const MAX_SEND_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS = 15 * 60_000;

export function campaignWindow(c: { timezone: string; send_window_start: string; send_window_end: string; send_days: number[] }): SendWindow {
  return { timezone: c.timezone, start: c.send_window_start, end: c.send_window_end, days: c.send_days };
}

/** RFC 5322 Message-ID on the sender's own domain (looks native, lets us match replies). */
export function newMessageId(sendId: string, senderEmail: string): string {
  const domain = senderEmail.split("@")[1] ?? "localhost";
  return `<${sendId.replace(/-/g, "")}.${Date.now().toString(36)}@${domain}>`;
}
