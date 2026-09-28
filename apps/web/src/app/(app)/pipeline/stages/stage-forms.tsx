"use client";

import { useActionState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { addStage, deleteStage, moveStage, setEntryStage, updateStage } from "../actions";

type Stage = { id: string; name: string; kind: string; is_entry: boolean; cards: number };

export function StageRow({ stage, first, last }: { stage: Stage; first: boolean; last: boolean }) {
  const [state, action, pending] = useActionState(updateStage, undefined);
  const [delState, delAction, deleting] = useActionState(deleteStage, undefined);
  const msg = delState?.error ?? state?.error;
  return (
    <div className="grid gap-1 rounded-md border p-3" data-testid={`stage-${stage.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-col">
          <form action={moveStage}>
            <input type="hidden" name="stage_id" value={stage.id} />
            <input type="hidden" name="dir" value="up" />
            <Button size="icon" variant="ghost" className="size-6" disabled={first} aria-label={`Move ${stage.name} up`}>
              <ArrowUp />
            </Button>
          </form>
          <form action={moveStage}>
            <input type="hidden" name="stage_id" value={stage.id} />
            <input type="hidden" name="dir" value="down" />
            <Button size="icon" variant="ghost" className="size-6" disabled={last} aria-label={`Move ${stage.name} down`}>
              <ArrowDown />
            </Button>
          </form>
        </div>
        <form action={action} className="flex flex-1 flex-wrap items-center gap-2">
          <input type="hidden" name="stage_id" value={stage.id} />
          <Input name="name" defaultValue={stage.name} maxLength={60} className="w-48" aria-label="Stage name" />
          <NativeSelect name="kind" defaultValue={stage.kind} className="w-auto" aria-label="Stage type">
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </NativeSelect>
          <Button size="sm" variant="outline" disabled={pending}>
            Save
          </Button>
        </form>
        <span className="text-muted-foreground text-xs">{stage.cards} card(s)</span>
        {stage.is_entry ? (
          <span className="rounded bg-emerald-600/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">Replies land here</span>
        ) : (
          stage.kind === "open" && (
            <form action={setEntryStage}>
              <input type="hidden" name="stage_id" value={stage.id} />
              <Button size="sm" variant="ghost">
                Make entry stage
              </Button>
            </form>
          )
        )}
        <form action={delAction}>
          <input type="hidden" name="stage_id" value={stage.id} />
          <Button size="icon" variant="ghost" disabled={deleting} aria-label={`Delete ${stage.name}`}>
            <Trash2 />
          </Button>
        </form>
      </div>
      {msg && <p className="text-destructive text-xs">{msg}</p>}
      {state?.message && <p className="text-xs text-emerald-600">{state.message}</p>}
    </div>
  );
}

export function AddStageForm() {
  const [state, action, pending] = useActionState(addStage, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder="New stage name" maxLength={60} className="w-56" aria-label="New stage name" required />
      <NativeSelect name="kind" defaultValue="open" className="w-auto" aria-label="New stage type">
        <option value="open">Open</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
      </NativeSelect>
      <Button size="sm" disabled={pending}>
        Add stage
      </Button>
      {state?.error && <span className="text-destructive text-xs">{state.error}</span>}
      {state?.message && <span className="text-xs text-emerald-600">{state.message}</span>}
    </form>
  );
}
