"use client";

import { useActionState } from "react";
import { WARMUP_LIMITS } from "@crm/core/warmup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/field-error";
import { saveWarmupSettings } from "./actions";

export function WarmupSettingsForm(props: { accountId: string; email: string; target: number; rampStep: number; replyRate: number; dailyCap: number; updatedAt: string }) {
  const [state, action, pending] = useActionState(saveWarmupSettings, undefined);
  const e = state?.fieldErrors ?? {};
  const id = (n: string) => `${n}-${props.accountId}`;
  return (
    <form action={action} className="grid gap-3 pt-3" aria-label={`Warmup settings for ${props.email}`}>
      <input type="hidden" name="account_id" value={props.accountId} />
      <div className="grid gap-3 sm:grid-cols-3" key={props.updatedAt}>
        <div className="grid gap-1.5">
          <Label htmlFor={id("target")}>Daily target</Label>
          <Input id={id("target")} name="target" type="number" min={WARMUP_LIMITS.targetMin} max={WARMUP_LIMITS.targetMax} defaultValue={props.target} />
          <FieldError messages={e.target} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("rampStep")}>Increase per day</Label>
          <Input id={id("rampStep")} name="rampStep" type="number" min={1} max={WARMUP_LIMITS.rampStepMax} defaultValue={props.rampStep} />
          <FieldError messages={e.rampStep} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={id("replyRate")}>Reply rate (%)</Label>
          <Input id={id("replyRate")} name="replyRate" type="number" min={0} max={WARMUP_LIMITS.replyRateMax} defaultValue={props.replyRate} />
          <FieldError messages={e.replyRate} />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Starts at 2 a day and climbs by the daily increase; half on weekends. Warmup mail counts toward this inbox&apos;s daily cap ({props.dailyCap}), so a
        target of {props.target} leaves {Math.max(0, props.dailyCap - props.target)} for campaigns at full ramp.
      </p>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save warmup settings"}
        </Button>
        {state?.message && <span className="text-sm text-emerald-600">{state.message}</span>}
        {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
      </div>
    </form>
  );
}
