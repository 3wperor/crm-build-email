import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** What a list shows before it has anything in it: an icon, one line of explanation and one thing to do. */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  icon: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn("bg-card flex flex-col items-center rounded-lg border px-6 py-12 text-center", className)}
      {...props}
    >
      <div aria-hidden="true" className="bg-accent text-primary mb-4 flex size-11 items-center justify-center rounded-full">
        <Icon className="size-5" />
      </div>
      <h2 className="text-section-title">{title}</h2>
      {description && <p className="text-muted-foreground mt-1 max-w-md text-sm text-balance">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
