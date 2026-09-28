"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { signInWithMagicLink, signInWithPassword } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [pwState, pwAction, pwPending] = useActionState(signInWithPassword, undefined);
  const [mlState, mlAction, mlPending] = useActionState(signInWithMagicLink, undefined);
  const state = mlState?.message || mlState?.error ? mlState : pwState;

  return (
    <form className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" />
      </div>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state?.message && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <Button formAction={pwAction} disabled={pwPending || mlPending}>
        {pwPending ? "Signing in…" : "Sign in"}
      </Button>
      <Button formAction={mlAction} variant="outline" disabled={pwPending || mlPending}>
        {mlPending ? "Sending link…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
