import "server-only";
import { IMPORT_CHUNK_SIZE, chunk, type PreparedLead } from "@crm/core/imports";
import { createAdminClient } from "@/lib/supabase/admin";
import { createVerificationRun } from "@/lib/verification/runs";
import { enrollImportIntoCampaign } from "@/lib/imports/campaign";
import { inngest } from "@/inngest/client";
import { leadVerificationRequested } from "@/inngest/events";

export type DirectImportResult = {
  importId: string;
  listId: string | null;
  imported: number;
  alreadyExisted: number;
  suppressed: number;
  verificationQueued: number;
};

/**
 * Imports already-parsed leads without a file upload (pasted text, the AI
 * agent). Same rules as CSV imports: dedupe, suppression, list membership,
 * auto-verify, and enrollment into a campaign once verified.
 */
export async function importLeadsDirect(
  orgId: string,
  leads: PreparedLead[],
  opts: { label: string; totalRows: number; invalid: number; duplicates: number; listId?: string | null; listName?: string | null; campaignId?: string | null; createdBy?: string | null; source: "manual" | "agent" },
): Promise<DirectImportResult> {
  const admin = createAdminClient();
  let listId = opts.listId ?? null;
  if (!listId && opts.listName) {
    const { data: existing } = await admin.from("lead_lists").select("id").eq("org_id", orgId).eq("name", opts.listName).maybeSingle();
    listId = existing?.id ?? (await admin.from("lead_lists").insert({ org_id: orgId, name: opts.listName }).select("id").single()).data?.id ?? null;
  }
  const { data: imp, error } = await admin
    .from("imports")
    .insert({ org_id: orgId, list_id: listId, filename: opts.label, status: "processing", total_rows: opts.totalRows, campaign_id: opts.campaignId ?? null, created_by: opts.createdBy ?? null })
    .select("id")
    .single();
  if (error || !imp) throw new Error(error?.message ?? "Could not start the import");

  let imported = 0;
  let existing = 0;
  let suppressed = 0;
  for (const rows of chunk(leads, IMPORT_CHUNK_SIZE)) {
    const { data, error: chunkError } = await admin.rpc("import_leads_chunk", {
      p_org_id: orgId,
      p_import_id: imp.id,
      p_mode: "skip",
      p_rows: rows as never,
      ...(listId ? { p_list_id: listId } : {}),
    });
    if (chunkError) {
      await admin.from("imports").update({ status: "failed", error: chunkError.message }).eq("id", imp.id);
      throw new Error(chunkError.message);
    }
    const r = (data ?? {}) as { imported_rows?: number[]; existing_rows?: number[]; suppressed_rows?: number[] };
    imported += r.imported_rows?.length ?? 0;
    existing += r.existing_rows?.length ?? 0;
    suppressed += r.suppressed_rows?.length ?? 0;
  }
  await admin
    .from("imports")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      processed_rows: opts.totalRows,
      imported_count: imported,
      existing_count: existing,
      suppressed_count: suppressed,
      invalid_count: opts.invalid,
      duplicate_count: opts.duplicates,
    })
    .eq("id", imp.id);

  const { data: org } = await admin.from("organizations").select("auto_verify_imports").eq("id", orgId).single();
  const run = org?.auto_verify_imports && imported > 0 ? await createVerificationRun(orgId, { importId: imp.id }, { source: opts.source }) : null;
  if (run) await inngest.send(leadVerificationRequested.create({ orgId, runId: run.runId }, { id: `verify-${run.runId}` }));
  // Nothing to verify: enroll now (otherwise verify-leads does it when it finishes).
  else await enrollImportIntoCampaign(orgId, imp.id);

  return { importId: imp.id, listId, imported, alreadyExisted: existing, suppressed, verificationQueued: run?.total ?? 0 };
}
