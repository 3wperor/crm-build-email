"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { ChevronDown, Pause, Play } from "lucide-react";
import { setSendingPaused } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * One control for "is anything going out?": a pill that says whether sending is
 * on, and opens a small menu to pause everything (or switch it back on).
 */
export function SendingStatus({ paused, canPause, canResume }: { paused: boolean; canPause: boolean; canResume: boolean }) {
  const [state, action] = useActionState(setSendingPaused, undefined);
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const submit = (next: boolean) => {
    const data = new FormData();
    data.set("paused", String(next));
    start(() => action(data));
  };
  // Close the confirmation once the pause has gone through.
  useEffect(() => {
    if (paused) setConfirming(false);
  }, [paused]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="sending-status"
          aria-busy={pending}
          className={cn(
            "focus-visible:ring-ring/50 flex h-8 items-center gap-2 rounded-full border pr-2 pl-2.5 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] aria-busy:opacity-60",
            paused ? "border-destructive/30 bg-destructive/10 text-destructive" : "bg-background hover:bg-accent/60 data-[state=open]:bg-accent/60",
          )}
        >
          {paused ? (
            <Pause className="size-3.5" aria-hidden="true" />
          ) : (
            <span aria-hidden="true" className="relative flex size-2">
              <span className="bg-success absolute inline-flex size-full rounded-full opacity-40 motion-safe:animate-ping" />
              <span className="bg-success relative inline-flex size-2 rounded-full" />
            </span>
          )}
          {paused ? "Sending paused" : "Sending on"}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <p className="text-muted-foreground text-small px-2 py-1.5">
            {paused
              ? "Nothing is going out: campaigns, follow-ups, tests and warmup are all on hold."
              : "Emails go out slowly, within your sending hours."}
          </p>
          {state?.error && <p className="text-destructive text-small px-2 pb-1.5">{state.error}</p>}
          <DropdownMenuSeparator />
          {paused ? (
            <DropdownMenuItem disabled={!canResume || pending} onSelect={() => submit(false)}>
              <Play /> {canResume ? "Resume sending" : "Only owners and admins can resume"}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" disabled={!canPause || pending} onSelect={() => setConfirming(true)}>
              <Pause /> Pause all sending
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause all sending?</DialogTitle>
            <DialogDescription>
              Campaigns, follow-ups, test emails and warmup stop straight away for the whole workspace. Nothing is deleted, and everything carries on
              where it left off when sending is resumed.
            </DialogDescription>
          </DialogHeader>
          {state?.error && <p className="text-destructive text-sm">{state.error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              Keep sending
            </Button>
            <Button variant="destructive" onClick={() => submit(true)} disabled={pending}>
              <Pause /> Pause all sending
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
