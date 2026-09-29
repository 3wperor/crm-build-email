"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select-native";
import { connectHubspot, saveMapping } from "./actions";

export function ConnectForm({ reconnect }: { reconnect: boolean }) {
  const [state, action, pending] = useActionState(connectHubspot, undefined);
  return (
    <form action={action} className="grid max-w-xl gap-2">
      <Label htmlFor="token">{reconnect ? "Replace access token" : "Private app access token"}</Label>
      <div className="flex gap-2">
        <Input id="token" name="token" type="password" autoComplete="off" placeholder="pat-na1-…" />
        <Button disabled={pending}>{pending ? "Checking…" : reconnect ? "Reconnect" : "Connect HubSpot"}</Button>
      </div>
      {state?.error && <p className="text-destructive text-sm">{state.error}</p>}
      {state?.message && <p className="text-sm text-emerald-600">{state.message}</p>}
    </form>
  );
}

export function MappingForm(props: {
  pipelineId: string | null;
  pipelines: { id: string; label: string; stages: { id: string; label: string }[] }[];
  stages: { id: string; name: string }[];
  map: Record<string, string>;
  version: string;
}) {
  const [state, action, pending] = useActionState(saveMapping, undefined);
  const pipeline = props.pipelines.find((p) => p.id === props.pipelineId) ?? props.pipelines[0];
  return (
    <form action={action} className="grid max-w-xl gap-3" key={props.version}>
      <div className="grid gap-1.5">
        <Label htmlFor="pipeline_id">HubSpot deal pipeline</Label>
        <NativeSelect id="pipeline_id" name="pipeline_id" defaultValue={pipeline?.id}>
          {props.pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {props.stages.map((s) => (
        <div key={s.id} className="grid grid-cols-2 items-center gap-3">
          <Label htmlFor={`stage_${s.id}`}>{s.name}</Label>
          <NativeSelect id={`stage_${s.id}`} name={`stage_${s.id}`} defaultValue={props.map[s.id] ?? ""}>
            <option value="">Don&apos;t sync</option>
            {pipeline?.stages.map((st) => (
              <option key={st.id} value={st.id}>
                {st.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save mapping"}
        </Button>
        {state?.message && <span className="text-sm text-emerald-600">{state.message}</span>}
        {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
      </div>
    </form>
  );
}
