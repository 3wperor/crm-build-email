"use client";

import { useActionState } from "react";
import { REPLY_CLASSES } from "@crm/core/replies";
import { reclassifyReply } from "./actions";
import { ActionToast } from "@/components/ui/toast";
import { StatusBadge } from "@/components/status-badge";
import { statusLabel } from "@/lib/labels";

export function ClassificationBadge({ value }: { value: string | null }) {
  return <StatusBadge kind="reply" value={value ?? "neutral"} />;
}

export function ReclassifySelect({ replyId, value, canEdit }: { replyId: string; value: string | null; canEdit: boolean }) {
  const [state, action, pending] = useActionState(reclassifyReply, undefined);
  if (!canEdit) return <ClassificationBadge value={value} />;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="reply_id" value={replyId} />
      <select
        name="classification"
        defaultValue={value ?? "neutral"}
        aria-label="Reply type"
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="border-input bg-background h-8 rounded-md border px-2 text-xs shadow-xs"
      >
        {REPLY_CLASSES.map((c) => (
          <option key={c} value={c}>
            {statusLabel("reply", c)}
          </option>
        ))}
      </select>
      {state?.error && <span className="text-destructive text-xs">{state.error}</span>}
      <ActionToast state={state} message={state?.message} />
    </form>
  );
}
