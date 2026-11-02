import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static assets and (future) public endpoints that must not require a session:
  // /api/inngest (job runner), /api/agent (API-key auth), /api/stripe (signed webhooks), /u (unsubscribe links), /t (open/click tracking).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/inngest|api/agent|api/stripe|u/|t/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
