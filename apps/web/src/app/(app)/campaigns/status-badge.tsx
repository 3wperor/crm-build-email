import { Badge } from "@/components/ui/badge";

const VARIANT = { draft: "outline", active: "success", paused: "warning", completed: "secondary", archived: "secondary" } as const;

export function CampaignStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={VARIANT[status as keyof typeof VARIANT] ?? "outline"} className="capitalize" data-testid="campaign-status">
      {status}
    </Badge>
  );
}
