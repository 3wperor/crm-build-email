import { StatusBadge } from "@/components/status-badge";

export function HealthBadge({ health }: { health: string }) {
  return <StatusBadge kind="health" value={health} />;
}

const PROVIDER_LABELS: Record<string, string> = { google: "Google", smtp: "SMTP", outlook: "Outlook" };

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
