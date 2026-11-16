import "server-only";
import { cache } from "react";
import {
  AI_UNAVAILABLE_MESSAGE,
  INCLUDED_AI_DEFAULTS,
  aiCostMicros,
  estimateCostMicros,
  monthlyAiCapMicros,
  type AiKind,
  type AiPrompt,
  type AiUsage,
} from "@crm/core/ai";
import { hasProAccess, type Plan } from "@crm/core/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBillingStatus } from "@/lib/billing";
import { isMissingSchema } from "@/lib/errors";

/**
 * One way to call AI for the whole app: DeepSeek V4 Flash with YCAReach's key.
 *
 * Every call first reserves a worst-case cost against the workspace's hidden
 * monthly cap ($5 on Pro, $0.50 on a trial). Over the cap → the call doesn't
 * happen and the user sees a neutral "unavailable" message. Only Pro and
 * active trials get AI.
 */

export type AiConfig = { model: string; baseUrl: string; apiKey: string };

export type AiAccess = { config: AiConfig; capMicros: number } | { config: null; reason: "no_plan" | "not_configured" };

export type AiResult = { ok: true; text: string } | { ok: false; error: string; reason: "unavailable" | "failed" };

/** The message shown when the AI tables/functions (migration 0017) aren't in the database. */
export const AI_MIGRATION_MISSING =
  "The AI database update isn't installed yet. In Supabase, open SQL Editor and run supabase/migrations/20260928000017_ai.sql, then try again.";

/** AI is configured when the server has a DeepSeek (or compatible) key. */
export function includedAiConfigured(): boolean {
  return !!(process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY);
}

export function includedConfig(): AiConfig | null {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) return null;
  return {
    model: process.env.AI_MODEL || INCLUDED_AI_DEFAULTS.model,
    baseUrl: process.env.AI_BASE_URL || INCLUDED_AI_DEFAULTS.baseUrl,
    apiKey,
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export async function getAiAccess(orgId: string): Promise<AiAccess> {
  const { data: row } = await createAdminClient().from("organizations").select("plan, trial_ends_at").eq("id", orgId).maybeSingle();
  if (!row || !hasProAccess({ plan: row.plan as Plan, trial_ends_at: row.trial_ends_at })) return { config: null, reason: "no_plan" };
  const config = includedConfig();
  if (!config) return { config: null, reason: "not_configured" };
  return { config, capMicros: monthlyAiCapMicros(row, process.env) };
}

/** Cheap check for showing AI buttons. */
export async function aiAvailableFor(org: { plan: string; trial_ends_at: string }): Promise<boolean> {
  return hasProAccess({ plan: org.plan as Plan, trial_ends_at: org.trial_ends_at }) && includedAiConfigured();
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

class AiCallError extends Error {
  constructor(
    message: string,
    /** Whether the provider may still have charged us (timeouts). */
    readonly maybeBilled = false,
  ) {
    super(message);
  }
}

type CallOutput = { text: string; usage: AiUsage };

type ChatCompletionBody = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string };
} | null;

/** Calls DeepSeek (or the OpenAI-compatible service set in AI_BASE_URL). No cap, no logging: runAi adds those. */
export async function callAi(config: AiConfig, prompt: AiPrompt, timeoutMs = 45_000): Promise<CallOutput> {
  let base: URL;
  try {
    base = new URL(config.baseUrl);
  } catch {
    throw new AiCallError("AI_BASE_URL isn't a valid URL.");
  }
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // DeepSeek thinks by default: slower, pricier, and it can use up the output budget on
  // short tasks. Turn it off the way each service expects: DeepSeek's own API takes
  // `thinking`, OpenRouter (if used via AI_BASE_URL) takes `reasoning`.
  const openrouter = /(^|\.)openrouter\.ai$/i.test(base.hostname);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        max_tokens: prompt.maxTokens,
        temperature: prompt.temperature,
        stream: false,
        ...(openrouter ? { reasoning: { enabled: false } } : { thinking: { type: "disabled" } }),
        ...(prompt.json ? { response_format: { type: "json_object" } } : {}),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new AiCallError(timedOut ? "The AI took too long to answer." : "Couldn't reach the AI provider.", timedOut);
  }
  const body = (await res.json().catch(() => null)) as ChatCompletionBody;
  if (!res.ok) {
    const detail = typeof body?.error?.message === "string" ? `: ${body.error.message.slice(0, 200)}` : "";
    throw new AiCallError(res.status === 401 || res.status === 403 ? "The AI provider rejected the API key." : `The AI provider returned an error (${res.status})${detail}`);
  }
  const usage: AiUsage = {
    inputTokens: body?.usage?.prompt_tokens ?? 0,
    cachedInputTokens: body?.usage?.prompt_cache_hit_tokens ?? body?.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: body?.usage?.completion_tokens ?? 0,
  };
  const content = body?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) throw Object.assign(new AiCallError("The AI returned an empty answer."), { usage });
  return { text, usage };
}

