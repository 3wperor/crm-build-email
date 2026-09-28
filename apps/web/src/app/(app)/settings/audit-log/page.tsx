import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Audit log" };

export default async function AuditLogPage() {
  const { org } = await getOrgContext();
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("agent_audit_log")
    .select("id, actor, actor_type, action, target, result, created_at")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <>
      <PageHeader title="Audit log" description="Every agent action, plus kill-switch changes. Most recent 200." />
      <Card>
        <CardContent>
          {error && <p className="text-destructive text-sm">{error.message}</p>}
          {rows && rows.length === 0 && <p className="text-muted-foreground text-sm">No entries yet.</p>}
          {rows && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.actor_type}</Badge> <span className="font-mono text-xs">{r.actor}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.action}</TableCell>
                    <TableCell className="font-mono text-xs">{r.target ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={r.result === "ok" ? "success" : r.result === "denied" ? "destructive" : "warning"}>
                        {r.result}
                      </Badge>
                    </TableCell>
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
