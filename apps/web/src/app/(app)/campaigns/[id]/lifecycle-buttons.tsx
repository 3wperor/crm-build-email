"use client";

import { useActionState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { pauseCampaign, startCampaign } from "../actions";

export function LifecycleButtons({ campaignId, status, canEdit }: { campaignId: string; status: string; canEdit: boolean }) {
  const [startState, start, starting] = useActionState(startCampaign, undefined);
  const [pauseState, pause, pausing] = useActionState(pauseCampaign, undefined);
  const state = startState?.error || startState?.message ? startState : pauseState;
  if (!canEdit) return null;
  return (
    <div className="grid justify-items-end gap-2">
      <div className="flex gap-2">
        {status === "active" ? (
          <form action={pause}>
            <input type="hidden" name="campaign_id" value={campaignId} />
            <Button variant="outline" disabled={pausing}>
              <Pause /> Pause campaign
            </Button>
          </form>
        ) : (
          (status === "draft" || status === "paused") && (
            <form action={start}>
              <input type="hidden" name="campaign_id" value={campaignId} />
              <Button disabled={starting}>
                <Play /> {status === "paused" ? "Resume" : "Start campaign"}
              </Button>
            </form>
          )
        )}
      </div>
      {state?.error && (
        <Alert variant="destructive" className="max-w-md text-left">
          <AlertTitle>{state.error}</AlertTitle>
          {state.problems && (
            <AlertDescription>
              <ul className="list-disc pl-4">
                {state.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </AlertDescription>
          )}
        </Alert>
      )}
      {state?.message && <span className="text-sm text-emerald-600">{state.message}</span>}
    </div>
  );
}
