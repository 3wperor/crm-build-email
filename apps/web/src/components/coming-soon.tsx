import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function ComingSoon({ phase, what }: { phase: number; what: string }) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base">Arrives in Phase {phase}</CardTitle>
        <CardDescription>{what}</CardDescription>
      </CardHeader>
    </Card>
  );
}
