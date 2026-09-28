"use client";

import { useActionState } from "react";
import { OctagonX, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setSendingPaused } from "@/app/(app)/actions";

export function KillSwitch({ paused, canPause, canResume }: { paused: boolean; canPause: boolean; canResume: boolean }) {
  const [state, action, pending] = useActionState(setSendingPaused, undefined);

  if (paused) {
    return (
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="paused" value="false" />
        {state?.error && <span className="text-destructive text-xs">{state.error}</span>}
        <Button size="sm" variant="outline" disabled={!canResume || pending} title={canResume ? undefined : "Owners/admins only"}>
          <Play /> Resume sending
        </Button>
      </form>
    );
  }

  return (
    <form
      action={action}
      className="flex items-center gap-2"
      onSubmit={(e) => {
        if (!window.confirm("Pause ALL sending for this workspace? Campaigns, follow-ups, tests and warmup stop immediately.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="paused" value="true" />
      <input type="hidden" name="reason" value="Manual kill switch" />
      {state?.error && <span className="text-destructive text-xs">{state.error}</span>}
      <Button size="sm" variant="destructive" disabled={!canPause || pending}>
        <OctagonX /> Pause all sending
      </Button>
    </form>
  );
}
