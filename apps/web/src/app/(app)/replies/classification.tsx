"use client";

import { useActionState } from "react";
import { REPLY_CLASSES } from "@crm/core/replies";
import { Badge } from "@/components/ui/badge";
import { reclassifyReply } from "./actions";

const VARIANT = { positive: "success", negative: "destructive", out_of_office: "secondary", unsubscribe: "warning", neutral: "outline" } as const;

export function ClassificationBadge({ value }: { value: string | null }) {
  const v = value ?? "neutral";
  return <Badge variant={VARIANT[v as keyof typeof VARIANT] ?? "outline"}>{v.replace(/_/g, " ")}</Badge>;
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
        aria-label="Classification"
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="border-input rounded-md border bg-transparent px-2 py-1 text-xs"
      >
        {REPLY_CLASSES.map((c) => (
          <option key={c} value={c}>
            {c.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      {state?.error && <span className="text-destructive text-xs">{state.error}</span>}
      {state?.message && <span className="text-xs text-emerald-600">{state.message}</span>}
    </form>
  );
}
