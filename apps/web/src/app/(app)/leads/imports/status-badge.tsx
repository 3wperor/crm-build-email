import { StatusBadge } from "@/components/status-badge";

export function ImportStatusBadge({ status }: { status: string }) {
  return <StatusBadge kind="import" value={status} />;
}
