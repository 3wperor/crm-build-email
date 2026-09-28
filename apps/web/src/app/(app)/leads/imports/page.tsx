import Link from "next/link";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImportStatusBadge } from "./status-badge";

export const metadata = { title: "Import history" };

export default async function ImportsPage() {
  const { org } = await getOrgContext();
  const supabase = await createClient();
  const { data: imports } = await supabase
    .from("imports")
    .select("id, filename, status, total_rows, imported_count, existing_count, suppressed_count, invalid_count, duplicate_count, created_at, lead_lists(name)")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader
        title="Import history"
        actions={
          <Link href="/leads/import" className="text-sm underline underline-offset-4">
            New import
          </Link>
        }
      />
      <Card>
        <CardContent>
          {!imports?.length ? (
            <p className="text-muted-foreground text-sm">No imports yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>List</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link href={`/leads/imports/${i.id}`} className="font-medium hover:underline">
                        {i.filename}
                      </Link>
                    </TableCell>
                    <TableCell>{i.lead_lists?.name ?? "—"}</TableCell>
                    <TableCell>
                      <ImportStatusBadge status={i.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.total_rows.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.imported_count.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(i.existing_count + i.suppressed_count + i.invalid_count + i.duplicate_count).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{new Date(i.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
