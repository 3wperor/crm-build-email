import Link from "next/link";
import { cn } from "@/lib/utils";

export type LinkTab = { href: string; label: React.ReactNode; active: boolean; count?: number };

/** Tabs that are links (each tab is its own URL). Scrolls sideways on narrow screens. */
export function LinkTabs({ items, label, className }: { items: LinkTab[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("mb-6 border-b", className)}>
      <div className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm whitespace-nowrap outline-none focus-visible:ring-[3px]",
              t.active ? "border-primary text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:border-border border-transparent",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn("rounded-full px-1.5 text-[11px] leading-5 tabular-nums", t.active ? "bg-accent text-accent-foreground" : "bg-muted")}>
                {t.count}
              </span>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
