import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { Pagination } from "@/components/pagination";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { removeSuppression } from "./actions";
import { AddSuppressionForm } from "./add-form";
import { SuppressionUploadForm } from "./upload-form";
import { Time } from "@/components/time";
import { StatusBadge } from "@/components/status-badge";
import { formatNumber } from "@/lib/format";

export const metadata = { title: "Do-not-email list" };

const PAGE_SIZE = 50;

export default async function SuppressionPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q: rawQ, page: rawPage } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);
  const { org, role } = await getOrgContext();
  const supabase = await createClient();
  const q = (rawQ ?? "").replace(/[,()*%\\"]/g, "").trim().toLowerCase().slice(0, 100);

  let query = supabase
    .from("suppression_list")
    .select("id, email, reason, source, created_at", { count: "exact" })
    .eq("org_id", org.id);
  if (q) query = query.ilike("email", `%${q}%`);
  const { data: rows, count } = await query.order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const canRemove = can(role, "suppression.remove");

  return (
    <>
      <PageHeader
        title="Do-not-email list"
        description="People on this list are never emailed (it's also called a suppression list). We check it when you import leads and again before every send. Anyone who unsubscribes or whose email bounces is added automatically."
      />
      <div className="grid gap-6">
        {can(role, "suppression.add") && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add addresses</CardTitle>
              <CardDescription>Upload a CSV or Excel file, or paste emails separated by new lines, commas or spaces.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                <SuppressionUploadForm />
                <AddSuppressionForm />
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{formatNumber(count)} on the list</CardTitle>
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
                    <TableHead>Added</TableHead>
                    {canRemove && (
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.email}</TableCell>
                      <TableCell>
                        <StatusBadge kind="suppression" value={r.reason} title={r.source ? `Source: ${r.source}` : undefined} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs"><Time value={r.created_at} /></TableCell>
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
            <Pagination
              className="mt-4"
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              href={(p) => `/suppression?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
