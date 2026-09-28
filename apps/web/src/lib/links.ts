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
