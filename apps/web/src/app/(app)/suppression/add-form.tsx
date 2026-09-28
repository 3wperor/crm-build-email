"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { addSuppressions } from "./actions";

export function AddSuppressionForm() {
  const [state, action, pending] = useActionState(addSuppressions, undefined);
  return (
    <form action={action} className="grid gap-3">
      <textarea
        name="emails"
        rows={4}
        required
        aria-label="Emails to suppress"
        placeholder={"someone@example.com\nother@example.com"}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:ring-[3px]"
      />
      <div className="flex items-center gap-3">
        <Button disabled={pending}>{pending ? "Adding…" : "Suppress"}</Button>
        {state?.message && <span className="text-sm text-emerald-600">{state.message}</span>}
      </div>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
