"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, isValidEmailSyntax, normalizeEmail } from "@crm/core";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, validateMapping, type ColumnMapping } from "@crm/core/imports";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldErrors, formToObject, type FieldErrors } from "@/lib/forms";
import { IMPORTS_BUCKET, importFilePath } from "@/lib/imports/storage";
import { inngest } from "@/inngest/client";
import { leadImportRequested, leadVerificationRequested } from "@/inngest/events";
import { createVerificationRun, type VerificationTarget } from "@/lib/verification/runs";

const FORBIDDEN = "You don't have permission to change leads.";

async function requireWriter() {
  const ctx = await getOrgContext();
  return can(ctx.role, "leads.write") ? ctx : null;
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

const startImportSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(MAX_IMPORT_BYTES, "File is larger than 20 MB"),
  columnCount: z.number().int().positive().max(500),
  totalRows: z.number().int().min(1, "The file has no data rows").max(MAX_IMPORT_ROWS, `Max ${MAX_IMPORT_ROWS.toLocaleString()} rows per import`),
  mapping: z.array(z.string()),
  mode: z.enum(["skip", "fill"]),
  list: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("existing"), id: z.string().uuid() }),
    z.object({ type: z.literal("new"), name: z.string().trim().min(1, "Name the new list").max(120) }),
  ]),
});

export type StartImportInput = z.input<typeof startImportSchema>;
export type StartImportResult = { error: string } | { importId: string; path: string; token: string };

