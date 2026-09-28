import { can } from "@crm/core";
import { AlertTriangle } from "lucide-react";
import { getOrgContext } from "@/lib/org";
import { Nav } from "@/components/nav";
import { OrgSwitcher } from "@/components/org-switcher";
import { KillSwitch } from "@/components/kill-switch";
import { Badge } from "@/components/ui/badge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getOrgContext();
  const { org, role, user } = ctx;

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r p-3 md:flex">
        <div className="mb-4 grid gap-2 pt-1">
          <div className="px-2 text-base font-bold tracking-tight">
            YCA<span className="text-primary/60">Reach</span>
          </div>
          <OrgSwitcher ctx={ctx} />
        </div>
        <Nav />
        <div className="mt-auto grid gap-2 border-t pt-3">
          <div className="truncate px-2 text-xs">
            <div className="truncate font-medium">{user.email}</div>
            <div className="text-muted-foreground capitalize">{role}</div>
          </div>
          <form action="/auth/signout" method="post">
            <button className="text-muted-foreground hover:text-foreground px-2 text-xs hover:underline">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b px-6 backdrop-blur">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium md:hidden">{org.name}</span>
            {org.sending_paused ? (
              <Badge variant="destructive">Sending paused</Badge>
            ) : (
              <Badge variant="success">Sending live</Badge>
            )}
            {org.approval_mode === "draft" && <Badge variant="outline">Agent: draft-only</Badge>}
          </div>
          <KillSwitch
            paused={org.sending_paused}
            canPause={can(role, "sending.pause")}
            canResume={can(role, "sending.resume")}
          />
        </header>

        {org.sending_paused && (
          <div className="bg-destructive/10 text-destructive flex items-center gap-2 border-b px-6 py-2 text-sm">
            <AlertTriangle className="size-4" />
            All sending is paused
            {org.sending_paused_by ? ` by ${org.sending_paused_by}` : ""}
            {org.sending_paused_reason ? ` — ${org.sending_paused_reason}` : ""}.
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
