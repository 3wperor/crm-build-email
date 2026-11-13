import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";
import { authLinkMessage } from "@/lib/auth-links";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; notice?: string }> }) {
  const { next, error, notice } = await searchParams;
  const linkNotice = authLinkMessage(notice);
  return (
    <Card className="border-0 bg-transparent py-0 shadow-none [&>*]:px-0">
      <CardHeader>
        <h1 className="text-page-title">Sign in</h1>
        <CardDescription>Welcome back.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {linkNotice && (
          <p
            data-testid="link-notice"
            className={linkNotice.tone === "info" ? "border-success/30 bg-success-subtle text-success rounded-md border p-3 text-sm" : "text-destructive text-sm"}
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
