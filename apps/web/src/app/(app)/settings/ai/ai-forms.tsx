"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveAiToggles, saveOwnAiKey } from "./actions";

export function AiTogglesForm({ classify, drafts, disabled }: { classify: boolean; drafts: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveAiToggles, undefined);
  return (
    <form action={action} className="grid gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="ai_drafts_enabled" defaultChecked={drafts} disabled={disabled} className="mt-0.5" />
        <span>
          <span className="font-medium">Draft answers to new replies</span>
          <span className="text-muted-foreground block text-xs">
            When someone replies with interest or a question, AI writes an answer. You read it, edit if you like, and send it from the reply page.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="ai_classification_enabled" defaultChecked={classify} disabled={disabled} className="mt-0.5" />
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
          {state?.message && <span className="text-sm text-emerald-600">{state.message}</span>}
          {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
        </div>
      )}
    </form>
  );
}

export function OwnKeyForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState(saveOwnAiKey, undefined);
  const [provider, setProvider] = useState(current === "openai_compatible" ? "openai_compatible" : "anthropic");
  return (
    <form action={action} className="grid max-w-xl gap-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="provider" value="anthropic" checked={provider === "anthropic"} onChange={() => setProvider("anthropic")} /> Claude (Anthropic)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="provider" value="openai_compatible" checked={provider === "openai_compatible"} onChange={() => setProvider("openai_compatible")} />{" "}
          OpenAI-compatible
        </label>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="api_key">API key</Label>
        <Input id="api_key" name="api_key" type="password" autoComplete="off" required placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"} />
        {provider === "anthropic" && (
          <p className="text-muted-foreground text-xs">
            Get one at console.anthropic.com → API keys. You pay Anthropic directly for what you use.
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="model">Model{provider === "anthropic" ? " (optional)" : ""}</Label>
        <Input id="model" name="model" maxLength={100} placeholder={provider === "anthropic" ? "claude-opus-5-5 (default)" : "e.g. gpt-5-mini"} required={provider !== "anthropic"} />
      </div>
      {provider === "openai_compatible" && (
        <div className="grid gap-1.5">
          <Label htmlFor="base_url">API address</Label>
          <Input id="base_url" name="base_url" type="url" required maxLength={300} placeholder="https://api.openai.com/v1" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending}>{pending ? "Testing the key…" : "Test and connect"}</Button>
        {state?.message && <span className="text-sm text-emerald-600">{state.message}</span>}
        {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
      </div>
    </form>
  );
}
