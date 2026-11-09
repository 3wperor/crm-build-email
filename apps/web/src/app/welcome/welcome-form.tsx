"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { saveWelcome } from "./actions";

const textarea =
  "border-input bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

function Choice({ name, value, label }: { name: string; value: string; label: string }) {
  return (
    <label className="has-checked:border-primary has-checked:ring-primary/20 hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-checked:ring-2">
      <input type="radio" name={name} value={value} className="accent-primary" />
      {label}
    </label>
  );
}

export function WelcomeForm() {
  const [state, action, pending] = useActionState(saveWelcome, undefined);
  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="offer">1. What do you sell?</Label>
        <textarea
          id="offer"
          name="offer"
          rows={3}
          maxLength={2000}
          autoFocus
          placeholder="e.g. We build fast websites for dental practices. Most go live in two weeks."
          className={textarea}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="audience">2. Who do you want to email?</Label>
        <Input id="audience" name="audience" maxLength={500} placeholder="e.g. Practice owners in Leeds and Manchester" />
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">3. Which email do you use for work?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <Choice name="provider" value="gmail" label="Gmail / Google" />
          <Choice name="provider" value="outlook" label="Outlook / Microsoft" />
          <Choice name="provider" value="other" label="Something else" />
        </div>
      </fieldset>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">4. Do you already have a list of people to email?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice name="has_list" value="yes" label="Yes, I have a list" />
          <Choice name="has_list" value="no" label="Not yet" />
        </div>
      </fieldset>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button type="submit" name="skip" value="1" variant="ghost" disabled={pending} formNoValidate>
          Skip for now
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
