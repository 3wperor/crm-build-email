"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { pasteLeads } from "@/app/(app)/leads/actions";
import { ActionToast } from "@/components/ui/toast";
import { Textarea } from "@/components/ui/textarea";

/** Type or paste leads, one per line. Also accepts rows copied straight from Excel / Google Sheets. */
export function PasteLeadsForm({ campaignId }: { campaignId?: string }) {
  const [state, action, pending] = useActionState(pasteLeads, undefined);
  return (
    <form action={action} className="grid gap-2">
      {campaignId && <input type="hidden" name="campaign_id" value={campaignId} />}
      <Label htmlFor={`paste-leads-${campaignId ?? "all"}`}>Type or paste leads</Label>
      <Textarea
        // A fresh, empty box after each successful save.
        key={state?.version ?? 0}
        id={`paste-leads-${campaignId ?? "all"}`}
        name="leads"
        rows={5}
        placeholder={"ada@example.com, Ada, Lovelace, Analytical Engines\ngrace@example.com, Grace, Hopper, Navy"}
        className="font-mono"
      />
      <p className="text-muted-foreground text-xs">
        One per line: email, first name, last name, company, title (only the email is required). You can also paste rows copied from a spreadsheet.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={pending} disabled={pending} variant="outline">
          {campaignId ? "Add to campaign" : "Save leads"}
        </Button>
        <ActionToast state={state} message={state?.message} />
        {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
      </div>
    </form>
  );
}
