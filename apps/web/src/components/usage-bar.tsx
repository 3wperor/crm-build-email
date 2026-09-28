import { cn } from "@/lib/utils";

export function UsageBar({ used, cap, className }: { used: number; cap: number; className?: string }) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return (
    <div className={cn("grid min-w-28 gap-1", className)}>
      <div className="text-xs tabular-nums">
        <span className="font-medium">{used}</span>
        <span className="text-muted-foreground"> / {cap}</span>
      </div>
      <div
        className="bg-muted h-1.5 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={cap}
      >
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-amber-500" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
