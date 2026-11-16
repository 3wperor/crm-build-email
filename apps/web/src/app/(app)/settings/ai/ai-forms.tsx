"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveAiToggles } from "./actions";
import { ActionToast } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";

export function AiTogglesForm({ classify, drafts, disabled }: { classify: boolean; drafts: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveAiToggles, undefined);
  return (
    <form action={action} className="grid gap-3">
      <label className="flex items-start gap-2 text-sm">
        <Switch name="ai_drafts_enabled" defaultChecked={drafts} disabled={disabled} className="mt-0.5" />
        <span>
          <span className="font-medium">Draft answers to new replies</span>
          <span className="text-muted-foreground block text-xs">
            When someone replies with interest or a question, AI writes an answer. You read it, edit if you like, and send it from the reply page.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <Switch name="ai_classification_enabled" defaultChecked={classify} disabled={disabled} className="mt-0.5" />
        <span>
          <span className="font-medium">Sort unclear replies with AI</span>
          <span className="text-muted-foreground block text-xs">Rules sort most replies; AI only looks at the ones the rules aren&apos;t sure about.</span>
        </span>
      </label>
      {!disabled && (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pending}>
            Save
          </Button>
          <ActionToast state={state} message={state?.message} />
          {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
        </div>
      )}
    </form>
  );
}
