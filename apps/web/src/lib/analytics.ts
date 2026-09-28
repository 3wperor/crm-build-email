import "server-only";
import { evaluateAbTest, type AbVerdict } from "@crm/core/analytics";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@crm/db";
import { createAdminClient } from "@/lib/supabase/admin";

type Client = SupabaseClient<Database>;

export type Metrics = {
  sent: number;
  bounced: number;
  opened: number;
  clicked: number;
  replied: number;
  positive: number;
  unsubscribed: number;
};

export type BreakdownRow = Metrics & {
  key: string | null;
  label: string;
  sub: string | null;
  step_id: string | null;
  step_order: number | null;
  is_active: boolean | null;
  is_winner: boolean | null;
};

export const EMPTY_METRICS: Metrics = { sent: 0, bounced: 0, opened: 0, clicked: 0, replied: 0, positive: 0, unsubscribed: 0 };

export async function loadBreakdown(
  client: Client,
  args: { orgId: string; group: "total" | "campaign" | "inbox" | "variant"; tz: string; days: number | null; campaignId?: string | null; accountId?: string | null },
): Promise<BreakdownRow[]> {
  const { data, error } = await client.rpc("analytics_breakdown", {
    p_org_id: args.orgId,
    p_group: args.group,
    p_tz: args.tz,
    // null = all time; the generated type can't express a nullable argument.
    p_days: args.days as number,
    ...(args.campaignId ? { p_campaign_id: args.campaignId } : {}),
    ...(args.accountId ? { p_account_id: args.accountId } : {}),
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BreakdownRow[];
}

export type VariantResult = {
  id: string;
  ab_group: string;
  is_active: boolean;
  is_winner: boolean;
  weight: number;
  metrics: Metrics;
};

export type StepResults = { stepId: string; stepOrder: number; variants: VariantResult[]; verdict: AbVerdict; winnerId: string | null };

type StepInput = { id: string; step_order: number; variants: { id: string; ab_group: string; is_active: boolean; is_winner: boolean; weight: number }[] };

/** Per-step A/B results for a campaign (all time). Only active variants take part in the test. */
export async function loadVariantResults(client: Client, orgId: string, campaignId: string, steps: StepInput[]): Promise<StepResults[]> {
  const rows = await loadBreakdown(client, { orgId, group: "variant", tz: "UTC", days: null, campaignId });
  const byVariant = new Map(rows.filter((r) => r.key).map((r) => [r.key!, r]));
  return steps.map((step) => {
    const variants = step.variants.map((v) => {
      const r = byVariant.get(v.id);
      return { ...v, metrics: r ? pickMetrics(r) : EMPTY_METRICS };
    });
    const arms = variants.filter((v) => v.is_active && v.weight > 0).map((v) => ({ id: v.id, label: v.ab_group, sent: v.metrics.sent, successes: v.metrics.replied }));
    const winner = variants.find((v) => v.is_winner && v.is_active && v.weight > 0);
    return { stepId: step.id, stepOrder: step.step_order, variants, verdict: evaluateAbTest(arms), winnerId: winner?.id ?? null };
  });
}

function pickMetrics(r: Metrics): Metrics {
  return {
    sent: Number(r.sent),
    bounced: Number(r.bounced),
    opened: Number(r.opened),
    clicked: Number(r.clicked),
    replied: Number(r.replied),
    positive: Number(r.positive),
    unsubscribed: Number(r.unsubscribed),
  };
}

/**
 * For active campaigns with auto-promote on: promote each step's significant
 * winner (only steps that don't have one yet). Returns what was promoted.
 */
export async function autoPromoteWinners(): Promise<{ campaignId: string; stepOrder: number; variant: string }[]> {
  const admin = createAdminClient();
  const { data: campaigns, error } = await admin
    .from("campaigns")
    .select("id, org_id, sequences(sequence_steps(id, step_order, email_variants(id, ab_group, is_active, is_winner, weight)))")
    .eq("status", "active")
    .eq("auto_promote_winner", true);
  if (error) throw new Error(error.message);

  const promoted: { campaignId: string; stepOrder: number; variant: string }[] = [];
  for (const c of campaigns ?? []) {
    const steps = (c.sequences[0]?.sequence_steps ?? []).map((s) => ({ id: s.id, step_order: s.step_order, variants: s.email_variants }));
    const results = await loadVariantResults(admin, c.org_id, c.id, steps);
    for (const step of results) {
      if (step.winnerId || step.verdict.status !== "winner") continue;
      const winnerId = step.verdict.winnerId;
      const { error: rpcError } = await admin.rpc("set_variant_winner", {
        p_org_id: c.org_id,
        p_step_id: step.stepId,
        p_variant_id: winnerId,
        p_reason: `auto-promoted: ${step.verdict.message}`,
        p_actor: "system:ab-auto-promote",
      });
      if (rpcError) throw new Error(rpcError.message);
      promoted.push({ campaignId: c.id, stepOrder: step.stepOrder, variant: step.variants.find((v) => v.id === winnerId)?.ab_group ?? "?" });
    }
  }
  return promoted;
}
