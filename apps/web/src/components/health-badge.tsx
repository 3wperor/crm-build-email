import { Badge } from "@/components/ui/badge";

const VARIANT = {
  healthy: "success",
  degraded: "warning",
  failing: "destructive",
  unknown: "outline",
} as const;

export function HealthBadge({ health }: { health: string }) {
  const variant = VARIANT[health as keyof typeof VARIANT] ?? "outline";
  return (
    <Badge variant={variant} className="capitalize">
      {health}
    </Badge>
  );
}

const PROVIDER_LABELS: Record<string, string> = { google: "Google", smtp: "SMTP", outlook: "Outlook" };

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
