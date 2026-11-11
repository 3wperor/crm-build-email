"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { addSuppressions } from "./actions";
import { ActionToast } from "@/components/ui/toast";
import { Textarea } from "@/components/ui/textarea";

export function AddSuppressionForm() {
  const [state, action, pending] = useActionState(addSuppressions, undefined);
  return (
    <form action={action} className="grid gap-3">
      <Textarea
        name="emails"
        rows={4}
        required
        aria-label="Emails to suppress"
        placeholder={"someone@example.com\nother@example.com"}
        className="font-mono"
      />
      <div className="flex items-center gap-3">
        <Button loading={pending} disabled={pending}>Suppress</Button>
        <ActionToast state={state} message={state?.message} />
      </div>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
