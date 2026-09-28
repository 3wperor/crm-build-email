import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/coming-soon";
import { Card, CardContent } from "@/components/ui/card";
import { AddStageForm, StageRow } from "./stage-forms";

export const metadata = { title: "Pipeline stages" };

export default async function StagesPage() {
  const { org, role } = await getOrgContext();
  if (!can(role, "pipeline_stages.manage")) redirect("/pipeline");
  const supabase = await createClient();
  const [{ data: stages }, { data: opps }] = await Promise.all([
    supabase.from("pipeline_stages").select("id, name, kind, is_entry").eq("org_id", org.id).order("position"),
    supabase.from("opportunities").select("stage_id").eq("org_id", org.id),
  ]);
  const counts = new Map<string, number>();
  for (const o of opps ?? []) counts.set(o.stage_id, (counts.get(o.stage_id) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Pipeline stages"
        description="Rename, reorder and add stages. Won/Lost stages mark the outcome; replies land in the entry stage (negative replies go to the first Lost stage)."
        actions={
          <Link href="/pipeline" className="text-sm underline underline-offset-4">
            Back to pipeline
          </Link>
        }
      />
      <Card>
        <CardContent className="grid gap-2">
          {(stages ?? []).map((s, i) => (
            <StageRow key={s.id} stage={{ ...s, cards: counts.get(s.id) ?? 0 }} first={i === 0} last={i === (stages?.length ?? 0) - 1} />
          ))}
          <div className="pt-2">
            <AddStageForm />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
