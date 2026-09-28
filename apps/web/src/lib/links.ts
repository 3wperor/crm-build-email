import "server-only";
import { signToken, verifyToken } from "@crm/core/crypto";
import { publicEnv } from "@/lib/env";

function secret(): string {
  const s = process.env.LINK_SIGNING_SECRET;
  if (!s) throw new Error("LINK_SIGNING_SECRET is not set");
  return s;
}

/** Signed, unguessable unsubscribe links bound to one send. */
export function unsubscribeToken(sendId: string): string {
  return signToken(`u:${sendId}`, secret());
}

export function unsubscribeUrls(sendId: string) {
  const token = unsubscribeToken(sendId);
  return {
    page: `${publicEnv.appUrl}/u/${token}`,
    oneClick: `${publicEnv.appUrl}/u/${token}/one-click`,
  };
}

export function sendIdFromUnsubscribeToken(token: string): string | null {
  const payload = verifyToken(token, secret());
  return payload?.startsWith("u:") ? payload.slice(2) : null;
}

/** Open pixel and click redirect URLs for one send. The click token signs the destination, so it can't be used as an open redirect. */
export function trackingUrls(sendId: string) {
  return {
    openPixel: `${publicEnv.appUrl}/t/o/${signToken(`o:${sendId}`, secret())}`,
    click: (url: string) => `${publicEnv.appUrl}/t/c/${signToken(`c:${sendId}:${url}`, secret())}`,
  };
}

export function parseOpenToken(token: string): string | null {
  const payload = verifyToken(token, secret());
  return payload?.startsWith("o:") ? payload.slice(2) : null;
}

export function parseClickToken(token: string): { sendId: string; url: string } | null {
  const payload = verifyToken(token, secret());
  const m = payload?.match(/^c:([0-9a-f-]{36}):(https?:\/\/.+)$/is);
  return m ? { sendId: m[1]!, url: m[2]! } : null;
}
