import "server-only";
import { cache } from "react";
import Anthropic from "@anthropic-ai/sdk";
import {
  AI_UNAVAILABLE_MESSAGE,
  INCLUDED_AI_DEFAULTS,
  OWN_KEY_DEFAULT_MODELS,
  aiCostMicros,
  estimateCostMicros,
  monthlyAiCapMicros,
  type AiKind,
  type AiPrompt,
  type AiProvider,
  type AiUsage,
} from "@crm/core/ai";
import { hasProAccess, type Plan } from "@crm/core/billing";
import { decryptSecret, encryptSecret, keyringFromEnv } from "@crm/core/crypto";
import { HostNotAllowedError, PinnedRequestError, postJsonPinned } from "@crm/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBillingStatus } from "@/lib/billing";

/**
 * One way to call AI for the whole app.
 *
 * - Included AI (DeepSeek Flash, our key): every call reserves a worst-case
 *   cost against the workspace's hidden monthly cap first. Over the cap → the
 *   call doesn't happen and the user sees a neutral "unavailable" message.
 * - The workspace's own key (Claude or OpenAI-compatible): no cap; usage is
 *   still logged (tokens only) so we can debug.
 * - Only Pro and active trials get AI.
 */

export type AiConfig = {
  provider: "openai" | "anthropic";
  /** What the workspace picked; "included" = our DeepSeek key. */
  source: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  ownKey: boolean;
};

export type AiAccess = { config: AiConfig; capMicros: number } | { config: null; reason: "no_plan" | "not_configured" };

export type AiResult = { ok: true; text: string } | { ok: false; error: string; reason: "unavailable" | "failed" };

const keyring = () => keyringFromEnv(process.env);
const prod = () => process.env.VERCEL_ENV === "production";

/** Included AI is configured when the server has a DeepSeek (or compatible) key. */
export function includedAiConfigured(): boolean {
  return !!(process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY);
}

function includedConfig(): AiConfig | null {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) return null;
  return {
    provider: "openai",
    source: "included",
    model: process.env.AI_MODEL || INCLUDED_AI_DEFAULTS.model,
    baseUrl: process.env.AI_BASE_URL || INCLUDED_AI_DEFAULTS.baseUrl,
    apiKey,
    ownKey: false,
  };
}

// ---------------------------------------------------------------------------
// Own key storage (AES-GCM, AAD = org id)
// ---------------------------------------------------------------------------

