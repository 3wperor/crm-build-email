"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { DAILY_CAP_MAX } from "@crm/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConnectionResult } from "@/components/connection-result";
import { FieldError } from "@/components/field-error";
import { TimezoneInput } from "@/components/timezone-input";
import { VolumeInput } from "@/components/volume-input";
import { deleteAccount, retestAccount, rotatePassword, updateAccount } from "../actions";

function ErrorAlert({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

export function RetestButton({ accountId, disabled }: { accountId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(retestAccount, undefined);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="account_id" value={accountId} />
      <div>
        <Button variant="outline" disabled={disabled || pending}>
          <RefreshCw className={pending ? "animate-spin" : undefined} />
          {pending ? "Testing…" : "Test connection"}
        </Button>
      </div>
      <ErrorAlert error={state?.error} />
      {state?.test && <ConnectionResult result={state.test} />}
    </form>
  );
}

type Settings = { id: string; display_name: string | null; daily_cap: number; timezone: string | null; status: string };

export function SettingsForm({ account, disabled }: { account: Settings; disabled: boolean }) {
  const [state, action, pending] = useActionState(updateAccount, undefined);
  const errors = state?.fieldErrors ?? {};
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <input type="hidden" name="account_id" value={account.id} />
      <fieldset disabled={disabled || pending} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="displayName">Sender name</Label>
          <Input id="displayName" name="displayName" defaultValue={account.display_name ?? ""} maxLength={120} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dailyCap">Daily sending cap</Label>
          <VolumeInput id="dailyCap" name="dailyCap" defaultValue={account.daily_cap} max={DAILY_CAP_MAX} sliderMax={200} disabled={disabled} />
          <FieldError messages={errors.dailyCap} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="timezone">Timezone</Label>
          <TimezoneInput id="timezone" name="timezone" defaultValue={account.timezone} />
          <FieldError messages={errors.timezone} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="status">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={account.status === "paused" ? "paused" : "active"}>
            <option value="active">Active — used by campaigns</option>
            <option value="paused">Paused — excluded from sending</option>
          </NativeSelect>
        </div>
      </fieldset>
      <ErrorAlert error={state?.error} />
      {state?.saved && <p className="text-sm text-emerald-600">Saved.</p>}
      <div>
        <Button disabled={disabled || pending}>{pending ? "Saving…" : "Save changes"}</Button>
      </div>
    </form>
  );
}

export function RotatePasswordForm({ accountId, disabled }: { accountId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(rotatePassword, undefined);
  return (
    <form action={action} className="grid max-w-xl gap-3">
      <input type="hidden" name="account_id" value={accountId} />
      <div className="grid gap-2">
        <Label htmlFor="password">New app password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required disabled={disabled} className="font-mono" />
        <FieldError messages={state?.fieldErrors?.password} />
      </div>
      <ErrorAlert error={state?.error} />
      {state?.saved && <p className="text-sm text-emerald-600">Password updated.</p>}
      {state?.test && <ConnectionResult result={state.test} />}
      <div>
        <Button variant="outline" disabled={disabled || pending}>
          {pending ? "Updating & testing…" : "Update password"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteAccountForm({ accountId, email, disabled }: { accountId: string; email: string; disabled: boolean }) {
  return (
    <form
      action={deleteAccount}
      onSubmit={(e) => {
        if (!window.confirm(`Disconnect ${email}? Scheduled sends from this inbox will stop. Sent history is kept.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="account_id" value={accountId} />
      <Button variant="destructive" disabled={disabled}>
        Disconnect inbox
      </Button>
    </form>
  );
}
