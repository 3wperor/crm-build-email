import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * One form row, laid out the same everywhere: label, the control, then a hint
 * or (when there is one) the error in its place.
 */
function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | string[];
  className?: string;
  children: React.ReactNode;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div data-slot="field" className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {message ? (
        <p role="alert" className="text-destructive text-caption">
          {message}
        </p>
      ) : (
        hint && <p className="text-muted-foreground text-caption">{hint}</p>
      )}
    </div>
  );
}

export { Field };
