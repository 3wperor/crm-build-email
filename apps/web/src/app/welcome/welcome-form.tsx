"use client";

import { useActionState, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import {
  CHANNELS,
  CUSTOMER_VALUE_OPTIONS,
  GOAL_OPTIONS,
  assumptionsText,
  channelFacts,
  gbp,
  goalFact,
  growthPlan,
  valueFact,
  type ChannelId,
} from "@crm/core/growth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { saveWelcome } from "./actions";
import { Logo } from "@/components/brand/logo";
import { Textarea } from "@/components/ui/textarea";

const STEPS = 4; // questions; the plan comes after

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn("rounded-md border px-3 py-3 text-sm font-medium transition-colors", selected ? "border-primary bg-primary/5 ring-primary/20 ring-2" : "hover:bg-muted/50")}
    >
      {children}
    </button>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-primary/5 border-primary/30 animate-in fade-in flex gap-2 rounded-md border p-3 text-sm" data-testid="fact">
      <Sparkles className="text-primary mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function WelcomeFlow({ workspace }: { workspace: string }) {
  const [step, setStep] = useState(0);
  const [value, setValue] = useState<number | null>(null);
  const [customValue, setCustomValue] = useState("");
  const [goal, setGoal] = useState<number | null>(null);
  const [channels, setChannels] = useState<ChannelId[]>([]);
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [hasList, setHasList] = useState<"yes" | "no" | "">("");
  const [state, action, pending] = useActionState(saveWelcome, undefined);

  const typed = Number(customValue.replace(/[£,\s]/g, ""));
  const customerValue = customValue ? (Number.isInteger(typed) && typed > 0 && typed <= 10_000_000 ? typed : null) : value;
  const plan = growthPlan({ customerValue, customersPerMonth: goal });
  const next = () => setStep((s) => s + 1);
  const toggleChannel = (id: ChannelId) => setChannels((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <Card className="w-full max-w-xl">
      <CardContent className="grid gap-6 pt-6">
        <div className="flex items-center justify-between gap-4">
          <Logo size="sm" />
          {step < STEPS && (
            <form action={action}>
              <input type="hidden" name="skip" value="1" />
              <button className="text-muted-foreground hover:text-foreground text-xs underline" disabled={pending}>
                Skip setup
              </button>
            </form>
          )}
        </div>
        {step < STEPS && (
          <div className="grid gap-1.5">
            <div className="text-muted-foreground text-xs">
              Question {step + 1} of {STEPS}
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
              <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${((step + 1) / (STEPS + 1)) * 100}%` }} />
            </div>
          </div>
        )}

        {step === 0 && (
          <section className="grid gap-4" data-testid="step-value">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">What&apos;s one new customer worth to you, roughly?</h1>
              <p className="text-muted-foreground text-sm">What they spend with you in total. A rough guess is fine.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CUSTOMER_VALUE_OPTIONS.map((v, i) => (
                <Option
                  key={v}
                  selected={!customValue && value === v}
                  onClick={() => {
                    setValue(v);
                    setCustomValue("");
                  }}
                >
                  {gbp(v)}
                  {i === CUSTOMER_VALUE_OPTIONS.length - 1 ? "+" : ""}
                </Option>
              ))}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="custom-value" className="text-muted-foreground text-xs font-normal">
                Or type your own
              </Label>
              <Input id="custom-value" inputMode="numeric" placeholder="£" value={customValue} onChange={(e) => setCustomValue(e.target.value)} className="max-w-40" />
            </div>
            {customerValue && <Fact>{valueFact(customerValue)}</Fact>}
          </section>
        )}

        {step === 1 && (
          <section className="grid gap-4" data-testid="step-goal">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">How many new customers a month would make a real difference?</h1>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {GOAL_OPTIONS.map((g, i) => (
                <Option key={g} selected={goal === g} onClick={() => setGoal(g)}>
                  {g}
                  {i === GOAL_OPTIONS.length - 1 ? "+" : ""}
                </Option>
              ))}
            </div>
            {goal && <Fact>{goalFact(plan.customerValue, goal)}</Fact>}
          </section>
        )}

        {step === 2 && (
          <section className="grid gap-4" data-testid="step-channels">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">How do you find new customers today?</h1>
              <p className="text-muted-foreground text-sm">Pick all that apply.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {CHANNELS.map((c) => (
                <Option key={c.id} selected={channels.includes(c.id)} onClick={() => toggleChannel(c.id)}>
                  {c.label}
                </Option>
              ))}
            </div>
            {channels.length > 0 && (
              <div className="grid gap-2">
                {channelFacts(channels).map((f) => (
                  <Fact key={f}>{f}</Fact>
                ))}
              </div>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="grid gap-4" data-testid="step-offer">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">What do you sell, and who to?</h1>
              <p className="text-muted-foreground text-sm">Our AI uses this to write your first campaign for you.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="offer">What you sell</Label>
              <Textarea
                id="offer"
                rows={3}
                maxLength={2000}
                value={offer}
                onChange={(e) => setOffer(e.target.value)}
                placeholder="e.g. We build fast websites for dental practices. Most go live in two weeks."
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="audience">Who you want to reach</Label>
              <Input id="audience" maxLength={500} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. Practice owners in Leeds and Manchester" />
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Do you already have a list of people to email?</span>
              <div className="grid grid-cols-2 gap-2">
                <Option selected={hasList === "yes"} onClick={() => setHasList("yes")}>
                  Yes, I have a list
                </Option>
                <Option selected={hasList === "no"} onClick={() => setHasList("no")}>
                  Not yet
                </Option>
              </div>
            </div>
            {offer.trim().length >= 10 && <Fact>Your first campaign is ready to write: one click and the AI drafts it for you.</Fact>}
          </section>
        )}

        {step === STEPS && (
          <section className="grid gap-4" data-testid="step-plan">
            <div>
              <div className="text-muted-foreground text-xs">Your plan for {workspace}</div>
              <h1 className="text-xl font-semibold tracking-tight">Here&apos;s what it takes</h1>
            </div>
            <dl className="grid gap-3 text-sm">
              <div className="rounded-md border p-3">
                <dt className="text-muted-foreground text-xs uppercase">Goal</dt>
                <dd className="text-base font-semibold">
                  {plan.customersPerMonth} new customer{plan.customersPerMonth === 1 ? "" : "s"} a month{" "}
                  <span className="text-muted-foreground font-normal">(about {gbp(plan.yearlyValue)} a year)</span>
                </dd>
              </div>
              <div className="rounded-md border p-3">
                <dt className="text-muted-foreground text-xs uppercase">What it takes</dt>
                <dd className="text-base font-semibold">Roughly {plan.emailsPerMonth.toLocaleString("en-GB")} emails a month</dd>
                <dd className="text-muted-foreground text-xs">{assumptionsText()}</dd>
              </div>
              <div className="rounded-md border p-3">
                <dt className="text-muted-foreground text-xs uppercase">Time saved</dt>
                <dd className="text-base font-semibold">About {plan.hoursSavedPerMonth} hours a month</dd>
                <dd className="text-muted-foreground text-xs">Compared with writing, sending and following up by hand.</dd>
              </div>
              <div className="bg-primary/5 border-primary/30 rounded-md border p-3">
                <dd>
                  <strong>Your free trial covers your first {plan.trialEmails} emails</strong>, enough to see if it works for you.
                </dd>
              </div>
            </dl>
            {plan.example && <p className="text-muted-foreground text-xs">We filled in an example for the questions you skipped. You can change your goal any time.</p>}
          </section>
        )}

        {state?.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        {step < STEPS ? (
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              <ArrowLeft /> Back
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={next} className="text-muted-foreground">
                Skip this
              </Button>
              <Button type="button" onClick={next}>
                {step === STEPS - 1 ? "See my plan" : "Next"} <ArrowRight />
              </Button>
            </div>
          </div>
        ) : (
          <form action={action} className="grid gap-2">
            <input type="hidden" name="customer_value" value={customerValue ?? ""} />
            <input type="hidden" name="customers_per_month" value={goal ?? ""} />
            {channels.map((c) => (
              <input key={c} type="hidden" name="channels" value={c} />
            ))}
            <input type="hidden" name="offer" value={offer} />
            <input type="hidden" name="audience" value={audience} />
            <input type="hidden" name="has_list" value={hasList} />
            <Button loading={pending} name="next" value="inbox" size="lg" disabled={pending}>
              Connect my inbox (2 minutes) <ArrowRight />
            </Button>
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep(STEPS - 1)}>
                <ArrowLeft /> Back
              </Button>
              <Button name="next" value="dashboard" variant="ghost" size="sm" disabled={pending}>
                Go to my dashboard instead
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
