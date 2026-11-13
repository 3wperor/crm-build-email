import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Showing 1–50 of 1,240" with Previous / Next. Renders nothing when everything fits on one page. */
export function Pagination({
  page,
  pageSize,
  total,
  href,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** The link for a given page number, keeping any filters. */
  href: (page: number) => string;
  className?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const link = (target: number, enabled: boolean, label: string, children: React.ReactNode) =>
    enabled ? (
      <Link href={href(target)} aria-label={label} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {children}
      </Link>
    ) : (
      <span aria-disabled="true" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  return (
    <nav aria-label="Pages" className={cn("flex flex-wrap items-center justify-between gap-3 text-sm", className)}>
      <p className="text-muted-foreground tabular-nums" data-testid="pagination-summary">
        Showing {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </p>
      <div className="flex gap-2">
        {link(page - 1, page > 1, "Previous page", <><ChevronLeft /> Previous</>)}
        {link(page + 1, page < pages, "Next page", <>Next <ChevronRight /></>)}
      </div>
    </nav>
  );
}
