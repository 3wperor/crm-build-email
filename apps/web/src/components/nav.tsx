"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Ban,
  Flame,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  MessageSquareReply,
  Send,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/inboxes", label: "Inboxes", icon: Mail },
  { href: "/replies", label: "Replies", icon: MessageSquareReply },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/warmup", label: "Warmup", icon: Flame, badge: "beta" },
  { href: "/suppression", label: "Suppression", icon: Ban },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="grid gap-0.5">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
            )}
          >
            <Icon className="size-4" />
            <span className="flex-1">{item.label}</span>
            {"badge" in item && (
              <span className="rounded bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-700 uppercase dark:text-amber-400">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

