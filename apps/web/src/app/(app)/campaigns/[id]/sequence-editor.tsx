"use client";

import { useActionState, useMemo, useState } from "react";
import { Eye, Plus, Send, Trash2 } from "lucide-react";
import { buildEmail, BUILTIN_TAGS, type MergeLead } from "@crm/core/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addStep, addVariant, deleteStep, deleteVariant, saveVariant, updateStep } from "../actions";
import { TestEmailPanel, type TestOptions } from "./test-email-panel";

export type EditorVariant = { id: string; ab_group: string; subject: string; body: string; weight: number; is_active: boolean };
export type EditorStep = { id: string; step_order: number; delay_days: number; delay_hours: number; variants: EditorVariant[] };

type Props = {
  campaignId: string;
  steps: EditorStep[];
  canEdit: boolean;
  structureLocked: boolean;
  sampleLead: MergeLead;
  sender: { name: string | null; email: string };
  physicalAddress: string | null;
  testOptions: TestOptions;
};

export function SequenceEditor(props: Props) {
  const firstSubject = props.steps[0]?.variants[0]?.subject ?? "";
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Merge tags:{" "}
        {BUILTIN_TAGS.map((t) => (
          <code key={t} className="bg-muted mr-1 rounded px-1 text-xs">{`{{${t}}}`}</code>
        ))}
        <code className="bg-muted mr-1 rounded px-1 text-xs">{"{{custom_field}}"}</code>
        <code className="bg-muted rounded px-1 text-xs">{"{{first_name|there}}"}</code> (fallback). Leave a follow-up&apos;s subject empty to reply
        in the same thread.
      </p>
      {props.steps.map((step, i) => (
        <StepCard key={step.id} {...props} step={step} index={i} threadSubject={firstSubject} />
      ))}
      {props.canEdit && (
        <form action={addStep}>
          <input type="hidden" name="campaign_id" value={props.campaignId} />
          <Button variant="outline">
            <Plus /> Add follow-up step
          </Button>
        </form>
      )}
    </div>
  );
}

