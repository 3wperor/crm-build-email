"use client";

import { useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  /** Names the action, e.g. "Delete campaign". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button, for things that can't be undone. */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
let current: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Ask "are you sure?" in a proper dialog. Resolves true when confirmed. Needs <ConfirmHost /> on the page. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => {
    current = { ...options, resolve };
    emit();
  });
}

function settle(ok: boolean) {
  current?.resolve(ok);
  current = null;
  emit();
}

/** Renders the dialog for confirmDialog(). Mounted once, in the root layout. */
export function ConfirmHost() {
  const pending = useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
    () => null,
  );
  // Keep the last text on screen while the dialog fades out.
  const last = useRef<Pending | null>(null);
  if (pending) last.current = pending;
  const shown = pending ?? last.current;
  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{shown?.title}</DialogTitle>
          <DialogDescription asChild={!!shown?.description && typeof shown.description !== "string"}>
            {typeof shown?.description === "string" || !shown?.description ? (shown?.description ?? "") : <div>{shown.description}</div>}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            {shown?.cancelLabel ?? "Cancel"}
          </Button>
          <Button variant={shown?.destructive ? "destructive" : "default"} onClick={() => settle(true)}>
            {shown?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * For forms: ask first, then submit. Call from onSubmit; pass null when this
 * submit needs no question.
 *
 *   const guard = useConfirmSubmit();
 *   <form action={action} onSubmit={(e) => guard(e, { title: "Delete?", confirmLabel: "Delete", destructive: true })}>
 */
export function useConfirmSubmit() {
  const confirmed = useRef(false);
  return (event: React.FormEvent<HTMLFormElement>, options: ConfirmOptions | null) => {
    if (confirmed.current || !options) {
      confirmed.current = false;
      return;
    }
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    void confirmDialog(options).then((ok) => {
      if (!ok) return;
      confirmed.current = true;
      form.requestSubmit(submitter);
    });
  };
}
