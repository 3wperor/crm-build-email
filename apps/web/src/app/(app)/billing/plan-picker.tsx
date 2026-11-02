"use client";

import { useState, useTransition } from "react";
import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { openBillingPortal, startCheckout, type BillingResult } from "./actions";

type PaidPlan = "standard" | "pro";
type Interval = "month" | "year";

const PRICES: Record<PaidPlan, Record<Interval, number>> = { standard: { month: 20, year: 200 }, pro: { month: 25, year: 250 } };
const FEATURES: { label: string; standard: boolean }[] = [
  { label: "Unlimited campaigns, follow-ups and A/B tests", standard: true },
  { label: "Your own inboxes, lead import (CSV/Excel) and verification", standard: true },
  { label: "Reply detection, pipeline, analytics, warmup", standard: true },
  { label: "HubSpot sync", standard: true },
  { label: "Connect your own Claude (Anthropic) key", standard: false },
  { label: "Claude writes your campaign emails", standard: false },
  { label: "Claude reads replies and drafts answers for you", standard: false },
  { label: "AI agent: let Claude run campaigns for you", standard: false },
];

export function PlanPicker({ currentPlan, canManage, subscribed }: { currentPlan: string; canManage: boolean; subscribed: boolean }) {
  const [interval, setInterval] = useState<Interval>("month");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(action: () => Promise<BillingResult>) {
    setError(null);
    start(async () => {
      const r = await action();
      if (r.url) window.location.href = r.url;
      else setError(r.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-1 self-start rounded-lg border p-1 text-sm" role="group" aria-label="Billing period">
        {(["month", "year"] as const).map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => setInterval(i)}
            aria-pressed={interval === i}
            className={cn("rounded-md px-3 py-1", interval === i ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
          >
            {i === "month" ? "Monthly" : "Yearly · 2 months free"}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(["standard", "pro"] as const).map((plan) => {
          const current = currentPlan === plan;
          return (
            <Card key={plan} className={cn(plan === "pro" && "border-primary")} data-testid={`plan-${plan}`}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-lg capitalize">
                  {plan}
                  {plan === "pro" && <span className="bg-primary text-primary-foreground rounded px-2 py-0.5 text-xs">With Claude</span>}
                </CardTitle>
                <CardDescription>
                  <span className="text-foreground text-3xl font-semibold">£{PRICES[plan][interval]}</span> / {interval === "month" ? "month" : "year"}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <ul className="grid gap-2 text-sm">
                  {FEATURES.map((f) => {
                    const on = plan === "pro" || f.standard;
                    return (
                      <li key={f.label} className={cn("flex items-start gap-2", !on && "text-muted-foreground")}>
                        {on ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Minus className="mt-0.5 size-4 shrink-0" />}
                        {f.label}
                      </li>
                    );
                  })}
                </ul>
                {canManage &&
                  (current && subscribed ? (
                    <Button variant="outline" disabled={pending} onClick={() => go(openBillingPortal)}>
                      Your plan · Manage billing
                    </Button>
                  ) : (
                    <Button variant={plan === "pro" ? "default" : "outline"} disabled={pending} onClick={() => go(() => startCheckout(plan, interval))}>
                      {pending ? "Opening…" : subscribed ? `Switch to ${plan === "pro" ? "Pro" : "Standard"}` : `Choose ${plan === "pro" ? "Pro" : "Standard"}`}
                    </Button>
                  ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <p className="text-muted-foreground text-xs">Payments are handled by Stripe. Cancel or switch plans any time; your data is always kept.</p>
    </div>
  );
}
