"use client";

import { useActionState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { pauseCampaign, startCampaign } from "../actions";
import { ActionToast } from "@/components/ui/toast";

export function LifecycleButtons({
  campaignId,
  status,
  canEdit,
  blocked,
}: {
  campaignId: string;
  status: string;
  canEdit: boolean;
  /** Why this workspace can't send right now (trial over, no plan), or null. */
  blocked: string | null;
}) {
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
            <Button variant="outline" loading={pausing}>
              <Pause /> Pause campaign
            </Button>
          </form>
        ) : (
          (status === "draft" || status === "paused") &&
          (blocked ? (
            // Display only: the server action and the sender refuse too.
            <div className="flex max-w-md items-center gap-3 text-right" data-testid="paywall">
              <span className="text-sm font-medium">{blocked}</span>
              <Button asChild>
                <Link href="/billing">Choose a plan</Link>
              </Button>
            </div>
          ) : (
            <form action={start}>
              <input type="hidden" name="campaign_id" value={campaignId} />
              <Button loading={starting}>
                <Play /> {status === "paused" ? "Resume campaign" : "Start campaign"}
              </Button>
            </form>
          ))
        )}
      </div>
      {state?.error && (
        <Alert variant="destructive" className="max-w-md text-left">
          <AlertTitle>{state.error}</AlertTitle>
          {"upgrade" in state && state.upgrade && (
            <div className="mt-2">
              <Button asChild size="sm">
                <Link href="/billing">Choose a plan</Link>
              </Button>
            </div>
          )}
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
      <ActionToast state={state} message={state?.message} />
    </div>
  );
}