export async function storeOwnAiKey(orgId: string, apiKey: string, hint: string) {
  const { ciphertext, keyVersion } = encryptSecret(apiKey, orgId, keyring());
  const { error } = await createAdminClient()
    .from("ai_credentials")
    .upsert({ org_id: orgId, ciphertext, key_version: keyVersion, key_hint: hint, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to store the key: ${error.message}`);
}

export async function deleteOwnAiKey(orgId: string) {
  await createAdminClient().from("ai_credentials").delete().eq("org_id", orgId);
}

export async function ownAiKeyHint(orgId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("ai_credentials").select("key_hint").eq("org_id", orgId).maybeSingle();
  return data ? (data.key_hint ?? "saved") : null;
}

async function loadOwnKey(orgId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("ai_credentials").select("ciphertext").eq("org_id", orgId).maybeSingle();
  if (!data) return null;
  try {
    return decryptSecret(data.ciphertext, orgId, keyring());
  } catch {
    return null;
  }
}

export function ownKeyConfig(provider: "anthropic" | "openai_compatible", apiKey: string, model: string | null, baseUrl: string | null): AiConfig {
  return provider === "anthropic"
    ? { provider: "anthropic", source: "anthropic", model: model || OWN_KEY_DEFAULT_MODELS.anthropic, baseUrl: baseUrl || "", apiKey, ownKey: true }
    : { provider: "openai", source: "openai_compatible", model: model || "", baseUrl: baseUrl || "", apiKey, ownKey: true };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

type OrgAiRow = { plan: string; trial_ends_at: string; ai_provider: string; ai_model: string | null; ai_base_url: string | null };

export async function getAiAccess(orgId: string, org?: OrgAiRow): Promise<AiAccess> {
  let row = org;
  if (!row) {
    const { data } = await createAdminClient()
      .from("organizations")
      .select("plan, trial_ends_at, ai_provider, ai_model, ai_base_url")
      .eq("id", orgId)
      .maybeSingle();
    if (!data) return { config: null, reason: "no_plan" };
    row = data;
  }
  if (!hasProAccess({ plan: row.plan as Plan, trial_ends_at: row.trial_ends_at })) return { config: null, reason: "no_plan" };

  if (row.ai_provider === "anthropic" || row.ai_provider === "openai_compatible") {
    const key = await loadOwnKey(orgId);
    if (key) return { config: ownKeyConfig(row.ai_provider, key, row.ai_model, row.ai_base_url), capMicros: Number.MAX_SAFE_INTEGER };
    // Key missing or unreadable: fall back to included AI rather than breaking.
  }
  const included = includedConfig();
  if (!included) return { config: null, reason: "not_configured" };
  return { config: included, capMicros: monthlyAiCapMicros(row, process.env) };
}

/** Cheap check for showing AI buttons (no key decryption). */
export async function aiAvailableFor(org: { plan: string; trial_ends_at: string; ai_provider: string }): Promise<boolean> {
  if (!hasProAccess({ plan: org.plan as Plan, trial_ends_at: org.trial_ends_at })) return false;
  return org.ai_provider !== "included" || includedAiConfigured();
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

const parseJson = (text: string): ChatCompletionBody => {
  try {
    return JSON.parse(text) as ChatCompletionBody;
  } catch {
    return null;
  }
};

/**
 * POSTs the chat request. Our own configured endpoint uses fetch; a
 * workspace-supplied address goes through the pinned client so the server
 * can't be pointed at internal hosts (also not via DNS rebinding or redirects).
 */
async function postChat(config: AiConfig, url: string, payload: string, timeoutMs: number): Promise<{ status: number; body: ChatCompletionBody }> {
  const headers = { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" };
  if (config.ownKey) {
    const allowInsecure = !prod() && process.env.AI_ALLOW_PRIVATE_URLS === "true";
    try {
      const res = await postJsonPinned(url, { headers, body: payload, timeoutMs, allowInsecure });
      return { status: res.status, body: parseJson(res.text) };
    } catch (e) {
      if (e instanceof HostNotAllowedError) throw new AiCallError("That API address isn't allowed. Use the provider's public https address.");
      if (e instanceof PinnedRequestError) {
        throw new AiCallError(e.timedOut ? "The AI took too long to answer." : /https|username/.test(e.message) ? e.message.replace("The address", "The API address") : "Couldn't reach the AI provider.", e.timedOut);
      }
      throw new AiCallError("Couldn't reach the AI provider.");
    }
  }
  try {
    const res = await fetch(url, { method: "POST", headers, body: payload, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: (await res.json().catch(() => null)) as ChatCompletionBody };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new AiCallError(timedOut ? "The AI took too long to answer." : "Couldn't reach the AI provider.", timedOut);
  }
}

async function callOpenAiCompatible(config: AiConfig, prompt: AiPrompt, timeoutMs: number): Promise<CallOutput> {
  let base: URL;
  try {
    base = new URL(config.baseUrl);
  } catch {
    throw new AiCallError("The API address isn't a valid URL.");
  }
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // DeepSeek thinks by default: slower, pricier, and it can use up the output budget
  // on short tasks. Turn it off, in the way each service expects (others reject the parameter):
  // DeepSeek's own API takes `thinking`, OpenRouter takes `reasoning`.
  const openrouter = /(^|\.)openrouter\.ai$/i.test(base.hostname);
  const deepseek = !openrouter && (config.source === "included" || /(^|\.)deepseek\.com$/i.test(base.hostname));
  const { status, body } = await postChat(
    config,
    url,
    JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_tokens: prompt.maxTokens,
      temperature: prompt.temperature,
      stream: false,
      ...(deepseek ? { thinking: { type: "disabled" } } : {}),
      ...(openrouter ? { reasoning: { enabled: false } } : {}),
      ...(prompt.json ? { response_format: { type: "json_object" } } : {}),
    }),
    timeoutMs,
  );
  if (status < 200 || status >= 300) {
    const detail = typeof body?.error?.message === "string" ? `: ${body.error.message.slice(0, 200)}` : "";
    throw new AiCallError(status === 401 || status === 403 ? "The AI provider rejected the API key." : `The AI provider returned an error (${status})${detail}`);
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

async function callAnthropic(config: AiConfig, prompt: AiPrompt, timeoutMs: number): Promise<CallOutput> {
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 1 });
  try {
    const response = await client.messages.create(
      {
        model: config.model,
        max_tokens: prompt.maxTokens,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      },
      { timeout: timeoutMs },
    );
    const usage: AiUsage = {
      inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0),
      cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
      outputTokens: response.usage.output_tokens,
    };
    if (response.stop_reason === "refusal") throw Object.assign(new AiCallError("Claude declined to write this."), { usage });
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (!text.trim()) throw Object.assign(new AiCallError("Claude returned an empty answer."), { usage });
    return { text, usage };
  } catch (e) {
    if (e instanceof AiCallError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiCallError("Claude rejected the API key.");
    if (e instanceof Anthropic.NotFoundError) throw new AiCallError(`Claude doesn't recognise the model "${config.model}".`);
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiCallError("Claude took too long to answer.", true);
    if (e instanceof Anthropic.APIError) throw new AiCallError(`Claude returned an error (${e.status ?? "network"}).`);
    throw new AiCallError("Couldn't reach Claude.");
  }
}

/** Calls the provider directly (no cap, no logging). Used to test a key before saving it. */
export async function callAi(config: AiConfig, prompt: AiPrompt, timeoutMs = 60_000): Promise<CallOutput> {
  return config.provider === "anthropic" ? callAnthropic(config, prompt, timeoutMs) : callOpenAiCompatible(config, prompt, timeoutMs);
}

/**
 * Runs one AI task for a workspace: access check → reserve budget → call →
 * record real usage. Never throws; failures come back as a friendly message.
 */
export async function runAi(orgId: string, kind: AiKind, prompt: AiPrompt, opts: { timeoutMs?: number } = {}): Promise<AiResult> {
  const access = await getAiAccess(orgId);
  if (!access.config) return { ok: false, reason: "unavailable", error: AI_UNAVAILABLE_MESSAGE };
  const { config } = access;
  const admin = createAdminClient();

  const estimate = estimateCostMicros(config.model, prompt.system.length + prompt.user.length, prompt.maxTokens);
  const { data: usageId, error: reserveError } = await admin.rpc("reserve_ai_budget", {
    p_org_id: orgId,
    p_kind: kind,
    p_provider: config.source,
    p_model: config.model,
    p_own_key: config.ownKey,
    p_estimate_micros: estimate,
    p_cap_micros: access.capMicros,
  });
  if (reserveError) {
    console.error("reserve_ai_budget failed", reserveError.message);
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
    const out = await callAi(config, prompt, opts.timeoutMs ?? 60_000);
    await finish("done", out.usage);
    return { ok: true, text: out.text };
  } catch (e) {
    const err = e instanceof AiCallError ? e : new AiCallError("The AI call failed.");
    const usage = (e as { usage?: AiUsage }).usage ?? null;
    // A timeout may still be billed: keep the reserved estimate so the cap stays honest.
    await finish("failed", usage, err.maybeBilled ? estimate : undefined);
    console.warn(`AI ${kind} failed (${config.source}/${config.model}): ${err.message}`);
    // Our own provider's problems are ours, not the customer's: keep the message neutral.
    return { ok: false, reason: "failed", error: config.ownKey ? err.message : AI_UNAVAILABLE_MESSAGE };
  }
}

/**
 * For the UI: "on" = AI ready, "upgrade" = plan without AI (Standard / ended trial),
 * "off" = the plan includes AI but it isn't usable on this site right now (no AI key
 * on the server, or the workspace's AI settings couldn't be read).
 *
 * A setup problem must never be shown as "Upgrade to Pro": if the settings can't be
 * read, the plan is taken from the same source as the header badge instead.
 */
export const aiModeFor = cache(async (orgId: string): Promise<"on" | "upgrade" | "off"> => {
  const { data, error } = await createAdminClient().from("organizations").select("plan, trial_ends_at, ai_provider").eq("id", orgId).maybeSingle();
  if (data) {
    if (!hasProAccess({ plan: data.plan as Plan, trial_ends_at: data.trial_ends_at })) return "upgrade";
    return (await aiAvailableFor(data)) ? "on" : "off";
  }
  console.error(`aiModeFor: couldn't read AI settings for workspace ${orgId}: ${error ? `${error.code ?? ""} ${error.message}` : "no row returned"}`);
  try {
    const status = await getBillingStatus(orgId);
    if (!hasProAccess({ plan: status.plan as Plan, trial_ends_at: status.trial_ends_at as string })) return "upgrade";
  } catch (e) {
    console.error("aiModeFor: couldn't read the plan either:", e instanceof Error ? e.message : e);
  }
  return "off";
});
