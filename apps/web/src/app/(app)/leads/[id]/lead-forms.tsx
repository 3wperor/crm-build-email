"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select-native";
import { addToPipeline, removeFromPipeline, updateOpportunity } from "../../pipeline/actions";
import { addNote, updateLead } from "./actions";

type Lead = { id: string; first_name: string | null; last_name: string | null; company: string | null; title: string | null; custom: [string, string][] };

/**
 * Form actions reset uncontrolled inputs to their defaults, so the inputs are
 * keyed on `version` (lead.updated_at) and remount with the saved values —
 * while the <form> and its status message stay mounted.
 */
export function LeadFieldsForm({ lead, canEdit, version }: { lead: Lead; canEdit: boolean; version: string }) {
  const [state, action, pending] = useActionState(updateLead, undefined);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="lead_id" value={lead.id} />
      <LeadFieldInputs key={version} lead={lead} canEdit={canEdit} disabled={!canEdit || pending} />
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button disabled={pending}>{pending ? "Saving…" : "Save lead"}</Button>
          {state?.message && <span className="text-sm text-emerald-600">{state.message}</span>}
          {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
        </div>
      )}
    </form>
  );
}

function LeadFieldInputs({ lead, canEdit, disabled }: { lead: Lead; canEdit: boolean; disabled: boolean }) {
  const [custom, setCustom] = useState<[string, string][]>(lead.custom);
  return (
    <>
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["first_name", "First name", lead.first_name],
            ["last_name", "Last name", lead.last_name],
            ["company", "Company", lead.company],
            ["title", "Title", lead.title],
          ] as const
        ).map(([name, label, value]) => (
          <div key={name} className="grid gap-1">
            <Label htmlFor={name}>{label}</Label>
            <Input id={name} name={name} defaultValue={value ?? ""} maxLength={500} />
          </div>
        ))}
      </fieldset>
      <div className="grid gap-2">
        <Label>Custom fields</Label>
        {custom.map(([k, v], i) => (
          <div key={i} className="flex gap-2">
            <Input name="custom_key" defaultValue={k} placeholder="field" aria-label="Custom field name" className="w-44 font-mono text-xs" disabled={!canEdit} />
            <Input name="custom_value" defaultValue={v} placeholder="value" aria-label={`Value for ${k || "field"}`} disabled={!canEdit} />
            {canEdit && (
              <Button type="button" size="icon" variant="ghost" aria-label="Remove field" onClick={() => setCustom((c) => c.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
        {canEdit && (
          <div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCustom((c) => [...c, ["", ""]])}>
              <Plus /> Add field
            </Button>
          </div>
        )}
        <p className="text-muted-foreground text-xs">Usable in emails as {"{{field}}"}.</p>
      </div>
    </>
  );
}

export function PipelineControl({
  leadId,
  opportunity,
  stages,
  canEdit,
  version,
}: {
  version: string;
  leadId: string;
  opportunity: { stage_id: string; booking_link: string | null; source: string } | null;
  stages: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [addState, add, adding] = useActionState(addToPipeline, undefined);
  const [state, action, pending] = useActionState(updateOpportunity, undefined);
  if (!opportunity) {
    return (
      <form action={add} className="grid gap-2">
        <input type="hidden" name="lead_id" value={leadId} />
        <p className="text-muted-foreground text-sm">Not in the pipeline. Leads enter automatically when they reply.</p>
        {canEdit && (
          <div>
            <Button size="sm" variant="outline" disabled={adding}>
              Add to pipeline
            </Button>
          </div>
        )}
        {addState?.error && <p className="text-destructive text-xs">{addState.error}</p>}
      </form>
    );
  }
  return (
    <div className="grid gap-3">
      <form action={action} className="grid gap-3">
        <input type="hidden" name="lead_id" value={leadId} />
        <fieldset key={version} disabled={!canEdit || pending} className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="stage_id">Stage</Label>
            <NativeSelect id="stage_id" name="stage_id" defaultValue={opportunity.stage_id}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="booking_link">Booking link</Label>
            <Input id="booking_link" name="booking_link" type="url" defaultValue={opportunity.booking_link ?? ""} placeholder="https://cal.com/…" />
          </div>
        </fieldset>
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={pending}>
              Save
            </Button>
            {state?.message && <span className="text-xs text-emerald-600">{state.message}</span>}
            {state?.error && <span className="text-destructive text-xs">{state.error}</span>}
          </div>
        )}
      </form>
      {canEdit && (
        <form action={removeFromPipeline}>
          <input type="hidden" name="lead_id" value={leadId} />
          <Button size="sm" variant="ghost" className="text-muted-foreground">
            Remove from pipeline
          </Button>
        </form>
      )}
    </div>
  );
}

export function NoteForm({ leadId }: { leadId: string }) {
  const [state, action, pending] = useActionState(addNote, undefined);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="lead_id" value={leadId} />
      <textarea
        name="body"
        rows={3}
        maxLength={10000}
        placeholder="Add a note…"
        aria-label="Note"
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
      />
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending}>
          Add note
        </Button>
        {state?.error && <span className="text-destructive text-xs">{state.error}</span>}
      </div>
    </form>
  );
}
