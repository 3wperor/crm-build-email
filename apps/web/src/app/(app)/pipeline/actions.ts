"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export type PipelineState = { error?: string; message?: string } | undefined;

const uuid = z.string().uuid();

function refresh(leadId?: string) {
  revalidatePath("/pipeline");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Called by drag-and-drop and the "Move to" menu. Returns an error string for the optimistic UI to roll back. */
export async function moveOpportunity(opportunityId: string, stageId: string): Promise<{ error?: string }> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "opportunities.write")) return { error: "You don't have permission to move cards." };
  if (!uuid.safeParse(opportunityId).success || !uuid.safeParse(stageId).success) return { error: "Invalid move." };
  const supabase = await createClient();
  // The composite FK (org_id, stage_id) rejects stages from another org.
  const { data, error } = await supabase
    .from("opportunities")
    .update({ stage_id: stageId, moved_at: new Date().toISOString() })
    .eq("org_id", ctx.org.id)
    .eq("id", opportunityId)
    .select("lead_id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Card not found." };
  refresh(data[0]!.lead_id);
  return {};
}

export async function addToPipeline(_prev: PipelineState, formData: FormData): Promise<PipelineState> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "opportunities.write")) return { error: "You don't have permission." };
  const leadId = String(formData.get("lead_id"));
  const supabase = await createClient();
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("org_id", ctx.org.id)
    .eq("is_entry", true)
    .maybeSingle();
  if (!stage) return { error: "No entry stage configured." };
  const { error } = await supabase.from("opportunities").insert({ org_id: ctx.org.id, lead_id: leadId, stage_id: stage.id, source: "manual" });
  if (error) return { error: error.code === "23505" ? "Already in the pipeline." : error.message };
  refresh(leadId);
  return { message: "Added to the pipeline." };
}

export async function removeFromPipeline(formData: FormData) {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "opportunities.write")) return;
  const leadId = String(formData.get("lead_id"));
  const supabase = await createClient();
  await supabase.from("opportunities").delete().eq("org_id", ctx.org.id).eq("lead_id", leadId);
  refresh(leadId);
}

const oppSchema = z.object({
  booking_link: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Enter a full URL (https://…)"),
  stage_id: uuid,
});

export async function updateOpportunity(_prev: PipelineState, formData: FormData): Promise<PipelineState> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "opportunities.write")) return { error: "You don't have permission." };
  const parsed = oppSchema.safeParse({ booking_link: formData.get("booking_link") ?? "", stage_id: formData.get("stage_id") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const leadId = String(formData.get("lead_id"));
  const supabase = await createClient();
  const { data: current } = await supabase.from("opportunities").select("stage_id").eq("org_id", ctx.org.id).eq("lead_id", leadId).maybeSingle();
  if (!current) return { error: "Not in the pipeline." };
  const { error } = await supabase
    .from("opportunities")
    .update({
      booking_link: parsed.data.booking_link || null,
      stage_id: parsed.data.stage_id,
      ...(current.stage_id !== parsed.data.stage_id ? { moved_at: new Date().toISOString() } : {}),
    })
    .eq("org_id", ctx.org.id)
    .eq("lead_id", leadId);
  if (error) return { error: error.message };
  refresh(leadId);
  return { message: "Saved." };
}

// ---------------------------------------------------------------------------
// Stages (admin+; RLS enforces it too)
// ---------------------------------------------------------------------------

async function requireStageAdmin() {
  const ctx = await getOrgContext();
  return can(ctx.role, "pipeline_stages.manage") ? ctx : null;
}

const stageSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(60), kind: z.enum(["open", "won", "lost"]) });

export async function addStage(_prev: PipelineState, formData: FormData): Promise<PipelineState> {
  const ctx = await requireStageAdmin();
  if (!ctx) return { error: "Only owners and admins can edit stages." };
  const parsed = stageSchema.safeParse({ name: formData.get("name"), kind: formData.get("kind") ?? "open" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data: last } = await supabase.from("pipeline_stages").select("position").eq("org_id", ctx.org.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("pipeline_stages").insert({ org_id: ctx.org.id, name: parsed.data.name, kind: parsed.data.kind, position: (last?.position ?? 0) + 1 });
  if (error) return { error: error.message };
  refresh();
  revalidatePath("/pipeline/stages");
  return { message: `Added "${parsed.data.name}".` };
}

export async function updateStage(_prev: PipelineState, formData: FormData): Promise<PipelineState> {
  const ctx = await requireStageAdmin();
  if (!ctx) return { error: "Only owners and admins can edit stages." };
  const parsed = stageSchema.safeParse({ name: formData.get("name"), kind: formData.get("kind") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pipeline_stages")
    .update(parsed.data)
    .eq("org_id", ctx.org.id)
    .eq("id", String(formData.get("stage_id")));
  if (error) return { error: error.code === "23514" ? "The entry stage must stay an open stage." : error.message };
  refresh();
  revalidatePath("/pipeline/stages");
  return { message: "Saved." };
}

export async function deleteStage(_prev: PipelineState, formData: FormData): Promise<PipelineState> {
  const ctx = await requireStageAdmin();
  if (!ctx) return { error: "Only owners and admins can edit stages." };
  const supabase = await createClient();
  const { error } = await supabase.from("pipeline_stages").delete().eq("org_id", ctx.org.id).eq("id", String(formData.get("stage_id")));
  if (error) {
    if (error.code === "23503") return { error: "Move its cards to another stage first." };
    if (error.code === "23514") return { error: "Choose another entry stage before deleting this one." };
    return { error: error.message };
  }
  // Close the gap in positions.
  const { data: rest } = await supabase.from("pipeline_stages").select("id").eq("org_id", ctx.org.id).order("position");
  if (rest?.length) await supabase.rpc("reorder_pipeline_stages", { p_org_id: ctx.org.id, p_stage_ids: rest.map((r) => r.id) });
  refresh();
  revalidatePath("/pipeline/stages");
  return { message: "Stage deleted." };
}

export async function moveStage(formData: FormData) {
  const ctx = await requireStageAdmin();
  if (!ctx) return;
  const id = String(formData.get("stage_id"));
  const dir = formData.get("dir") === "up" ? -1 : 1;
  const supabase = await createClient();
  const { data: stages } = await supabase.from("pipeline_stages").select("id").eq("org_id", ctx.org.id).order("position");
  const ids = (stages ?? []).map((s) => s.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  await supabase.rpc("reorder_pipeline_stages", { p_org_id: ctx.org.id, p_stage_ids: ids });
  refresh();
  revalidatePath("/pipeline/stages");
}

export async function setEntryStage(formData: FormData) {
  const ctx = await requireStageAdmin();
  if (!ctx) return;
  const supabase = await createClient();
  await supabase.rpc("set_entry_stage", { p_org_id: ctx.org.id, p_stage_id: String(formData.get("stage_id")) });
  refresh();
  revalidatePath("/pipeline/stages");
}