/**
 * Runs one AI task for a workspace: access check → reserve budget → call →
 * record real usage. Never throws; failures come back as a neutral message
 * (the real reason goes to the server log and the site-admin AI check).
 */
export async function runAi(orgId: string, kind: AiKind, prompt: AiPrompt, opts: { timeoutMs?: number } = {}): Promise<AiResult> {
  const access = await getAiAccess(orgId);
  if (!access.config) {
    if (access.reason === "not_configured") console.error("AI: no DEEPSEEK_API_KEY (or AI_API_KEY) on this deployment.");
    return { ok: false, reason: "unavailable", error: AI_UNAVAILABLE_MESSAGE };
  }
  const { config } = access;
  const admin = createAdminClient();

  const estimate = estimateCostMicros(config.model, prompt.system.length + prompt.user.length, prompt.maxTokens);
  const { data: usageId, error: reserveError } = await admin.rpc("reserve_ai_budget", {
    p_org_id: orgId,
    p_kind: kind,
    p_provider: "included",
    p_model: config.model,
    p_own_key: false,
    p_estimate_micros: estimate,
    p_cap_micros: access.capMicros,
  });
  if (reserveError) {
    console.error(
      `reserve_ai_budget failed (${reserveError.code ?? "no code"}): ${reserveError.message}${isMissingSchema(reserveError) ? " — run migration 20260928000017_ai.sql" : ""}`,
    );
    return { ok: false, reason: "unavailable", error: AI_UNAVAILABLE_MESSAGE };
  }
  if (!usageId) return { ok: false, reason: "unavailable", error: AI_UNAVAILABLE_MESSAGE }; // monthly cap reached

  const finish = (status: "done" | "failed", usage: AiUsage | null, costOverride?: number) =>
    admin.rpc("finish_ai_usage", {
      p_id: usageId,
      p_status: status,
      p_input_tokens: usage?.inputTokens ?? 0,
      p_output_tokens: usage?.outputTokens ?? 0,
      p_cost_micros: costOverride ?? (usage ? aiCostMicros(config.model, usage) : 0),
    });

  try {
    const out = await callAi(config, prompt, opts.timeoutMs ?? 45_000);
    await finish("done", out.usage);
    return { ok: true, text: out.text };
  } catch (e) {
    const err = e instanceof AiCallError ? e : new AiCallError("The AI call failed.");
    const usage = (e as { usage?: AiUsage }).usage ?? null;
    // A timeout may still be billed: keep the reserved estimate so the cap stays honest.
    await finish("failed", usage, err.maybeBilled ? estimate : undefined);
    console.warn(`AI ${kind} failed (${config.model}): ${err.message}`);
    return { ok: false, reason: "failed", error: AI_UNAVAILABLE_MESSAGE };
  }
}

/**
 * For the UI: "on" = AI ready, "upgrade" = plan without AI (Standard / ended trial),
 * "off" = the plan includes AI but it isn't usable on this site right now (no AI key
 * on the server, or the plan couldn't be read).
 *
 * A setup problem must never be shown as "Upgrade to Pro": if the organization row
 * can't be read, the plan is taken from the same source as the header badge instead.
 */
export const aiModeFor = cache(async (orgId: string): Promise<"on" | "upgrade" | "off"> => {
  const { data, error } = await createAdminClient().from("organizations").select("plan, trial_ends_at").eq("id", orgId).maybeSingle();
  if (data) {
    if (!hasProAccess({ plan: data.plan as Plan, trial_ends_at: data.trial_ends_at })) return "upgrade";
    return includedAiConfigured() ? "on" : "off";
  }
  console.error(`aiModeFor: couldn't read the plan for workspace ${orgId}: ${error ? `${error.code ?? ""} ${error.message}` : "no row returned"}`);
  try {
    const status = await getBillingStatus(orgId);
    if (!hasProAccess({ plan: status.plan as Plan, trial_ends_at: status.trial_ends_at as string })) return "upgrade";
  } catch (e) {
    console.error("aiModeFor: couldn't read the plan either:", e instanceof Error ? e.message : e);
  }
  return "off";
});
