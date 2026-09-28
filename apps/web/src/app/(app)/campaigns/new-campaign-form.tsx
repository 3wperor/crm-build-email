"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCampaign } from "./actions";

export function NewCampaignForm() {
  const [state, action, pending] = useActionState(createCampaign, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder="Campaign name" aria-label="Campaign name" required maxLength={200} className="w-64" />
      <Button disabled={pending}>
        <Plus /> {pending ? "Creating…" : "New campaign"}
      </Button>
      {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
    </form>
  );
}
