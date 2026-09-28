"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyAllUnverified } from "./actions";

export function VerifyAllButton({ count }: { count: number }) {
  const [state, action, pending] = useActionState(verifyAllUnverified, undefined);
  return (
    <form action={action} className="flex items-center gap-3">
      <Button variant="outline" size="sm" disabled={pending}>
        <MailCheck /> Verify {count.toLocaleString()} unverified lead{count === 1 ? "" : "s"}
      </Button>
      {state?.message && <span className="text-sm text-emerald-600">{state.message}</span>}
      {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
    </form>
  );
}
