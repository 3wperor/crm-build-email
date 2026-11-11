"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyAllUnverified } from "./actions";
import { ActionToast } from "@/components/ui/toast";

export function VerifyAllButton({ count }: { count: number }) {
  const [state, action, pending] = useActionState(verifyAllUnverified, undefined);
  return (
    <form action={action} className="flex items-center gap-3">
      <Button variant="outline" size="sm" disabled={pending}>
        <MailCheck /> Verify {count.toLocaleString("en-GB")} unverified lead{count === 1 ? "" : "s"}
      </Button>
      <ActionToast state={state} message={state?.message} />
      {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
    </form>
  );
}
