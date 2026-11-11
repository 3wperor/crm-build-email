import { Badge } from "@/components/ui/badge";
import { statusInfo } from "@/lib/labels";

/** A traffic light plus a word, so the state never depends on colour alone. */
export function HealthBadge({ health }: { health: string }) {
  const { label, tone } = statusInfo("health", health);
  return (
    <Badge variant={tone} data-status={health}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}

const PROVIDER_LABELS: Record<string, string> = { google: "Google", smtp: "SMTP", outlook: "Outlook" };

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
