import "server-only";
import { classifyEmail, emailDomain, isDomainCheckFresh, isValidEmailSyntax, type DomainCheck } from "@crm/core";
import { checkDomain, createResolver, isDisposableDomain, mapWithConcurrency } from "@crm/mail";
import { createAdminClient } from "@/lib/supabase/admin";

export const VERIFY_BATCH_SIZE = 250;
const DNS_CONCURRENCY = 20;

/**
 * Verifies the next batch of leads attached to a run. Leads are released from
 * the run as results are applied, so calling this repeatedly walks the run
 * without a cursor and retries are safe.
 */
export async function verifyNextBatch(orgId: string, runId: string): Promise<{ fetched: number; applied: number; lookups: number }> {
  const admin = createAdminClient();
  const { data: leads, error } = await admin
    .from("leads")
    .select("id, email")
    .eq("org_id", orgId)
    .eq("verification_run_id", runId)
    .order("id")
    .limit(VERIFY_BATCH_SIZE);
  if (error) throw new Error(error.message);
  if (!leads?.length) return { fetched: 0, applied: 0, lookups: 0 };

  // Only look up domains that could matter (valid syntax, not disposable).
  const domains = [
    ...new Set(
      leads
        .filter((l) => isValidEmailSyntax(l.email))
        .map((l) => emailDomain(l.email)!)
        .filter((d) => !isDisposableDomain(d)),
    ),
  ];

  const now = new Date();
  const checks = new Map<string, DomainCheck>();
  if (domains.length) {
    const { data: cached, error: cacheError } = await admin.from("domain_checks").select("*").in("domain", domains);
    if (cacheError) throw new Error(cacheError.message);
    for (const c of cached ?? []) {
      if (isDomainCheckFresh({ error: c.error, checkedAt: c.checked_at }, now)) {
        checks.set(c.domain, {
          domain: c.domain,
          mxHosts: c.mx_hosts,
          nullMx: c.null_mx,
          hasAddress: c.has_address,
          error: c.error as DomainCheck["error"],
        });
      }
    }
  }

  const missing = domains.filter((d) => !checks.has(d));
  if (missing.length) {
    const resolver = createResolver();
    const fresh = await mapWithConcurrency(missing, DNS_CONCURRENCY, (d) => checkDomain(d, resolver));
    for (const c of fresh) checks.set(c.domain, c);
    const { error: upsertError } = await admin.from("domain_checks").upsert(
      fresh.map((c) => ({
        domain: c.domain,
        mx_hosts: c.mxHosts,
        null_mx: c.nullMx,
        has_address: c.hasAddress,
        error: c.error,
        checked_at: now.toISOString(),
      })),
    );
    if (upsertError) throw new Error(upsertError.message);
  }

  const results = leads.map((l) => {
    const r = classifyEmail(l.email, checks.get(emailDomain(l.email) ?? "") ?? null, { isDisposable: isDisposableDomain, now });
    return { id: l.id, status: r.status, detail: r.detail };
  });

  const { data: applied, error: applyError } = await admin.rpc("apply_verification_results", {
    p_org_id: orgId,
    p_run_id: runId,
    p_results: results,
  });
  if (applyError) throw new Error(applyError.message);
  return { fetched: leads.length, applied: applied ?? 0, lookups: missing.length };
}
