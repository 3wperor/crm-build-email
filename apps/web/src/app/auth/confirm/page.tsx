import type { EmailOtpType } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/safe-redirect";
import { confirmEmail } from "./actions";

export const metadata = { title: "Confirm your email" };

const TYPES: EmailOtpType[] = ["email", "signup", "magiclink", "invite", "recovery", "email_change"];

/**
 * Landing page for email links using the token_hash template. Verifying only
 * happens when the person presses the button: email security scanners that
 * "click" every link can't use the link up, and it works on any device.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; next?: string }> }) {
  const { token_hash, type, next } = await searchParams;
  const valid = !!token_hash && TYPES.includes(type as EmailOtpType);
  const signup = type === "email" || type === "signup";
  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{signup ? "Welcome to YCAReach" : "Confirm it's you"}</CardTitle>
          <CardDescription>
            {valid
              ? signup
                ? "One click to confirm your email and start your free 7-day trial."
                : "Click below to continue."
              : "This link is incomplete. Open it straight from the email, or log in."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {valid ? (
            <form action={confirmEmail}>
              <input type="hidden" name="token_hash" value={token_hash} />
              <input type="hidden" name="type" value={type} />
              <input type="hidden" name="next" value={safeNextPath(next ?? (signup ? "/onboarding" : "/dashboard"))} />
              <Button className="w-full" size="lg">
                {signup ? "Confirm my email" : "Continue"}
              </Button>
            </form>
          ) : (
            <Button asChild className="w-full" variant="outline">
              <a href="/login">Go to log in</a>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
