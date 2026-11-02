import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Payment received" };
export const dynamic = "force-dynamic";

/** After Stripe checkout. Stripe's webhook usually activates the plan within seconds; this page waits for it. */
export default async function SuccessPage() {
  let activePlan: string | null = null;
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getClaims();
    if (auth?.claims?.sub) {
      // The workspace(s) this user belongs to; any paid one means we're done.
      const { data } = await supabase.from("memberships").select("organizations!inner(plan)").eq("user_id", auth.claims.sub);
      activePlan = (data ?? []).map((m) => (m.organizations as unknown as { plan: string }).plan).find((p) => p === "standard" || p === "pro") ?? null;
    }
  } catch {
    // Not signed in on this device: show the generic message.
  }

  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-6">
      <AutoRefresh active={!activePlan} intervalMs={2000} />
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-xl">{activePlan ? "You're all set!" : "Thank you!"}</CardTitle>
          <CardDescription data-testid="success-message">
            {activePlan
              ? `Your ${activePlan === "pro" ? "Pro" : "Standard"} plan is active. You can start sending now.`
              : "Payment received. Your account will be activated shortly."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={activePlan ? "/campaigns" : "/dashboard"} className="text-sm underline underline-offset-4">
            {activePlan ? "Go to campaigns" : "Back to YCAReach"}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
