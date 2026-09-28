import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { removeSuppression } from "./actions";
import { AddSuppressionForm } from "./add-form";

export const metadata = { title: "Suppression list" };

const REASON_VARIANT = { unsubscribe: "warning", hard_bounce: "destructive", complaint: "destructive", manual: "secondary" } as const;

export default async function SuppressionPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: rawQ } = await searchParams;
  const { org, role } = await getOrgContext();
  const supabase = await createClient();
  const q = (rawQ ?? "").replace(/[,()*%\\"]/g, "").trim().toLowerCase().slice(0, 100);

  let query = supabase
    .from("suppression_list")
    .select("id, email, reason, source, created_at", { count: "exact" })
    .eq("org_id", org.id);
  if (q) query = query.ilike("email", `%${q}%`);
  const { data: rows, count } = await query.order("created_at", { ascending: false }).limit(200);

  const canRemove = can(role, "suppression.remove");

  return (
    <>
      <PageHeader
        title="Suppression list"
        description="These addresses are never emailed — checked on import and again at send time. Unsubscribes and hard bounces are added automatically."
      />
      <div className="grid gap-6">
        {can(role, "suppression.add") && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add addresses</CardTitle>
              <CardDescription>Paste one or more emails, separated by new lines, commas or spaces.</CardDescription>
            </CardHeader>
            <CardContent>
              <AddSuppressionForm />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{(count ?? 0).toLocaleString()} suppressed</CardTitle>
            <form className="flex max-w-sm gap-2" role="search">
              <Input name="q" defaultValue={rawQ ?? ""} placeholder="Search email" aria-label="Search suppression list" />
              <Button variant="outline" type="submit">
                Search
              </Button>
            </form>
          </CardHeader>
          <CardContent>
            {!rows?.length ? (
              <p className="text-muted-foreground text-sm">Nothing here.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Added</TableHead>
                    {canRemove && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.email}</TableCell>
                      <TableCell>
                        <Badge variant={REASON_VARIANT[r.reason as keyof typeof REASON_VARIANT] ?? "outline"}>
                          {r.reason.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{r.source ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                      {canRemove && (
                        <TableCell className="text-right">
                          <form action={removeSuppression}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button variant="ghost" size="sm" aria-label={`Remove ${r.email}`}>
                              Remove
                            </Button>
                          </form>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
