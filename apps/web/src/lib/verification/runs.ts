import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type VerificationTarget = { leadIds: string[] } | { importId: string } | { allUnverified: true };

/**
 * Creates a verification run and claims its leads (marks them pending).
 * Returns null when nothing needed verifying. The caller sends the event.
 */
export async function createVerificationRun(
  orgId: string,
  target: VerificationTarget,
  meta: { source: "manual" | "import" | "agent"; requestedBy?: string | null },
): Promise<{ runId: string; total: number } | null> {
  const admin = createAdminClient();

  // Idempotent for imports: a retried job step must not orphan a run it already created.
  if ("importId" in target) {
    const { data: existing } = await admin
      .from("verification_runs")
      .select("id, total")
      .eq("org_id", orgId)
      .eq("import_id", target.importId)
      .eq("status", "queued")
      .maybeSingle();
    if (existing) return { runId: existing.id, total: existing.total };
  }

  const { data: run, error } = await admin
    .from("verification_runs")
    .insert({
      org_id: orgId,
      source: meta.source,
      requested_by: meta.requestedBy ?? null,
      import_id: "importId" in target ? target.importId : null,
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(`Could not create verification run: ${error?.message}`);

  const { data: total, error: claimError } = await admin.rpc("claim_leads_for_verification", {
    p_org_id: orgId,
    p_run_id: run.id,
    ...("leadIds" in target ? { p_lead_ids: target.leadIds } : {}),
    ...("importId" in target ? { p_import_id: target.importId } : {}),
    ...("allUnverified" in target ? { p_all_unverified: true } : {}),
  });
  if (claimError) throw new Error(`Could not claim leads: ${claimError.message}`);

  if (!total) {
    await admin.from("verification_runs").delete().eq("org_id", orgId).eq("id", run.id);
    return null;
  }
  return { runId: run.id, total };
}
