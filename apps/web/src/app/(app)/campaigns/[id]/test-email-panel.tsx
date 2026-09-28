"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { sendTestEmailAction } from "../actions";

export type TestOptions = {
  defaultTo: string;
  inboxes: { id: string; email: string }[];
  leads: { id: string; email: string }[];
};

/** Sends the variant as currently edited (saved or not) to one address. */
export function TestEmailPanel({
  variantId,
  subject,
  body,
  threadSubject,
  options,
}: {
  variantId: string;
  subject: string;
  body: string;
  threadSubject: string | null;
  options: TestOptions;
}) {
  const [state, action, pending] = useActionState(sendTestEmailAction, undefined);
  return (
    <form action={action} className="bg-muted/30 grid gap-2 rounded-md border border-dashed p-3" data-testid="test-email-panel">
      <input type="hidden" name="variant_id" value={variantId} />
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="body" value={body} />
      {threadSubject && <input type="hidden" name="thread_subject" value={threadSubject} />}
      <div className="flex flex-wrap items-center gap-2">
        <Input name="to" type="email" defaultValue={options.defaultTo} aria-label="Send test to" required className="h-8 w-56" />
        <NativeSelect name="account_id" aria-label="Send test from" className="h-8 w-auto" defaultValue={options.inboxes[0]?.id}>
          {options.inboxes.map((i) => (
            <option key={i.id} value={i.id}>
              from {i.email}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="lead_id" aria-label="Render with lead" className="h-8 w-auto" defaultValue={options.leads[0]?.id ?? ""}>
          {options.leads.map((l) => (
            <option key={l.id} value={l.id}>
              as {l.email}
            </option>
          ))}
          <option value="">as sample lead (Ada)</option>
        </NativeSelect>
        <Button size="sm" variant="outline" disabled={pending || options.inboxes.length === 0}>
          <Send /> {pending ? "Sending…" : "Send test"}
        </Button>
      </div>
      {options.inboxes.length === 0 && <p className="text-muted-foreground text-xs">Connect an inbox to send tests.</p>}
      {state?.ok === true && <p className="text-sm text-emerald-600">{state.message}</p>}
      {state?.ok === false && (
        <div className="text-destructive text-sm" role="alert">
          {state.error}
          {state.hint && <div className="text-muted-foreground text-xs">{state.hint}</div>}
        </div>
      )}
    </form>
  );
}
