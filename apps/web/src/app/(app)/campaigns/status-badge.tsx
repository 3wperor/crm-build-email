import { StatusBadge } from "@/components/status-badge";

export function CampaignStatusBadge({ status }: { status: string }) {
  return <StatusBadge kind="campaign" value={status} data-testid="campaign-status" />;
}
