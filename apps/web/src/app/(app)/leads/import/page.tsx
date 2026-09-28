import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import leads" };

export default async function ImportPage() {
  const { org, role } = await getOrgContext();
  if (!can(role, "leads.write")) redirect("/leads");
  const supabase = await createClient();
  const { data: lists } = await supabase.from("lead_lists").select("id, name").eq("org_id", org.id).order("name");

  return (
    <>
      <PageHeader
        title="Import leads"
        description="Rows are de-duplicated within the file, against existing leads and against your suppression list."
        actions={
          <Link href="/leads/imports" className="text-sm underline underline-offset-4">
            Import history
          </Link>
        }
      />
      <ImportWizard lists={lists ?? []} />
    </>
  );
}
