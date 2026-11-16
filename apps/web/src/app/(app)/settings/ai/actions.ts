"use server";

import { revalidatePath } from "next/cache";
import { can } from "@crm/core";
import { keyHint, ownKeySchema } from "@crm/core/ai";
import { hasProAccess } from "@crm/core/billing";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBillingStatus } from "@/lib/billing";
import { AI_MIGRATION_MISSING, callAi, deleteOwnAiKey, ownKeyConfig, storeOwnAiKey } from "@/lib/ai/provider";
import { friendlyError, isMissingSchema } from "@/lib/errors";
import { runAiDiagnostics, type AiCheck } from "@/lib/ai/diagnostics";
import { isSiteAdmin } from "@/lib/site-admin";

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
  if (error) return { error: isMissingSchema(error) ? AI_MIGRATION_MISSING : friendlyError(error) };
  revalidatePath("/settings/ai");
  return { message: "Saved." };
}

/** Tests the key with a tiny request, then stores it encrypted and switches the workspace to it. */
export async function saveOwnAiKey(prev: AiSettingsState, formData: FormData): Promise<AiSettingsState> {
  try {
    return await connectOwnKey(prev, formData);
  } catch (e) {
    // Never fall through to the error page: say what happened instead.
    if (e && typeof e === "object" && "digest" in e) throw e; // Next.js redirects / not-found
    console.error("saveOwnAiKey failed:", e);
    return { error: "Something went wrong while connecting the key. Please try again in a moment." };
  }
}

async function connectOwnKey(_prev: AiSettingsState, formData: FormData): Promise<AiSettingsState> {
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
    await callAi(config, { system: "You are a connection test.", user: "Reply with the word OK.", maxTokens: 16, json: false, temperature: 0 }, 25_000);
  } catch (e) {
    return { error: `That key didn't work: ${e instanceof Error ? e.message : "unknown error"}` };
  }

  const stored = await storeOwnAiKey(ctx.org.id, apiKey, keyHint(apiKey));
  if (!stored.ok) return { error: stored.error };
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ ai_provider: provider, ai_model: config.model, ai_base_url: provider === "openai_compatible" ? baseUrl : null })
    .eq("id", ctx.org.id);
  if (error) return { error: isMissingSchema(error) ? AI_MIGRATION_MISSING : friendlyError(error) };
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

/** Site admins only: check every link in the AI chain and report the real reasons. */
export async function checkAiSetup(): Promise<{ checks?: AiCheck[]; error?: string }> {
  const ctx = await getOrgContext();
  if (!isSiteAdmin(ctx.user.email)) return { error: "Only the site admin can run this check." };
  try {
    return { checks: await runAiDiagnostics(ctx.org.id) };
  } catch (e) {
    console.error("checkAiSetup failed:", e);
    return { error: `The check itself failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
