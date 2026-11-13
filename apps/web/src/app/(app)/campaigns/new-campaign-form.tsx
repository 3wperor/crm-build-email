"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCampaign } from "./actions";

export function NewCampaignForm() {
  const [state, action, pending] = useActionState(createCampaign, undefined);
  return (
    <form action={action} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <Input name="name" placeholder="Campaign name" aria-label="Campaign name" required maxLength={200} className="min-w-0 flex-1 sm:w-64 sm:flex-none" />
      <Button loading={pending} disabled={pending}>
        <Plus /> New campaign
      </Button>
      {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
    </form>
  );
}
