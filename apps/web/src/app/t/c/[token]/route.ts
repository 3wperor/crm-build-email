import { parseClickToken } from "@/lib/links";
import { recordTrackingEvent } from "@/lib/tracking";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const target = parseClickToken((await params).token);
  if (!target) {
    return new Response("This link is invalid or has expired.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  await recordTrackingEvent(target.sendId, "click", request, { url: target.url.slice(0, 500) });
  return new Response(null, { status: 302, headers: { Location: target.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
