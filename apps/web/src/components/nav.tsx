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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: LucideIcon; badge?: string };

const GROUPS: { label?: string; items: Item[] }[] = [
  { items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Outreach",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: Send },
      { href: "/leads", label: "Leads", icon: Users },
      { href: "/inboxes", label: "Inboxes", icon: Mail },
    ],
  },
  {
    label: "Conversations",
    items: [
      { href: "/replies", label: "Replies", icon: MessageSquareReply },
      { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
    ],
  },
  { label: "Insights", items: [{ href: "/analytics", label: "Analytics", icon: BarChart3 }] },
  {
    label: "Deliverability",
    items: [
      { href: "/warmup", label: "Warmup", icon: Flame, badge: "Beta" },
      { href: "/suppression", label: "Do-not-email list", icon: Ban },
    ],
  },
];

const PINNED: Item[] = [
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

/**
 * The sidebar links. counts: small number badges, e.g. { "/replies": 3 } replies
 * waiting for an answer. Renders the grouped links, then Settings and Docs
 * pushed to the bottom of whatever flex column it sits in.
 */
export function Nav({ counts = {} }: { counts?: Record<string, number> }) {
  const pathname = usePathname();
  const router = useRouter();
  // Highlight the clicked item immediately, before the page arrives.
  const [clicked, setClicked] = useState<string | null>(null);
  useEffect(() => setClicked(null), [pathname]);
  const current = clicked ?? pathname;
  // Load the whole page while the pointer is on the link, so the click itself is instant.
  const warm = (href: string) => router.prefetch(href, { kind: PrefetchKind.FULL });

  const link = (item: Item) => {
    const active = current === item.href || current.startsWith(`${item.href}/`);
    const Icon = item.icon;
    const count = counts[item.href];
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onMouseEnter={() => warm(item.href)}
        onFocus={() => warm(item.href)}
        onTouchStart={() => warm(item.href)}
        onClick={() => setClicked(item.href)}
        className={cn(
          "group text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground focus-visible:ring-ring/50 flex h-8 items-center gap-2.5 rounded-md px-2 text-sm outline-none focus-visible:ring-[3px]",
          active && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground font-medium",
        )}
      >
        <Icon className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-sidebar-foreground")} />
        <span className="flex-1 truncate">{item.label}</span>
        {!!count && (
          <span className="bg-primary text-primary-foreground min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums" aria-label={`${count} waiting`}>
            {count > 99 ? "99+" : count}
          </span>
        )}
        {item.badge && <span className="text-muted-foreground rounded border px-1 text-[10px] leading-4 font-medium">{item.badge}</span>}
      </Link>
    );
  };

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 py-0.5">
        {GROUPS.map((group, i) => (
          <div key={group.label ?? i} role="group" aria-label={group.label} className="grid gap-0.5">
            {group.label && <div className="text-muted-foreground text-caption px-2 pb-1 font-medium">{group.label}</div>}
            {group.items.map(link)}
          </div>
        ))}
      </div>
      <div className="grid gap-0.5">{PINNED.map(link)}</div>
    </nav>
  );
}
