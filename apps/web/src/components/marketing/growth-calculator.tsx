"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { CUSTOMER_VALUE_OPTIONS, GOAL_OPTIONS, assumptionsText, gbp, growthPlan } from "@crm/core/growth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Pick<T extends number>({ options, value, onChange, format }: { options: readonly T[]; value: T; onChange: (v: T) => void; format: (v: T, last: boolean) => string }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          aria-pressed={value === o}
          className={cn("rounded-md border px-2 py-2 text-sm font-medium transition-colors", value === o ? "border-primary bg-primary/5 ring-primary/20 ring-2" : "bg-background hover:bg-muted/50")}
        >
          {format(o, i === options.length - 1)}
        </button>
      ))}
    </div>
  );
}

/** "What could outreach be worth to you?" — the same maths as the welcome flow. */
export function GrowthCalculator() {
  const [value, setValue] = useState<number>(1000);
  const [goal, setGoal] = useState<number>(3);
  const plan = growthPlan({ customerValue: value, customersPerMonth: goal });
  return (
    <div className="bg-card grid gap-5 rounded-xl border p-5 shadow-sm sm:p-6" data-testid="calculator">
      <div className="grid gap-2">
        <div className="text-sm font-medium">What&apos;s one new customer worth to you?</div>
        <Pick options={CUSTOMER_VALUE_OPTIONS} value={value as (typeof CUSTOMER_VALUE_OPTIONS)[number]} onChange={setValue} format={(v, last) => `${gbp(v)}${last ? "+" : ""}`} />
      </div>
      <div className="grid gap-2">
        <div className="text-sm font-medium">How many new customers a month would you like?</div>
        <Pick options={GOAL_OPTIONS} value={goal as (typeof GOAL_OPTIONS)[number]} onChange={setGoal} format={(v, last) => `${v}${last ? "+" : ""}`} />
      </div>
      <div className="bg-primary/5 border-primary/30 grid gap-1 rounded-md border p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="text-primary size-4" /> That&apos;s about {gbp(plan.yearlyValue)} a year in new business
        </div>
        <div className="text-muted-foreground text-sm">
          Roughly {plan.emailsPerMonth.toLocaleString("en-GB")} emails a month, and about {plan.hoursSavedPerMonth} hours saved compared with doing it by hand.
        </div>
        <div className="text-muted-foreground text-xs">{assumptionsText()}</div>
      </div>
      <Button asChild size="lg">
        <Link href="/signup">
          Start my free trial <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}
