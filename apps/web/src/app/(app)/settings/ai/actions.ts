"use server";

import { revalidatePath } from "next/cache";
import { can } from "@crm/core";
import { keyHint, ownKeySchema } from "@crm/core/ai";
import { hasProAccess } from "@crm/core/billing";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBillingStatus } from "@/lib/billing";
import { callAi, deleteOwnAiKey, ownKeyConfig, storeOwnAiKey } from "@/lib/ai/provider";
import { friendlyError } from "@/lib/errors";

export type AiSettingsState = { error?: string; message?: string } | undefined;

const FORBIDDEN = { error: "Only owners and admins can change AI settings." };

export async function saveAiToggles(_prev: AiSettingsState, formData: FormData): Promise<AiSettingsState> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "org.update")) return FORBIDDEN;
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      ai_classification_enabled: formData.get("ai_classification_enabled") === "on",
      ai_drafts_enabled: formData.get("ai_drafts_enabled") === "on",
    })
    .eq("id", ctx.org.id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/settings/ai");
  return { message: "Saved." };
}

/** Tests the key with a tiny request, then stores it encrypted and switches the workspace to it. */
export async function saveOwnAiKey(_prev: AiSettingsState, formData: FormData): Promise<AiSettingsState> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "org.update")) return FORBIDDEN;
  if (!hasProAccess(await getBillingStatus(ctx.org.id))) return { error: "Connecting your own AI key is part of Pro." };

  const parsed = ownKeySchema.safeParse({
    provider: formData.get("provider"),
    apiKey: formData.get("api_key"),
    model: formData.get("model") ?? "",
    baseUrl: formData.get("base_url") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { provider, apiKey, model, baseUrl } = parsed.data;
  const config = ownKeyConfig(provider, apiKey, model || null, provider === "openai_compatible" ? baseUrl : null);

  try {
    await callAi(config, { system: "You are a connection test.", user: "Reply with the word OK.", maxTokens: 16, json: false, temperature: 0 }, 20_000);
  } catch (e) {
    return { error: `That key didn't work: ${e instanceof Error ? e.message : "unknown error"}` };
  }

  await storeOwnAiKey(ctx.org.id, apiKey, keyHint(apiKey));
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ ai_provider: provider, ai_model: config.model, ai_base_url: provider === "openai_compatible" ? baseUrl : null })
    .eq("id", ctx.org.id);
  if (error) return { error: friendlyError(error) };
  await admin.from("agent_audit_log").insert({
    org_id: ctx.org.id,
    actor: `user:${ctx.user.id}`,
    actor_type: "user",
    action: "ai.own_key.set",
    target: `ai:${provider}`,
    payload: { model: config.model, base_url: provider === "openai_compatible" ? baseUrl : null },
  });
  revalidatePath("/settings/ai");
  return { message: `Connected. YCAReach now uses your ${provider === "anthropic" ? "Claude key" : "key"} (${config.model}).` };
}

export async function switchToIncludedAi(): Promise<void> {
  const ctx = await getOrgContext();
  if (!can(ctx.role, "org.update")) return;
  await deleteOwnAiKey(ctx.org.id);
  const admin = createAdminClient();
  await admin.from("organizations").update({ ai_provider: "included", ai_model: null, ai_base_url: null }).eq("id", ctx.org.id);
  await admin.from("agent_audit_log").insert({
    org_id: ctx.org.id,
    actor: `user:${ctx.user.id}`,
    actor_type: "user",
    action: "ai.own_key.remove",
    target: "ai:included",
    payload: {},
  });
  revalidatePath("/settings/ai");
}
