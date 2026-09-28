import { Badge } from "@/components/ui/badge";

const VARIANTS = { pending: "outline", processing: "warning", completed: "success", failed: "destructive" } as const;

export function ImportStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={VARIANTS[status as keyof typeof VARIANTS] ?? "outline"} className="capitalize">
      {status}
    </Badge>
  );
}
