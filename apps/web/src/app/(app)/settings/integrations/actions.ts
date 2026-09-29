"use server";

import { revalidatePath } from "next/cache";
import { can, defaultStageMap } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { hubspotAdapter, storeCrmToken } from "@/lib/crm";
import { inngest } from "@/inngest/client";
import { crmSyncRequested } from "@/inngest/events";

export type CrmState = { error?: string; message?: string } | undefined;

async function requireAdmin() {
  const ctx = await getOrgContext();
  return can(ctx.role, "org.update") ? ctx : null;
}

async function audit(orgId: string, userId: string, action: string, payload: Record<string, unknown> = {}) {
  await createAdminClient().from("agent_audit_log").insert({ org_id: orgId, actor: `user:${userId}`, actor_type: "user", action, target: "crm:hubspot", payload: payload as never });
}

/** Verify a HubSpot private app token, store it encrypted, and propose a stage mapping. */
export async function connectHubspot(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Only owners and admins can connect integrations." };
  const token = String(formData.get("token") ?? "").trim();
  if (token.length < 10 || token.length > 500) return { error: "Paste the private app access token." };

  const adapter = hubspotAdapter(token);
  const check = await adapter.verify();
  if (!check.ok) return { error: check.error };
  const pipelines = await adapter.listPipelines();
  const pipeline = pipelines[0];

  const admin = createAdminClient();
  const { data: stages } = await admin.from("pipeline_stages").select("id, name, kind").eq("org_id", ctx.org.id);
  const { data: conn, error } = await admin
    .from("crm_connections")
    .upsert(
      {
        org_id: ctx.org.id,
        provider: "hubspot",
        status: "connected",
        account_label: check.accountLabel,
        pipeline_id: pipeline?.id ?? null,
        stage_map: pipeline ? defaultStageMap(stages ?? [], pipeline) : {},
        last_error: null,
        last_synced_at: null,
        created_by: ctx.user.id,
      },
      { onConflict: "org_id,provider" },
    )
    .select("id")
    .single();
  if (error || !conn) return { error: error?.message ?? "Could not save the connection." };
  await storeCrmToken(ctx.org.id, conn.id, token);
  await audit(ctx.org.id, ctx.user.id, "crm.connect", { account: check.accountLabel });
  revalidatePath("/settings/integrations");
  return { message: `Connected${check.accountLabel ? ` to ${check.accountLabel}` : ""}. Check the stage mapping, then sync.` };
}

export async function saveMapping(_prev: CrmState, formData: FormData): Promise<CrmState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Only owners and admins can change the mapping." };
  const admin = createAdminClient();
  const { data: stages } = await admin.from("pipeline_stages").select("id").eq("org_id", ctx.org.id);
  const map: Record<string, string> = {};
  for (const s of stages ?? []) {
    const v = String(formData.get(`stage_${s.id}`) ?? "");
    if (v) map[s.id] = v.slice(0, 100);
  }
  const { error } = await admin
    .from("crm_connections")
    .update({ pipeline_id: String(formData.get("pipeline_id") ?? "").slice(0, 100) || null, stage_map: map, last_synced_at: null })
    .eq("org_id", ctx.org.id)
    .eq("provider", "hubspot");
  if (error) return { error: error.message };
  revalidatePath("/settings/integrations");
  return { message: "Mapping saved. The next sync updates every deal." };
}

export async function syncNow(formData: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return;
  const { data } = await createAdminClient().from("crm_connections").select("id").eq("org_id", ctx.org.id).eq("id", String(formData.get("connection_id"))).maybeSingle();
  if (data) await inngest.send(crmSyncRequested.create({ connectionId: data.id }));
  revalidatePath("/settings/integrations");
}

/** Removes the connection, its token and links. Nothing is deleted in HubSpot. */
export async function disconnectCrm(formData: FormData) {
  const ctx = await requireAdmin();
  if (!ctx) return;
  await createAdminClient().from("crm_connections").delete().eq("org_id", ctx.org.id).eq("id", String(formData.get("connection_id")));
  await audit(ctx.org.id, ctx.user.id, "crm.disconnect");
  revalidatePath("/settings/integrations");
}
