"use server";

import { revalidatePath } from "next/cache";
import { can } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/agent/keys";
import { executeApproval } from "@/lib/agent/run";

export type KeyState = { error?: string; key?: string; name?: string } | undefined;

export async function createApiKey(_prev: KeyState, formData: FormData): Promise<KeyState> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "api_keys.manage")) return { error: "Only owners and admins can create API keys." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 100) return { error: "Give the key a name (1–100 characters)." };
  const { key, prefix, hash } = generateApiKey();
  // Insert as the user: RLS limits it to admins of this workspace.
  const supabase = await createClient();
  const { error } = await supabase.from("api_keys").insert({ org_id: ctx.org.id, name, prefix, key_hash: hash, created_by: ctx.user.id });
  if (error) return { error: error.message };
  await createAdminClient().from("agent_audit_log").insert({
    org_id: ctx.org.id,
    actor: `user:${ctx.user.id}`,
    actor_type: "user",
    action: "api_key.create",
    target: `api_key:${prefix}`,
    payload: { name },
  });
  revalidatePath("/settings/agent");
  return { key, name };
}

export async function revokeApiKey(formData: FormData) {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "api_keys.manage")) return;
  const supabase = await createClient();
  const id = String(formData.get("key_id"));
  const { data } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("org_id", ctx.org.id)
    .eq("id", id)
    .is("revoked_at", null)
    .select("prefix");
  if (data?.length) {
    await createAdminClient().from("agent_audit_log").insert({
      org_id: ctx.org.id,
      actor: `user:${ctx.user.id}`,
      actor_type: "user",
      action: "api_key.revoke",
      target: `api_key:${data[0]!.prefix}`,
    });
  }
  revalidatePath("/settings/agent");
}

/** Approve (runs the queued call now) or reject an agent request. Same people who can run campaigns. */
export async function decideApproval(formData: FormData) {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "campaigns.write")) return;
  const id = String(formData.get("approval_id"));
  if (formData.get("decision") === "approve") {
    const r = await executeApproval(ctx.org.id, id, ctx.user.id);
    if (!r.ok) console.warn(`approval ${id}: ${r.error}`);
  } else {
    const { data } = await createAdminClient()
      .from("agent_approvals")
      .update({ status: "rejected", decided_by: ctx.user.id, decided_at: new Date().toISOString() })
      .eq("org_id", ctx.org.id)
      .eq("id", id)
      .eq("status", "pending")
      .select("tool, campaign_id");
    if (data?.length) {
      await createAdminClient().from("agent_audit_log").insert({
        org_id: ctx.org.id,
        actor: `user:${ctx.user.id}`,
        actor_type: "user",
        action: `reject:${data[0]!.tool}`,
        target: data[0]!.campaign_id ? `campaign:${data[0]!.campaign_id}` : null,
        payload: { approval_id: id },
      });
    }
  }
  revalidatePath("/settings/agent");
}
