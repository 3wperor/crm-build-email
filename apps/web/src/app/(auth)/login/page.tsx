import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>YCAReach</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error && <p className="text-destructive text-sm">{error}</p>}
        <LoginForm next={safeNextPath(next)} />
        <p className="text-muted-foreground text-center text-sm">
          No account?{" "}
          <Link href="/signup" className="text-foreground underline underline-offset-4">
            Sign up
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
