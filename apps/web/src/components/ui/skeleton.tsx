import { cn } from "@/lib/utils";

/** A grey placeholder the shape of the content that's loading. Use inside <Suspense fallback>. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn("bg-muted rounded-md motion-safe:animate-pulse", className)} {...props} />;
}

function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-3">
      <Skeleton className="h-4 w-full opacity-60" />
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-5" />
          ))}
        </div>
      ))}
    </div>
  );
}

function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="grid gap-3 rounded-lg border p-5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

function ThreadSkeleton({ messages = 3 }: { messages?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-4">
      {Array.from({ length: messages }, (_, i) => (
        <div key={i} className="grid gap-2 rounded-lg border p-4">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export { Skeleton, TableSkeleton, StatCardsSkeleton, ThreadSkeleton };