/** Step 1: validate, create the import row, hand back a one-time signed upload URL. */
export async function startImport(input: StartImportInput): Promise<StartImportResult> {
  const ctx = await requireWriter();
  if (!ctx) return { error: FORBIDDEN };

  const parsed = startImportSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid import" };
  const { filename, columnCount, totalRows, mode, list } = parsed.data;
  const mapping = parsed.data.mapping as ColumnMapping;
  const mappingError = validateMapping(mapping, columnCount);
  if (mappingError) return { error: mappingError };
  if (!/\.(csv|txt)$/i.test(filename)) return { error: "Upload a .csv file" };

  const supabase = await createClient();
  let listId: string | null = null;
  if (list.type === "existing") {
    const { data } = await supabase.from("lead_lists").select("id").eq("org_id", ctx.org.id).eq("id", list.id).maybeSingle();
    if (!data) return { error: "List not found" };
    listId = data.id;
  } else if (list.type === "new") {
    const { data, error } = await supabase.from("lead_lists").insert({ org_id: ctx.org.id, name: list.name }).select("id").single();
    if (error || !data) return { error: error?.message ?? "Could not create list" };
    listId = data.id;
  }

  const { data: imp, error } = await supabase
    .from("imports")
    .insert({
      org_id: ctx.org.id,
      list_id: listId,
      filename,
      column_mapping: mapping,
      options: { mode },
      total_rows: totalRows,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error || !imp) return { error: error?.message ?? "Could not start import" };

  const path = importFilePath(ctx.org.id, imp.id);
  const admin = createAdminClient();
  await admin.from("imports").update({ storage_path: path }).eq("org_id", ctx.org.id).eq("id", imp.id);
  const { data: signed, error: signError } = await admin.storage.from(IMPORTS_BUCKET).createSignedUploadUrl(path);
  if (signError || !signed) {
    await admin.from("imports").update({ status: "failed", error: "Upload URL could not be created" }).eq("id", imp.id);
    return { error: signError?.message ?? "Could not prepare upload" };
  }
  return { importId: imp.id, path: signed.path, token: signed.token };
}

/** Step 2 (after the browser uploaded the file): enqueue background processing. */
export async function queueImport(importId: string): Promise<{ error?: string }> {
  const ctx = await requireWriter();
  if (!ctx) return { error: FORBIDDEN };

  const supabase = await createClient();
  const { data: imp } = await supabase.from("imports").select("id, status").eq("org_id", ctx.org.id).eq("id", importId).maybeSingle();
  if (!imp) return { error: "Import not found" };
  if (imp.status !== "pending") return {};

  try {
    await inngest.send(leadImportRequested.create({ orgId: ctx.org.id, importId }, { id: `lead-import-${importId}` }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not queue import";
    await createAdminClient().from("imports").update({ status: "failed", error: message }).eq("id", importId);
    return { error: message };
  }
  revalidatePath("/leads/imports");
  return {};
}

// ---------------------------------------------------------------------------
// Manual add
// ---------------------------------------------------------------------------

const optional = z.string().trim().max(500).optional().transform((v) => v || null);
const leadSchema = z.object({
  email: z.string().transform(normalizeEmail).refine(isValidEmailSyntax, "Enter a valid email address"),
  first_name: optional,
  last_name: optional,
  company: optional,
  title: optional,
});

export type AddLeadState = { error?: string; fieldErrors?: FieldErrors; ok?: boolean } | undefined;

export async function addLead(_prev: AddLeadState, formData: FormData): Promise<AddLeadState> {
  const ctx = await requireWriter();
  if (!ctx) return { error: FORBIDDEN };
  const parsed = leadSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: "Fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: suppressed } = await supabase
    .from("suppression_list")
    .select("reason")
    .eq("org_id", ctx.org.id)
    .eq("email", parsed.data.email)
    .maybeSingle();
  if (suppressed) return { error: `${parsed.data.email} is on the suppression list (${suppressed.reason}).` };

  const { error } = await supabase.from("leads").insert({ org_id: ctx.org.id, ...parsed.data });
  if (error) {
    if (error.code === "23505") return { error: `${parsed.data.email} already exists.`, fieldErrors: { email: ["Already exists"] } };
    return { error: error.message };
  }
  revalidatePath("/leads");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

const idsSchema = z.array(z.string().uuid()).min(1, "Select at least one lead").max(1000);

export type BulkState = { error?: string; message?: string } | undefined;

function selectedIds(formData: FormData) {
  return idsSchema.safeParse(formData.getAll("lead_id").map(String));
}

export async function bulkLeadAction(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const ctx = await requireWriter();
  if (!ctx) return { error: FORBIDDEN };
  const ids = selectedIds(formData);
  if (!ids.success) return { error: ids.error.issues[0]?.message };
  const action = String(formData.get("bulk_action") ?? "");
  const supabase = await createClient();

  if (action === "delete") {
    const { error, count } = await supabase.from("leads").delete({ count: "exact" }).eq("org_id", ctx.org.id).in("id", ids.data);
    if (error) return { error: error.message };
    revalidatePath("/leads");
    return { message: `Deleted ${count ?? 0} lead(s).` };
  }

  if (action === "suppress") {
    const { data: leads, error } = await supabase.from("leads").select("email").eq("org_id", ctx.org.id).in("id", ids.data);
    if (error) return { error: error.message };
    const { error: supError } = await supabase.from("suppression_list").upsert(
      (leads ?? []).map((l) => ({ org_id: ctx.org.id, email: l.email, reason: "manual", source: `user:${ctx.user.id}` })),
      { onConflict: "org_id,email", ignoreDuplicates: true },
    );
    if (supError) return { error: supError.message };
    revalidatePath("/leads");
    revalidatePath("/suppression");
    return { message: `Suppressed ${leads?.length ?? 0} lead(s).` };
  }

  if (action === "add_to_list") {
    const listId = String(formData.get("list_id") ?? "");
    const { data: list } = await supabase.from("lead_lists").select("id").eq("org_id", ctx.org.id).eq("id", listId).maybeSingle();
    if (!list) return { error: "Choose a list" };
    const { error } = await supabase
      .from("lead_list_members")
      .upsert(ids.data.map((lead_id) => ({ org_id: ctx.org.id, list_id: list.id, lead_id })), {
        onConflict: "list_id,lead_id",
        ignoreDuplicates: true,
      });
    if (error) return { error: error.message };
    revalidatePath("/leads");
    return { message: `Added ${ids.data.length} lead(s) to the list.` };
  }

  if (action === "verify") {
    const started = await startVerification(ctx.org.id, ctx.user.id, { leadIds: ids.data });
    if ("error" in started) return started;
    return { message: started.total ? `Verifying ${started.total} lead(s)…` : "Those leads are already being verified." };
  }

  return { error: "Unknown action" };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function startVerification(orgId: string, userId: string, target: VerificationTarget) {
  try {
    const run = await createVerificationRun(orgId, target, { source: "manual", requestedBy: userId });
    if (!run) return { total: 0 };
    await inngest.send(leadVerificationRequested.create({ orgId, runId: run.runId }, { id: `verify-${run.runId}` }));
    revalidatePath("/leads");
    return { total: run.total };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not start verification" };
  }
}

export async function verifyAllUnverified(_prev: BulkState, _formData: FormData): Promise<BulkState> {
  const ctx = await requireWriter();
  if (!ctx) return { error: FORBIDDEN };
  const started = await startVerification(ctx.org.id, ctx.user.id, { allUnverified: true });
  if ("error" in started) return started;
  return { message: started.total ? `Verifying ${started.total.toLocaleString()} lead(s)…` : "Nothing to verify." };
}
