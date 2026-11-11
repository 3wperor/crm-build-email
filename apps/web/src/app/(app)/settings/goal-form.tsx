"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateGoal } from "./actions";

export function GoalForm({ customersPerMonth, customerValue }: { customersPerMonth: number | null; customerValue: number | null }) {
  const [state, action, pending] = useActionState(updateGoal, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="customers_per_month">New customers a month</Label>
        <Input id="customers_per_month" name="customers_per_month" type="number" min={1} max={1000} defaultValue={customersPerMonth ?? ""} className="w-32" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="customer_value">One customer is worth (£)</Label>
        <Input id="customer_value" name="customer_value" inputMode="numeric" defaultValue={customerValue ?? ""} className="w-40" />
      </div>
      <Button size="sm" disabled={pending}>
        Save goal
      </Button>
      {state?.ok && <span className="text-sm text-success">Saved.</span>}
      {state?.error && <span className="text-destructive text-sm">{state.error}</span>}
    </form>
  );
}
