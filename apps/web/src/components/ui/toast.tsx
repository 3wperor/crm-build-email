"use client";

import { useEffect } from "react";
import { Toaster as Sonner, toast } from "sonner";

/** Where toasts appear. Mounted once, in the root layout. Announced to screen readers (aria-live). */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      theme="system"
      duration={4000}
      toastOptions={{
        classNames: {
          toast: "!bg-popover !text-popover-foreground !border-border !shadow-md !rounded-lg !font-sans !text-sm",
          description: "!text-muted-foreground",
          success: "[&_[data-icon]]:!text-success",
          error: "[&_[data-icon]]:!text-destructive",
        },
      }}
    />
  );
}

/**
 * Shows a "Saved"-style toast when a server action succeeds. Drop it in a form
 * next to useActionState: `state` is the action's latest result (so the same
 * message can show twice in a row) and `message` is what to say, if anything.
 */
export function ActionToast({ state, message }: { state: unknown; message?: string | null | false }) {
  useEffect(() => {
    if (message) toast.success(message);
  }, [state, message]);
  return null;
}

export { toast };
