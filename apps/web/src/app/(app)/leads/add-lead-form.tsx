"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { addLead } from "./actions";
import { ActionToast } from "@/components/ui/toast";

export function AddLeadForm() {
  const [state, action, pending] = useActionState(addLead, undefined);
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-5">
        <Input name="email" type="email" placeholder="Email *" aria-label="Email" required aria-invalid={!!state?.fieldErrors?.email} />
        <Input name="first_name" placeholder="First name" aria-label="First name" />
        <Input name="last_name" placeholder="Last name" aria-label="Last name" />
        <Input name="company" placeholder="Company" aria-label="Company" />
        <Input name="title" placeholder="Title" aria-label="Title" />
      </div>
      <div className="flex items-center gap-3">
        <Button loading={pending} size="sm" disabled={pending}>
          Add lead
        </Button>
        <ActionToast state={state} message={state?.ok && "Lead added."} />
      </div>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
