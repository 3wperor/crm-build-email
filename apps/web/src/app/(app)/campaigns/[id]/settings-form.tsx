"use client";

import { useActionState } from "react";
import { CAMPAIGN_DAILY_LIMIT_MAX, CAMPAIGN_PER_INBOX_MAX } from "@crm/core/campaigns";
import { WEEKDAY_LABELS } from "@crm/core/scheduler";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldError } from "@/components/field-error";
import { HealthBadge } from "@/components/health-badge";
import { TimezoneInput } from "@/components/timezone-input";
import { VolumeInput } from "@/components/volume-input";
import { updateCampaignSettings } from "../actions";

type Props = {
  campaign: {
    id: string;
    name: string;
    timezone: string;
    send_window_start: string;
    send_window_end: string;
    send_days: number[];
    daily_limit: number;
    daily_limit_per_inbox: number;
    include_risky: boolean;
    approval_mode: string;
  };
  inboxes: { id: string; email: string; status: string; health: string; daily_cap: number }[];
  attached: string[];
  canEdit: boolean;
};

export function CampaignSettingsForm({ campaign, inboxes, attached, canEdit }: Props) {
  const [state, action, pending] = useActionState(updateCampaignSettings, undefined);
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="grid max-w-3xl gap-6">
      <input type="hidden" name="campaign_id" value={campaign.id} />
      <fieldset disabled={!canEdit || pending} className="grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={campaign.name} maxLength={200} />
          <FieldError messages={e.name} />
        </div>

        <div className="grid gap-3">
          <h3 className="text-sm font-semibold">Send window</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="sendWindowStart">From</Label>
              <Input id="sendWindowStart" name="sendWindowStart" type="time" defaultValue={campaign.send_window_start.slice(0, 5)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sendWindowEnd">Until</Label>
              <Input id="sendWindowEnd" name="sendWindowEnd" type="time" defaultValue={campaign.send_window_end.slice(0, 5)} />
              <FieldError messages={e.sendWindowEnd} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="timezone">Timezone</Label>
              <TimezoneInput id="timezone" name="timezone" defaultValue={campaign.timezone} placeholder="America/New_York" />
              <FieldError messages={e.timezone} />
            </div>
          </div>
          <div className="flex flex-wrap gap-3" role="group" aria-label="Send days">
            {WEEKDAY_LABELS.map((label, i) => (
              <label key={label} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="sendDays" value={i + 1} defaultChecked={campaign.send_days.includes(i + 1)} /> {label}
              </label>
            ))}
          </div>
          <FieldError messages={e.sendDays} />
          <p className="text-muted-foreground text-xs">No email goes out outside this window. A window ending before it starts (e.g. 22:00–02:00) runs overnight.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="dailyLimit">Campaign daily limit</Label>
            <VolumeInput id="dailyLimit" name="dailyLimit" defaultValue={campaign.daily_limit} min={0} max={CAMPAIGN_DAILY_LIMIT_MAX} sliderMax={500} disabled={!canEdit} />
            <FieldError messages={e.dailyLimit} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dailyLimitPerInbox">Per-inbox daily limit (this campaign)</Label>
            <VolumeInput
              id="dailyLimitPerInbox"
              name="dailyLimitPerInbox"
              defaultValue={campaign.daily_limit_per_inbox}
              min={0}
              max={CAMPAIGN_PER_INBOX_MAX}
              sliderMax={100}
              disabled={!canEdit}
            />
            <p className="text-muted-foreground text-xs">Each inbox&apos;s own daily cap still applies across all campaigns.</p>
          </div>
        </div>

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Inboxes</h3>
          {inboxes.length === 0 ? (
            <p className="text-muted-foreground text-sm">No inboxes connected yet.</p>
          ) : (
            inboxes.map((i) => (
              <label key={i.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="accountIds" value={i.id} defaultChecked={attached.includes(i.id)} />
                {i.email} <HealthBadge health={i.health} />
                <span className="text-muted-foreground text-xs">
                  cap {i.daily_cap}/day{i.status !== "active" ? ` · ${i.status}` : ""}
                </span>
              </label>
            ))
          )}
          <p className="text-muted-foreground text-xs">New threads rotate across inboxes; follow-ups always come from the inbox that sent step 1.</p>
        </div>

        <div className="grid gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="includeRisky" defaultChecked={campaign.include_risky} className="mt-0.5" />
            <span>
              <span className="font-medium">Include risky leads</span>
              <span className="text-muted-foreground block text-xs">Role addresses and domains without MX. Off by default. Invalid and suppressed leads are never emailed.</span>
            </span>
          </label>
          <div className="grid max-w-md gap-2">
            <Label htmlFor="approvalMode">AI agent mode for this campaign</Label>
            <NativeSelect id="approvalMode" name="approvalMode" defaultValue={campaign.approval_mode}>
              <option value="draft">Draft — agent proposes, a human approves</option>
              <option value="auto">Full-auto (also needs the workspace setting)</option>
            </NativeSelect>
          </div>
        </div>
      </fieldset>

      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-3">
        {canEdit && <Button disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>}
        {state?.message && <span className="text-sm text-emerald-600">{state.message}</span>}
      </div>
    </form>
  );
}
