import { parseOpenToken } from "@/lib/links";
import { recordTrackingEvent } from "@/lib/tracking";

export const dynamic = "force-dynamic";

// 1×1 transparent GIF.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const sendId = parseOpenToken((await params).token);
  if (sendId) await recordTrackingEvent(sendId, "open", request);
  // Same response for valid and invalid tokens; never cached so every open reaches us.
  return new Response(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private", "Content-Length": String(PIXEL.length) },
  });
}
