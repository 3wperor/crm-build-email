import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, Bot, Check, Inbox, LineChart, MailCheck, Minus, Reply, ShieldCheck, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicShell } from "@/components/marketing/public-shell";
import { GrowthCalculator } from "@/components/marketing/growth-calculator";
import { PLAN_FEATURES, PRICES, TRIAL } from "@/lib/plans";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "YCAReach: cold email that sounds like you, from your own inbox" },
  description:
    "Send personal cold emails from your own inbox, follow up automatically, and stop the moment someone replies. AI writes the campaign and drafts your replies. Free 7-day trial, no card needed.",
  robots: { index: true, follow: true },
};

const STEPS = [
  { title: "Connect your inbox", text: "Gmail, Google Workspace or any email with an app password. Takes about 2 minutes." },
  { title: "Add the people you want to reach", text: "Upload a spreadsheet or paste addresses. We check every email before it's sent." },
  { title: "Let AI write the campaign", text: "Describe what you sell and who to. You get the first email and the follow-ups, ready to edit." },
  { title: "Press Start and answer replies", text: "Emails go out slowly within your hours. When someone replies, AI drafts your answer." },
];

const FEATURES = [
  { icon: Inbox, title: "From your own inbox", text: "Emails come from your real address, so they read like a personal note, not a newsletter." },
  { icon: Reply, title: "Follow-ups that stop on reply", text: "Most deals need a nudge. YCAReach follows up for you and stops the moment someone answers." },
  { icon: Sparkles, title: "AI that writes and replies", text: "Write a whole sequence from two sentences. Get a draft answer for every interested reply." },
  { icon: ShieldCheck, title: "Safe sending", text: "Daily limits, sending hours, warmup, email checks, and an unsubscribe link in every email." },
  { icon: LineChart, title: "Pipeline and results", text: "Interested replies land in your pipeline. See which emails and subject lines win." },
  { icon: Bot, title: "Works with Claude", text: "Connect Claude and ask it to run campaigns or answer replies for you, with your approval." },
];

const FAQ = [
  {
    q: "Will my emails land in spam?",
    a: "Nobody can promise inbox placement, but YCAReach does what helps most: it sends from your own inbox, slowly and within your hours, checks addresses before sending, warms up new inboxes, and stops sending to anyone who bounces or unsubscribes.",
  },
  {
    q: "Is cold email legal?",
    a: "In the UK you can usually email people at limited companies about relevant business offers, as long as you say who you are and let them opt out. YCAReach adds your address and an unsubscribe link to every email. Rules are stricter for sole traders and differ between countries, so check the ICO's guidance (or your local rules) for your situation.",
  },
  {
    q: "What do I need to get started?",
    a: "An email address on Gmail, Google Workspace or another provider that supports app passwords, and a list of people you'd like to work with (or the willingness to build one). Outlook / Microsoft 365 isn't supported yet.",
  },
  {
    q: "What happens when the trial ends?",
    a: "Sending pauses and nothing is deleted. Pick a plan and everything carries on where it left off. We'll email you two days before.",
  },
  { q: "Can I cancel any time?", a: "Yes. Cancel in Billing whenever you like: your plan runs to the end of the period you've paid for." },
];

export default async function HomePage() {
  // Signed-in users go straight to their workspace.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect("/dashboard");

  return (
    <PublicShell>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.1fr_1fr] md:py-20">
        <div className="grid gap-5">
          <p className="text-primary text-sm font-medium">Cold email for small businesses</p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Win new customers with emails that sound like you.</h1>
          <p className="text-muted-foreground text-lg">
            YCAReach sends personal emails from your own inbox, follows up automatically, and stops the moment someone replies. AI writes the campaign
            and drafts your answers, so it takes minutes, not hours.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup">
                Start your free {TRIAL.days}-day trial <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/docs">See how it works</Link>
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">No card needed · {TRIAL.emails} emails included · Every feature, including AI</p>
        </div>
        <GrowthCalculator />
      </section>

      {/* How it works */}
      <section className="bg-muted/40 border-y">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Your first campaign in about 15 minutes</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid content-start gap-2">
                <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-full text-sm font-semibold">{i + 1}</span>
                <h3 className="font-medium">{s.title}</h3>
                <p className="text-muted-foreground text-sm">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight">Everything you need, nothing you don&apos;t</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <CardHeader>
                <f.icon className="text-primary size-5" />
                <CardTitle className="text-base">{f.title}</CardTitle>
                <CardDescription>{f.text}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-muted/40 scroll-mt-16 border-y">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Simple pricing</h2>
          <p className="text-muted-foreground mt-1">
            Start with a free {TRIAL.days}-day trial of everything ({TRIAL.emails} emails, no card). Pay yearly and get 2 months free.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {(["standard", "pro"] as const).map((plan) => (
              <Card key={plan} className={cn(plan === "pro" && "border-primary ring-primary/20 ring-2")}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="capitalize">{plan}</span>
                    {plan === "pro" && <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">Recommended</span>}
                  </CardTitle>
                  <div>
                    <span className="text-3xl font-bold">£{PRICES[plan].month}</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                  <CardDescription>or £{PRICES[plan].year}/year, per workspace</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <ul className="grid gap-2 text-sm">
                    {PLAN_FEATURES.map((f) => {
                      const on = plan === "pro" || f.standard;
                      return (
                        <li key={f.label} className={cn("flex items-start gap-2", !on && "text-muted-foreground")}>
                          {on ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <Minus className="mt-0.5 size-4 shrink-0" />}
                          {f.label}
                        </li>
                      );
                    })}
                  </ul>
                  <Button asChild variant={plan === "pro" ? "default" : "outline"}>
                    <Link href="/signup">Start free trial</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight">Questions</h2>
        <div className="mt-6 grid gap-3">
          {FAQ.map((f) => (
            <details key={f.q} className="group rounded-md border p-4">
              <summary className="cursor-pointer font-medium">{f.q}</summary>
              <p className="text-muted-foreground mt-2 text-sm">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t">
        <div className="mx-auto grid max-w-6xl justify-items-center gap-4 px-4 py-14 text-center sm:px-6">
          <MailCheck className="text-primary size-8" />
          <h2 className="text-2xl font-semibold tracking-tight">Your next customer is one email away</h2>
          <p className="text-muted-foreground max-w-xl">Set up in about 15 minutes. Free for {TRIAL.days} days, no card needed.</p>
          <Button asChild size="lg">
            <Link href="/signup">
              Start your free trial <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </PublicShell>
  );
}
