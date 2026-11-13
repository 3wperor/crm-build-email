"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { switchOrganization } from "@/app/(app)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(email: string): string {
  const parts = email.split("@")[0]!.split(/[._+-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Bottom of the sidebar: who you are, which workspace you're in, and the way out. */
export function UserMenu({
  email,
  role,
  orgId,
  orgs,
}: {
  email: string;
  role: string;
  orgId: string;
  orgs: { id: string; name: string }[];
}) {
  const router = useRouter();
  const signOut = useRef<HTMLFormElement>(null);
  const [switching, startSwitch] = useTransition();
  const orgName = orgs.find((o) => o.id === orgId)?.name ?? "";

  const switchTo = (id: string) => {
    if (id === orgId) return;
    const data = new FormData();
    data.set("org_id", id);
    startSwitch(async () => {
      await switchOrganization(data);
      router.refresh();
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="user-menu"
          className="hover:bg-sidebar-accent/70 data-[state=open]:bg-sidebar-accent/70 focus-visible:ring-ring/50 flex w-full items-center gap-2.5 rounded-md p-1.5 text-left outline-none focus-visible:ring-[3px] aria-busy:opacity-60"
          aria-busy={switching}
        >
          <span aria-hidden="true" className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
            {initials(email)}
          </span>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm font-medium">{orgName}</span>
            <span className="text-muted-foreground text-caption truncate">{email}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
          <div className="px-2 py-1.5">
            <div className="truncate text-sm font-medium">{email}</div>
            <div className="text-muted-foreground text-caption capitalize">{role}</div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{orgs.length > 1 ? "Workspaces" : "Workspace"}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={orgId} onValueChange={switchTo}>
            {orgs.map((o) => (
              <DropdownMenuRadioItem key={o.id} value={o.id}>
                <span className="truncate">{o.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOut.current?.requestSubmit()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form ref={signOut} action="/auth/signout" method="post" hidden />
    </>
  );
}
