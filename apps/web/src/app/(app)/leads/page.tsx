import Link from "next/link";
import { Upload } from "lucide-react";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { Card, CardContent } from "@/components/ui/card";
import { AddLeadForm } from "./add-lead-form";
import { LeadsTable, type LeadRow } from "./leads-table";

export const metadata = { title: "Leads" };

const PAGE_SIZE = 50;
const STATUSES = ["new", "in_sequence", "replied", "bounced", "unsubscribed", "do_not_contact"];
const VERIFICATIONS = ["unverified", "pending", "valid", "risky", "invalid", "unknown"];
const UUID = /^[0-9a-f-]{36}$/i;

type Search = { q?: string; status?: string; verification?: string; list?: string; import?: string; page?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { org, role } = await getOrgContext();
  const supabase = await createClient();
  const canWrite = can(role, "leads.write");

  const page = Math.max(1, Number(sp.page) || 1);
  // Strip characters that are meaningful in PostgREST filter syntax.
  const q = (sp.q ?? "").replace(/[,()*%\\"]/g, " ").trim().slice(0, 100);
  const listId = sp.list && UUID.test(sp.list) ? sp.list : null;

  const columns = "id, email, first_name, last_name, company, title, status, verification_status, created_at";
  let query = supabase
    .from("leads")
    .select(listId ? `${columns}, lead_list_members!inner(list_id)` : columns, { count: "exact" })
    .eq("org_id", org.id);
  if (listId) query = query.eq("lead_list_members.list_id", listId);
  if (q) query = query.or(`email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,company.ilike.%${q}%`);
  if (sp.status && STATUSES.includes(sp.status)) query = query.eq("status", sp.status);
  if (sp.verification && VERIFICATIONS.includes(sp.verification)) query = query.eq("verification_status", sp.verification);
  if (sp.import && UUID.test(sp.import)) query = query.eq("import_id", sp.import);

  const [{ data, count, error }, { data: lists }] = await Promise.all([
    query.order("created_at", { ascending: false }).order("email").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from("lead_lists").select("id, name").eq("org_id", org.id).order("name"),
  ]);
  const rows = (data ?? []) as unknown as LeadRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (p: number) => {
    const params = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);
    params.set("page", String(p));
    return `/leads?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Leads"
        description={`${total.toLocaleString()} lead${total === 1 ? "" : "s"}`}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/leads/imports">Import history</Link>
            </Button>
            {canWrite && (
              <Button asChild>
                <Link href="/leads/import">
                  <Upload /> Import CSV
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4">
        {canWrite && (
          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">Add a single lead</summary>
            <div className="pt-3">
              <AddLeadForm />
            </div>
          </details>
        )}

        <form className="flex flex-wrap gap-2" role="search">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search email, name, company" className="max-w-xs" aria-label="Search" />
          <NativeSelect name="status" defaultValue={sp.status ?? ""} className="w-auto" aria-label="Status">
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="verification" defaultValue={sp.verification ?? ""} className="w-auto" aria-label="Verification">
            <option value="">Any verification</option>
            {VERIFICATIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="list" defaultValue={listId ?? ""} className="w-auto" aria-label="List">
            <option value="">All lists</option>
            {(lists ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
          <Button variant="outline" type="submit">
            Filter
          </Button>
          {(sp.q || sp.status || sp.verification || sp.list || sp.import) && (
            <Button variant="ghost" asChild>
              <Link href="/leads">Clear</Link>
            </Button>
          )}
        </form>

        <Card>
          <CardContent>
            {error && <p className="text-destructive text-sm">{error.message}</p>}
            {rows.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {total === 0 && !q && !sp.status && !sp.verification && !listId ? "No leads yet — import a CSV to get started." : "No leads match these filters."}
              </p>
            ) : (
              <LeadsTable rows={rows} lists={lists ?? []} canWrite={canWrite} />
            )}
          </CardContent>
        </Card>

        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <Button variant="outline" size="sm" asChild disabled={page <= 1}>
              <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1}>
                Previous
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={pageHref(Math.min(pages, page + 1))} aria-disabled={page >= pages}>
                Next
              </Link>
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
