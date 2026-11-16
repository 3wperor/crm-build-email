import "server-only";
import { randomUUID } from "node:crypto";
import { monthlyAiCapMicros } from "@crm/core/ai";
import { hasProAccess, type Plan } from "@crm/core/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchema } from "@/lib/errors";
import { AI_MIGRATION_MISSING, callAi, includedConfig, loadOwnKey, ownKeyConfig, type AiConfig } from "./provider";

export type AiCheck = { label: string; status: "ok" | "warn" | "fail"; detail: string };

const PING = { system: "You are a connection test.", user: "Reply with the word OK.", maxTokens: 16, json: false, temperature: 0 } as const;

async function ping(config: AiConfig): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    await callAi(config, PING, 20_000);
    return { ok: true, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Walks every link the AI depends on and reports the real reason when one is
 * broken. For site admins only: it shows provider errors and spend that
 * customers never see.
 */
export async function runAiDiagnostics(orgId: string): Promise<AiCheck[]> {
  const admin = createAdminClient();
  const checks: AiCheck[] = [];

  // 1. Database: the tables, columns and functions added by migration 0017.
  const [usage, org, fn] = await Promise.all([
    admin.from("ai_usage").select("id", { count: "exact", head: true }).limit(1),
    admin.from("organizations").select("plan, trial_ends_at, ai_provider, ai_model, ai_base_url").eq("id", orgId).maybeSingle(),
    // Updates nothing (random id): only proves the function exists.
    admin.rpc("finish_ai_usage", { p_id: randomUUID(), p_status: "done", p_input_tokens: 0, p_output_tokens: 0, p_cost_micros: 0 }),
  ]);
  const dbProblem = [usage.error, org.error, fn.error].find(Boolean);
  checks.push(
    !dbProblem
      ? { label: "AI database update (0017)", status: "ok", detail: "Installed." }
      : {
          label: "AI database update (0017)",
          status: "fail",
          detail: isMissingSchema(dbProblem) ? AI_MIGRATION_MISSING : `The database returned an error: ${dbProblem.code ?? ""} ${dbProblem.message}`,
        },
  );

  // 2. The included AI key and settings on this deployment.
  const included = includedConfig();
  const keyName = process.env.DEEPSEEK_API_KEY ? "DEEPSEEK_API_KEY" : process.env.AI_API_KEY ? "AI_API_KEY" : null;
  checks.push(
    included
      ? { label: "Included AI key on the server", status: "ok", detail: `${keyName} is set. Model "${included.model}" at ${included.baseUrl}.` }
      : {
          label: "Included AI key on the server",
          status: "fail",
          detail:
            "No DEEPSEEK_API_KEY (or AI_API_KEY) on this deployment. Add it in Vercel → Settings → Environment Variables (tick Production), then redeploy.",
        },
  );

  // 3. Does the included provider actually answer?
  if (included) {
    const r = await ping(included);
    checks.push(
      r.ok
        ? { label: "Included AI answers", status: "ok", detail: `Answered in ${(r.ms / 1000).toFixed(1)}s.` }
        : { label: "Included AI answers", status: "fail", detail: `${r.error} Check the key, and that the account has credit (DeepSeek is pay-before-use).` },
    );
  }

  // 4. This workspace: plan, which AI it uses, and the hidden monthly allowance.
  const row = org.data;
  if (row) {
    const pro = hasProAccess({ plan: row.plan as Plan, trial_ends_at: row.trial_ends_at });
    checks.push({
      label: "This workspace's plan",
      status: pro ? "ok" : "fail",
      detail: pro ? `Plan "${row.plan}": AI is included.` : `Plan "${row.plan}" has no AI (only Pro and active trials do).`,
    });

    if (row.ai_provider === "anthropic" || row.ai_provider === "openai_compatible") {
      const key = await loadOwnKey(orgId);
      if (!key) {
        checks.push({
          label: "Workspace's own key",
          status: "warn",
          detail: "Set to use its own key, but none is saved (or it can't be decrypted), so the included AI is used instead.",
        });
      } else {
        const r = await ping(ownKeyConfig(row.ai_provider, key, row.ai_model, row.ai_base_url));
        checks.push(
          r.ok
            ? { label: "Workspace's own key", status: "ok", detail: `The ${row.ai_provider === "anthropic" ? "Claude" : "OpenAI-compatible"} key answers (${row.ai_model ?? "default model"}).` }
            : { label: "Workspace's own key", status: "fail", detail: r.error },
        );
      }
    }

    if (!dbProblem) {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const { data: rows } = await admin.from("ai_usage").select("cost_usd_micros, status").eq("org_id", orgId).eq("own_key", false).gte("created_at", monthStart);
      const spent = (rows ?? []).reduce((sum, r) => sum + Number(r.cost_usd_micros), 0);
      const cap = monthlyAiCapMicros(row, process.env);
      const failed = (rows ?? []).filter((r) => r.status === "failed").length;
      const usedUp = cap > 0 && spent >= cap;
      checks.push({
        label: "Included AI this month",
        status: usedUp ? "fail" : "ok",
        detail:
          `$${(spent / 1e6).toFixed(4)} of the hidden $${(cap / 1e6).toFixed(2)} allowance used across ${rows?.length ?? 0} calls` +
          `${failed ? ` (${failed} failed)` : ""}.${usedUp ? " The allowance is used up, so included AI stays off until the 1st." : ""}`,
      });
    }
  }
  return checks;
}
