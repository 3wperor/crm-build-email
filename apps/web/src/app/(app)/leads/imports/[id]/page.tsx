import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { UsageBar } from "@/components/usage-bar";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportStatusBadge } from "../status-badge";
import { AutoRefresh } from "./auto-refresh";

export const metadata = { title: "Import" };

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await getOrgContext();
  const supabase = await createClient();
  const { data: imp } = await supabase
    .from("imports")
    .select("*, lead_lists(id, name)")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (!imp) notFound();

  const running = imp.status === "pending" || imp.status === "processing";
  const options = imp.options as { mode?: string };
  const stats = [
    { label: "Imported", value: imp.imported_count, testid: "imported" },
    {
      label: options.mode === "fill" ? "Existing (blanks filled)" : "Already existed (skipped)",
      value: imp.existing_count,
      testid: "existing",
    },
    { label: "Suppressed", value: imp.suppressed_count, testid: "suppressed" },
    { label: "Invalid", value: imp.invalid_count, testid: "invalid" },
    { label: "Duplicates in file", value: imp.duplicate_count, testid: "duplicates" },
  ];

  return (
    <>
      <AutoRefresh active={running} />
      <PageHeader
        title={imp.filename}
        description={imp.lead_lists ? `List: ${imp.lead_lists.name}` : undefined}
        actions={
          <Link href="/leads/imports" className="text-sm underline underline-offset-4">
            Import history
          </Link>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Status <ImportStatusBadge status={imp.status} />
          </CardTitle>
          <CardDescription>
            {running
              ? "Processing in the background — you can leave this page."
              : imp.completed_at
                ? `Finished ${new Date(imp.completed_at).toLocaleString()}`
                : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {running && <UsageBar used={imp.processed_rows} cap={Math.max(imp.total_rows, 1)} className="max-w-md" />}
          {imp.status === "failed" && (
            <Alert variant="destructive">
              <AlertDescription>{imp.error ?? "Import failed."}</AlertDescription>
            </Alert>
          )}
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-muted-foreground text-xs">{s.label}</dt>
                <dd className="text-2xl font-semibold tabular-nums" data-testid={`count-${s.testid}`}>
                  {s.value.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            {imp.error_report_path && (
              <Button asChild variant="outline">
                <a href={`/leads/imports/${imp.id}/errors`}>
                  <Download /> Download skipped rows (CSV)
                </a>
              </Button>
            )}
            {imp.status === "completed" && (
              <Button asChild variant="outline">
                <Link href={imp.lead_lists ? `/leads?list=${imp.lead_lists.id}` : `/leads`}>View leads</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
