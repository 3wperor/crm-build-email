import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import leads" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const { campaign: campaignId } = await searchParams;
  const { org, role } = await getOrgContext();
  if (!can(role, "leads.write")) redirect("/leads");
  const supabase = await createClient();
  const [{ data: lists }, { data: campaign }] = await Promise.all([
    supabase.from("lead_lists").select("id, name").eq("org_id", org.id).order("name"),
    campaignId && /^[0-9a-f-]{36}$/i.test(campaignId)
      ? supabase.from("campaigns").select("id, name").eq("org_id", org.id).eq("id", campaignId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <>
      <PageHeader
        title={campaign ? `Import leads into ${campaign.name}` : "Import leads"}
        description="Rows are de-duplicated within the file, against existing leads and against your suppression list."
        actions={
          <Link href="/leads/imports" className="text-sm underline underline-offset-4">
            Import history
          </Link>
        }
      />
      <ImportWizard lists={lists ?? []} campaign={campaign} />
    </>
  );
}
