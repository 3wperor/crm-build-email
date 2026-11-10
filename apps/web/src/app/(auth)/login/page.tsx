import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";
import { authLinkMessage } from "@/lib/auth-links";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; notice?: string }> }) {
  const { next, error, notice } = await searchParams;
  const linkNotice = authLinkMessage(notice);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>YCAReach</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {linkNotice && (
          <p
            data-testid="link-notice"
            className={linkNotice.tone === "info" ? "rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "text-destructive text-sm"}
          >
            {linkNotice.text}
          </p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        <LoginForm next={safeNextPath(next)} />
        <p className="text-muted-foreground text-center text-sm">
          No account?{" "}
          <Link href="/signup" className="text-foreground underline underline-offset-4">
            Sign up
          </Link>
          {" · "}
          <Link href="/docs" className="text-foreground underline underline-offset-4">
            How it works
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
