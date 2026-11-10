import { NextResponse, type NextRequest } from "next/server";
import { isAuthPKCECodeVerifierMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { AUTH_LINK_MESSAGES } from "@/lib/auth-links";

/**
 * PKCE code exchange for magic links, signup confirmation and OAuth.
 * This flow only works in the browser that started it. Opened elsewhere (a
 * phone, Gmail's in-app browser), the email is already confirmed by Supabase,
 * so we say so and send the user to log in instead of showing a dead end.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const toLogin = (key: keyof typeof AUTH_LINK_MESSAGES) => {
    const url = new URL("/login", origin);
    url.searchParams.set("notice", key);
    if (next !== "/dashboard") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  };

  // Supabase reports expired / already-used links in the URL.
  if (searchParams.get("error") || searchParams.get("error_code")) return toLogin("expired");
  if (!code) return toLogin("invalid");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (!error) return NextResponse.redirect(new URL(next, origin));
  if (isAuthPKCECodeVerifierMissingError(error)) return toLogin("other_browser");
  return toLogin("expired");
}
