import "server-only";
import { isLikelyScanner } from "@crm/core/analytics";
import { createAdminClient } from "@/lib/supabase/admin";

/** Records an open/click. Never throws: a tracking failure must not break the pixel or the redirect. */
export async function recordTrackingEvent(sendId: string, type: "open" | "click", request: Request, extra: Record<string, string> = {}) {
  try {
    const ua = request.headers.get("user-agent");
    await createAdminClient().rpc("record_tracking_event", {
      p_send_id: sendId,
      p_type: type,
      p_meta: { ua: (ua ?? "").slice(0, 300), ...extra },
      // The database adds the "within 60 s of sending" rule.
      p_scanner: isLikelyScanner(ua, null),
    });
  } catch (err) {
    console.error("tracking event failed", err);
  }
}
