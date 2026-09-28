import { NonRetriableError } from "inngest";
import {
  IMPORT_CHUNK_SIZE,
  buildErrorCsv,
  parseCsv,
  prepareRows,
  validateMapping,
  type ColumnMapping,
  type ImportMode,
  type Rejection,
} from "@crm/core/imports";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadText, importErrorsPath, importFilePath, uploadText } from "@/lib/imports/storage";
import { createVerificationRun } from "@/lib/verification/runs";
import { inngest } from "../client";
import { leadImportRequested, leadVerificationRequested } from "../events";

type ChunkResult = { imported_rows: number[]; existing_rows: number[]; suppressed_rows: number[] };

async function loadImport(orgId: string, importId: string) {
  const { data, error } = await createAdminClient()
    .from("imports")
    .select("id, org_id, list_id, status, column_mapping, options, storage_path")
    .eq("org_id", orgId)
    .eq("id", importId)
    .single();
  if (error || !data) throw new NonRetriableError(`Import ${importId} not found`);
  return data;
}

/**
 * Re-derives the prepared rows from the stored file. Deterministic, so every
 * step (including retries) sees exactly the same rows in the same order — we
 * never pass large payloads between steps.
 */
async function prepare(orgId: string, importId: string, mapping: ColumnMapping) {
  const parsed = parseCsv(await downloadText(importFilePath(orgId, importId)));
  const mappingError = validateMapping(mapping, parsed.headers.length);
  if (mappingError) throw new NonRetriableError(mappingError);
  return { parsed, prepared: prepareRows(parsed.rows, mapping) };
}

async function markFailed(orgId: string, importId: string, message: string) {
  await createAdminClient()
    .from("imports")
    .update({ status: "failed", error: message.slice(0, 500), completed_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", importId);
}

export const processLeadImport = inngest.createFunction(
  {
    id: "process-lead-import",
    triggers: [leadImportRequested],
    retries: 3,
    // One import at a time per org keeps DB load predictable and dedupe simple.
    concurrency: [{ key: "event.data.orgId", limit: 1 }],
    onFailure: async ({ event, error }) => {
      const { orgId, importId } = event.data.event.data as { orgId: string; importId: string };
      await markFailed(orgId, importId, error.message);
    },
  },
  async ({ event, step }) => {
    const { orgId, importId } = event.data;

    const start = await step.run("start", async () => {
      const imp = await loadImport(orgId, importId);
      if (imp.status === "completed") return null;
      const mapping = imp.column_mapping as ColumnMapping;
      const { prepared } = await prepare(orgId, importId, mapping);
      await createAdminClient()
        .from("imports")
        .update({ status: "processing", total_rows: prepared.totalRows, processed_rows: prepared.rejected.length, error: null })
        .eq("org_id", orgId)
        .eq("id", importId);
      return {
        mapping,
        listId: imp.list_id,
        mode: ((imp.options as { mode?: ImportMode })?.mode ?? "skip") as ImportMode,
        chunks: Math.ceil(prepared.leads.length / IMPORT_CHUNK_SIZE),
      };
    });
    if (!start) return { skipped: "already completed" };

    const results: ChunkResult[] = [];
    for (let i = 0; i < start.chunks; i++) {
      const result = await step.run(`chunk-${i}`, async () => {
        const { prepared } = await prepare(orgId, importId, start.mapping);
        const rows = prepared.leads.slice(i * IMPORT_CHUNK_SIZE, (i + 1) * IMPORT_CHUNK_SIZE);
        const admin = createAdminClient();
        const { data, error } = await admin.rpc("import_leads_chunk", {
          p_org_id: orgId,
          p_import_id: importId,
          p_mode: start.mode,
          p_rows: rows,
          ...(start.listId ? { p_list_id: start.listId } : {}),
        });
        if (error) throw new Error(`Chunk ${i} failed: ${error.message}`);
        await admin
          .from("imports")
          .update({ processed_rows: prepared.rejected.length + Math.min(prepared.leads.length, (i + 1) * IMPORT_CHUNK_SIZE) })
          .eq("org_id", orgId)
          .eq("id", importId);
        return data as ChunkResult;
      });
      results.push(result);
    }

    const counts = await step.run("finish", async () => {
      const { parsed, prepared } = await prepare(orgId, importId, start.mapping);
      const suppressed = results.flatMap((r) => r.suppressed_rows);
      const existing = results.flatMap((r) => r.existing_rows);
      const imported = results.reduce((n, r) => n + r.imported_rows.length, 0);

      const rejections: Rejection[] = [
        ...prepared.rejected,
        ...suppressed.map((row) => ({ row, reason: "suppressed" as const })),
        // In "fill" mode existing leads were updated, which is not an error.
        ...(start.mode === "skip" ? existing.map((row) => ({ row, reason: "already_exists" as const })) : []),
      ];

      let errorReportPath: string | null = null;
      if (rejections.length > 0) {
        errorReportPath = importErrorsPath(orgId, importId);
        await uploadText(errorReportPath, buildErrorCsv(parsed, rejections));
      }

      const counts = {
        imported_count: imported,
        existing_count: existing.length,
        updated_count: start.mode === "fill" ? existing.length : 0,
        suppressed_count: suppressed.length,
        invalid_count: prepared.rejected.filter((r) => r.reason !== "duplicate_in_file").length,
        duplicate_count: prepared.rejected.filter((r) => r.reason === "duplicate_in_file").length,
      };
      const { error } = await createAdminClient()
        .from("imports")
        .update({
          ...counts,
          status: "completed",
          processed_rows: prepared.totalRows,
          error_report_path: errorReportPath,
          completed_at: new Date().toISOString(),
        })
        .eq("org_id", orgId)
        .eq("id", importId);
      if (error) throw new Error(error.message);
      return counts;
    });

    // Auto-verify newly imported leads (org setting, on by default).
    const run = await step.run("queue-verification", async () => {
      if (counts.imported_count === 0) return null;
      const { data: org } = await createAdminClient().from("organizations").select("auto_verify_imports").eq("id", orgId).single();
      if (!org?.auto_verify_imports) return null;
      return createVerificationRun(orgId, { importId }, { source: "import" });
    });
    if (run) {
      await step.sendEvent("request-verification", leadVerificationRequested.create({ orgId, runId: run.runId }, { id: `verify-${run.runId}` }));
    }
    return { ...counts, verificationRunId: run?.runId ?? null };
  },
);
