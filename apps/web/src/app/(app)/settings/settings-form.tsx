"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { updateOrgSettings } from "./actions";

type Props = {
  disabled: boolean;
  org: { name: string; physical_address: string | null; default_timezone: string; approval_mode: string };
};

export function SettingsForm({ org, disabled }: Props) {
  const [state, action, pending] = useActionState(updateOrgSettings, undefined);
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <fieldset disabled={disabled || pending} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Workspace name</Label>
          <Input id="name" name="name" defaultValue={org.name} maxLength={120} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="physical_address">Physical mailing address</Label>
          <Input
            id="physical_address"
            name="physical_address"
            defaultValue={org.physical_address ?? ""}
            placeholder="123 Main St, City, Country"
          />
          <p className="text-muted-foreground text-xs">Included in every email footer (CAN-SPAM).</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="default_timezone">Default timezone</Label>
          <Input id="default_timezone" name="default_timezone" defaultValue={org.default_timezone} placeholder="America/New_York" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="approval_mode">AI agent approval mode</Label>
          <NativeSelect id="approval_mode" name="approval_mode" defaultValue={org.approval_mode}>
            <option value="draft">Draft-only — agent proposes, a human approves (recommended)</option>
            <option value="auto">Allow full-auto on campaigns that opt in</option>
          </NativeSelect>
          <p className="text-muted-foreground text-xs">
            Full-auto requires this AND the campaign&apos;s own setting. Hard caps and suppression always apply.
          </p>
        </div>
      </fieldset>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state?.ok && <p className="text-sm text-emerald-600">Saved.</p>}
      <div>
        <Button type="submit" disabled={disabled || pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
