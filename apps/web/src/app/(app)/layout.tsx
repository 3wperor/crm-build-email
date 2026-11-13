import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { Nav } from "@/components/nav";
import { UserMenu } from "@/components/user-menu";
import { MobileNav } from "@/components/mobile-nav";
import { Banner } from "@/components/banner";
import { SendingStatus } from "@/components/sending-status";
import { Suspense } from "react";
import { NavigationProgress } from "@/components/navigation-progress";
import { PlanBadge } from "@/components/plan-badge";
import { getBillingStatus } from "@/lib/billing";
import Link from "next/link";
import { billingBanner } from "@crm/core/onboarding";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/brand/logo";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getOrgContext();
  const { org, role, user } = ctx;
  const supabase = await createClient();
  const [billing, { count: needsReply }] = await Promise.all([
    getBillingStatus(org.id),
    supabase
      .from("replies")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .is("handled_at", null)
      .in("classification", ["positive", "neutral"]),
  ]);

  const banner = billingBanner(billing);

  // "user:<id>" is an internal reference: say "you" when it's this person, otherwise leave the name out.
  const by = org.sending_paused_by;
  const pausedBy = !by ? null : by === `user:${user.id}` ? "you" : by.startsWith("user:") ? null : by;

  const sidebar = (
    <>
      <Link href="/dashboard" className="mb-5 flex h-8 w-fit items-center px-2">
        <Logo />
      </Link>
      <Nav counts={{ "/replies": needsReply ?? 0 }} />
      <div className="mt-3 border-t pt-3">
        <UserMenu email={user.email} role={role} orgId={org.id} orgs={ctx.orgs.map((o) => ({ id: o.org.id, name: o.org.name }))} />
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r p-3 md:flex">{sidebar}</aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/85 sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav>
              <div className="flex min-h-0 flex-1 flex-col p-3">{sidebar}</div>
            </MobileNav>
            <SendingStatus paused={org.sending_paused} canPause={can(role, "sending.pause")} canResume={can(role, "sending.resume")} />
          </div>
          <PlanBadge status={billing} />
        </header>

        {banner && (
          <Banner
            data-testid="billing-banner"
            tone={banner.tone === "danger" ? "danger" : "warning"}
            action={<Link href="/billing">{banner.cta}</Link>}
          >
            {banner.message}
          </Banner>
        )}
        {org.sending_paused && (
          <Banner tone="danger">
            All sending is paused
            {pausedBy ? ` by ${pausedBy}` : ""}
            {org.sending_paused_reason ? ` (${org.sending_paused_reason})` : ""}.
          </Banner>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
