"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { updateOrgSettings } from "./actions";
import { ActionToast } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";

type Props = {
  disabled: boolean;
  org: {
    name: string;
    physical_address: string | null;
    default_timezone: string;
    approval_mode: string;
    auto_verify_imports: boolean;
  };
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
          <p className="text-muted-foreground text-xs">Added to the bottom of every email. The law requires a real postal address.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="default_timezone">Timezone</Label>
          <Input id="default_timezone" name="default_timezone" defaultValue={org.default_timezone} placeholder="America/New_York" />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Switch name="auto_verify_imports" defaultChecked={org.auto_verify_imports} className="mt-0.5" />
          <span>
            <span className="font-medium">Check email addresses automatically after each import</span>
            <span className="text-muted-foreground block text-xs">Catches addresses that don&apos;t exist, throwaway addresses and shared ones like info@.</span>
          </span>
        </label>
        <div className="grid gap-2">
          <Label htmlFor="approval_mode">When an AI assistant wants to send</Label>
          <NativeSelect id="approval_mode" name="approval_mode" defaultValue={org.approval_mode}>
            <option value="draft">It asks first: you approve before anything is sent (recommended)</option>
            <option value="auto">It can send on its own, in campaigns where you allow it</option>
          </NativeSelect>
          <p className="text-muted-foreground text-xs">
            Sending on its own needs this setting and the campaign&apos;s own setting. Daily limits and your do-not-email list always apply.
          </p>
        </div>
      </fieldset>
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <ActionToast state={state} message={state?.ok && "Saved."} />
      <div>
        <Button loading={pending} type="submit" disabled={disabled || pending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
