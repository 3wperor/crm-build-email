import { cn } from "@/lib/utils";

/**
 * The YCAReach mark: a "Y" whose right arm is an arrow reaching up and out. Drawn on a 32px grid so it stays crisp as a 16px favicon;
 * `app/icon.svg` is the same drawing with fixed colours.
 */
export function LogoMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6 shrink-0", className)} {...props}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <g className="stroke-primary-foreground" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 9.5 15.5 17.5V24" />
        <path d="M15.5 17.5 23 8.5" />
        <path d="M17.2 8.5H23v5.8" />
      </g>
    </svg>
  );
}

const SIZES = {
  sm: { mark: "size-5", text: "text-sm", gap: "gap-1.5" },
  md: { mark: "size-6", text: "text-base", gap: "gap-2" },
  lg: { mark: "size-8", text: "text-xl", gap: "gap-2.5" },
} as const;

/** Mark plus wordmark. `iconOnly` keeps the name for screen readers. */
export function Logo({
  size = "md",
  iconOnly = false,
  className,
}: {
  size?: keyof typeof SIZES;
  iconOnly?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      <LogoMark className={s.mark} />
      {iconOnly ? (
        <span className="sr-only">YCAReach</span>
      ) : (
        <span className={cn("leading-none font-semibold tracking-tight", s.text)}>
          YCA<span className="text-primary">Reach</span>
        </span>
      )}
    </span>
  );
}
