"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select-native";
import { enrollLeads } from "../actions";

export function EnrollForm({ campaignId, lists }: { campaignId: string; lists: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(enrollLeads, undefined);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="campaign_id" value={campaignId} />
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect name="source" defaultValue={lists[0]?.id ?? "all"} className="w-auto" aria-label="Leads to add">
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              List: {l.name}
            </option>
          ))}
          <option value="all">All eligible leads</option>
        </NativeSelect>
        <Button variant="outline" disabled={pending}>
          <UserPlus /> {pending ? "Adding…" : "Add leads"}
        </Button>
      </div>
      {state?.message && <p className="text-sm text-emerald-600">{state.message}</p>}
      {state?.error && <p className="text-destructive text-sm">{state.error}</p>}
    </form>
  );
}
