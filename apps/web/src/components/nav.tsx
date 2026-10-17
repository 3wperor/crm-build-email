"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import {
  BarChart3,
  Ban,
  BookOpen,
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
  { href: "/docs", label: "Docs", icon: BookOpen },
] as const;

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  // Highlight the clicked item immediately, before the page arrives.
  const [clicked, setClicked] = useState<string | null>(null);
  useEffect(() => setClicked(null), [pathname]);
  const current = clicked ?? pathname;
  // Load the whole page while the pointer is on the link, so the click itself is instant.
  const warm = (href: string) => router.prefetch(href, { kind: PrefetchKind.FULL });
  return (
    <nav className="grid gap-0.5">
      {NAV.map((item) => {
        const active = current === item.href || current.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onMouseEnter={() => warm(item.href)}
            onFocus={() => warm(item.href)}
            onTouchStart={() => warm(item.href)}
            onClick={() => setClicked(item.href)}
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

