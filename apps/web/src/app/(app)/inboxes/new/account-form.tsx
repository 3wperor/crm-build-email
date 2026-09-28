"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { DAILY_CAP_MAX } from "@crm/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConnectionResult } from "@/components/connection-result";
import { FieldError } from "@/components/field-error";
import { TimezoneInput } from "@/components/timezone-input";
import { VolumeInput } from "@/components/volume-input";
import { cn } from "@/lib/utils";
import { createAccount, testNewAccount, type AccountFormState } from "../actions";

type Provider = "google" | "smtp";

const PROVIDERS: { id: Provider | "outlook"; label: string; description: string; disabled?: boolean }[] = [
  { id: "google", label: "Google Workspace / Gmail", description: "smtp.gmail.com · imap.gmail.com" },
  { id: "smtp", label: "Other SMTP / IMAP", description: "Any provider that supports app passwords" },
  { id: "outlook", label: "Microsoft 365 / Outlook", description: "Coming later", disabled: true },
];

export function AccountForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [provider, setProvider] = useState<Provider>("google");
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [imapSecure, setImapSecure] = useState(true);
  const [testState, testAction, testing] = useActionState(testNewAccount, undefined);
  const [createState, createAction, saving] = useActionState(createAccount, undefined);
  const [last, setLast] = useState<"test" | "create" | null>(null);

  const state: AccountFormState = last === "create" ? createState : testState;
  const errors = state?.fieldErrors ?? {};
  const busy = testing || saving;

  // Call actions directly (not via <form action>) so React doesn't reset the
  // form after "Test connection" and wipe the typed password.
  function run(which: "test" | "create") {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const fd = new FormData(form);
    setLast(which);
    startTransition(() => (which === "test" ? testAction(fd) : createAction(fd)));
  }

  return (
    <form
      ref={formRef}
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        run("create");
      }}
    >
      <input type="hidden" name="provider" value={provider} />

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Provider</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={p.disabled}
              onClick={() => !p.disabled && setProvider(p.id as Provider)}
              aria-pressed={provider === p.id}
              className={cn(
                "rounded-md border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                provider === p.id ? "border-primary ring-primary/20 ring-2" : "hover:bg-muted/50",
              )}
            >
              <div className="font-medium">{p.label}</div>
              <div className="text-muted-foreground text-xs">{p.description}</div>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="email">Email address</Label>
          <Input id="email" name="email" type="email" autoComplete="off" required aria-invalid={!!errors.email} />
          <FieldError messages={errors.email} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="displayName">Sender name</Label>
          <Input id="displayName" name="displayName" placeholder="Jane from Acme" maxLength={120} />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="password">App password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={!!errors.password}
            className="font-mono"
          />
          <FieldError messages={errors.password} />
          <p className="text-muted-foreground text-xs">
            {provider === "google" ? (
              <>
                Requires 2-Step Verification. Create one at{" "}
                <a className="underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                  myaccount.google.com/apppasswords
                </a>
                . Encrypted at rest; never shown again.
              </>
            ) : (
              "Encrypted at rest; never shown again."
            )}
          </p>
        </div>
      </div>

      {provider === "smtp" && (
        <div className="grid gap-4 rounded-md border p-4">
          <div className="grid gap-2">
            <Label htmlFor="username">Username</Label>
            <Input id="username" name="username" placeholder="Defaults to the email address" autoComplete="off" />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem_auto]">
            <div className="grid gap-2">
              <Label htmlFor="smtpHost">SMTP host</Label>
              <Input id="smtpHost" name="smtpHost" placeholder="smtp.example.com" required aria-invalid={!!errors.smtpHost} />
              <FieldError messages={errors.smtpHost} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="smtpPort">Port</Label>
              <Input
                id="smtpPort"
                name="smtpPort"
                type="number"
                defaultValue={465}
                required
                onChange={(e) => {
                  if (e.target.value === "465") setSmtpSecure(true);
                  if (e.target.value === "587") setSmtpSecure(false);
                }}
              />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="smtpSecure" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
              SSL/TLS
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem_auto]">
            <div className="grid gap-2">
              <Label htmlFor="imapHost">IMAP host</Label>
              <Input id="imapHost" name="imapHost" placeholder="imap.example.com" required aria-invalid={!!errors.imapHost} />
              <FieldError messages={errors.imapHost} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="imapPort">Port</Label>
              <Input
                id="imapPort"
                name="imapPort"
                type="number"
                defaultValue={993}
                required
                onChange={(e) => {
                  if (e.target.value === "993") setImapSecure(true);
                  if (e.target.value === "143") setImapSecure(false);
                }}
              />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="imapSecure" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} />
              SSL/TLS
            </label>
          </div>
          <p className="text-muted-foreground text-xs">
            Without SSL/TLS, STARTTLS is required — credentials are never sent unencrypted.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="dailyCap">Daily sending cap</Label>
          <VolumeInput id="dailyCap" name="dailyCap" defaultValue={30} max={DAILY_CAP_MAX} sliderMax={200} />
          <FieldError messages={errors.dailyCap} />
          <p className="text-muted-foreground text-xs">Most cold-email inboxes should stay under 30–50/day.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="timezone">Timezone (optional)</Label>
          <TimezoneInput id="timezone" name="timezone" />
          <FieldError messages={errors.timezone} />
        </div>
      </div>

      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {last === "test" && testState?.test && <ConnectionResult result={testState.test} />}

      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => run("test")}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <Button type="submit" disabled={busy}>
          {saving ? "Saving & testing…" : "Save inbox"}
        </Button>
      </div>
    </form>
  );
}