function StepCard({ campaignId, step, index, canEdit, structureLocked, threadSubject, ...rest }: Props & { step: EditorStep; index: number; threadSubject: string }) {
  const [state, action, pending] = useActionState(updateStep, undefined);
  return (
    <Card data-testid={`step-${step.step_order}`}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Step {step.step_order}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <form action={action} className="flex items-center gap-2 text-sm">
            <input type="hidden" name="campaign_id" value={campaignId} />
            <input type="hidden" name="step_id" value={step.id} />
            <span className="text-muted-foreground">{index === 0 ? "Send after" : "Wait"}</span>
            <Input name="delayDays" type="number" min={0} max={365} defaultValue={step.delay_days} className="w-16" aria-label="Delay days" disabled={!canEdit} />
            <span className="text-muted-foreground">days</span>
            <Input name="delayHours" type="number" min={0} max={23} defaultValue={step.delay_hours} className="w-16" aria-label="Delay hours" disabled={!canEdit} />
            <span className="text-muted-foreground">{index === 0 ? "hours" : "hours after the previous step"}</span>
            {canEdit && (
              <Button size="sm" variant="outline" disabled={pending}>
                Save
              </Button>
            )}
            {state?.message && <span className="text-xs text-emerald-600">{state.message}</span>}
            {state?.error && <span className="text-destructive text-xs">{state.error}</span>}
          </form>
          {canEdit && !structureLocked && index > 0 && (
            <form action={deleteStep}>
              <input type="hidden" name="campaign_id" value={campaignId} />
              <input type="hidden" name="step_id" value={step.id} />
              <Button size="icon" variant="ghost" aria-label={`Delete step ${step.step_order}`}>
                <Trash2 />
              </Button>
            </form>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {step.variants.map((v) => (
          <VariantEditor
            key={v.id}
            campaignId={campaignId}
            variant={v}
            canEdit={canEdit}
            canDelete={step.variants.length > 1}
            isFollowUp={index > 0}
            threadSubject={threadSubject}
            {...rest}
          />
        ))}
        {canEdit && (
          <form action={addVariant}>
            <input type="hidden" name="campaign_id" value={campaignId} />
            <input type="hidden" name="step_id" value={step.id} />
            <Button size="sm" variant="ghost">
              <Plus /> Add A/B variant
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function VariantEditor({
  campaignId,
  variant,
  canEdit,
  canDelete,
  isFollowUp,
  threadSubject,
  sampleLead,
  sender,
  physicalAddress,
  testOptions,
}: {
  campaignId: string;
  testOptions: TestOptions;
  variant: EditorVariant;
  canEdit: boolean;
  canDelete: boolean;
  isFollowUp: boolean;
  threadSubject: string;
  sampleLead: MergeLead;
  sender: { name: string | null; email: string };
  physicalAddress: string | null;
}) {
  const [state, action, pending] = useActionState(saveVariant, undefined);
  const [subject, setSubject] = useState(variant.subject);
  const [body, setBody] = useState(variant.body);
  const [preview, setPreview] = useState(false);
  const [testing, setTesting] = useState(false);

  const rendered = useMemo(
    () =>
      buildEmail({
        subject,
        body,
        ctx: { lead: sampleLead, sender },
        threadSubject: isFollowUp ? threadSubject : null,
        unsubscribeUrl: "https://…/u/…",
        physicalAddress,
      }),
    [subject, body, sampleLead, sender, isFollowUp, threadSubject, physicalAddress],
  );

  return (
    <div className="grid gap-2 rounded-md border p-3" data-testid={`variant-${variant.ab_group}`}>
      <form action={action} className="grid gap-3">
        <input type="hidden" name="campaign_id" value={campaignId} />
        <input type="hidden" name="variant_id" value={variant.id} />
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">Variant {variant.ab_group}</Badge>
          <label className="flex items-center gap-1 text-sm">
            Weight
            <Input name="weight" type="number" min={0} max={10000} defaultValue={variant.weight} className="h-8 w-20" disabled={!canEdit} />
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={variant.is_active} disabled={!canEdit} /> Active
          </label>
          <div className="ml-auto flex gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setTesting((t) => !t)}>
              <Send /> Test
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreview((p) => !p)}>
              <Eye /> {preview ? "Edit" : "Preview"}
            </Button>
            {canEdit && canDelete && (
              <Button type="submit" size="sm" variant="ghost" formAction={deleteVariant} aria-label={`Delete variant ${variant.ab_group}`}>
                <Trash2 />
              </Button>
            )}
          </div>
        </div>

        {preview ? (
          <div className="bg-muted/30 grid gap-2 rounded-md p-3 text-sm" data-testid="preview">
            <div>
              <span className="text-muted-foreground">To:</span> {sampleLead.email} · <span className="text-muted-foreground">Subject:</span>{" "}
              <strong>{rendered.subject || "(no subject)"}</strong>
            </div>
            <pre className="font-sans whitespace-pre-wrap">{rendered.text}</pre>
            {rendered.missing.length > 0 && (
              <p className="text-xs text-amber-600">
                No value for {rendered.missing.map((m) => `{{${m}}}`).join(", ")} on this sample lead — add a fallback like {"{{tag|text}}"}.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-1">
              <Label htmlFor={`subject-${variant.id}`}>Subject</Label>
              <Input
                id={`subject-${variant.id}`}
                name="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={isFollowUp ? `Empty = "Re: ${threadSubject || "…"}"` : "Quick question, {{first_name}}"}
                disabled={!canEdit}
                maxLength={300}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`body-${variant.id}`}>Body</Label>
              <textarea
                id={`body-${variant.id}`}
                name="body"
                rows={7}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={!canEdit}
                placeholder={"Hi {{first_name|there}},\n\n…\n\n{{sender_first_name}}"}
                className="border-input focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              />
            </div>
          </>
        )}
        {preview && (
          <>
            <input type="hidden" name="subject" value={subject} />
            <input type="hidden" name="body" value={body} />
          </>
        )}
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save variant"}
            </Button>
            {state?.message && <span className="text-xs text-emerald-600">{state.message}</span>}
            {state?.error && <span className="text-destructive text-xs">{state.error}</span>}
          </div>
        )}
      </form>
      {testing && (
        <TestEmailPanel
          variantId={variant.id}
          subject={subject}
          body={body}
          threadSubject={isFollowUp ? threadSubject : null}
          options={testOptions}
        />
      )}
    </div>
  );
}
