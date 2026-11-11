import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { icon: Info, className: "bg-info-subtle text-info" },
  warning: { icon: AlertTriangle, className: "bg-warning-subtle text-warning" },
  danger: { icon: OctagonAlert, className: "bg-destructive/10 text-destructive" },
} as const;

/** A full-width notice under the top bar (billing, sending paused). */
export function Banner({
  tone = "info",
  action,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { tone?: keyof typeof TONES; action?: React.ReactNode }) {
  const { icon: Icon, className: toneClass } = TONES[tone];
  return (
    <div role="status" className={cn("flex items-start gap-2.5 border-b px-4 py-2.5 text-sm sm:px-6", toneClass, className)} {...props}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span>{children}</span>
        {action && <span className="font-medium underline underline-offset-4">{action}</span>}
      </div>
    </div>
  );
}
