import { Badge } from "@/components/ui/badge";
import { statusInfo, type StatusKind } from "@/lib/labels";

/** A status shown as a friendly word in the colour that matches its meaning. */
export function StatusBadge({
  kind,
  value,
  ...props
}: { kind: StatusKind; value: string | null | undefined } & Omit<React.ComponentProps<typeof Badge>, "variant" | "children">) {
  const { label, tone } = statusInfo(kind, value);
  return (
    <Badge variant={tone} data-status={value ?? undefined} {...props}>
      {label}
    </Badge>
  );
}
