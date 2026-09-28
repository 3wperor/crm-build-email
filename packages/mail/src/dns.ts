import { Resolver } from "node:dns/promises";
import { disposableEmailBlocklistSet } from "disposable-email-domains-js";
import type { DomainCheck } from "@crm/core";

type MxRecord = { exchange: string; priority: number };

/** Subset of node:dns Resolver we use — injectable for tests. */
export interface DnsResolver {
  resolveMx(domain: string): Promise<MxRecord[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

export function createResolver(opts: { timeoutMs?: number; tries?: number } = {}): DnsResolver {
  return new Resolver({ timeout: opts.timeoutMs ?? 3000, tries: opts.tries ?? 2 });
}

const code = (e: unknown) => (e as { code?: string })?.code ?? "";
const TEMPORARY = new Set(["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED", "EREFUSED", "ECANCELLED", "EAI_AGAIN", "ECONNRESET"]);

async function hasAddress(resolver: DnsResolver, domain: string): Promise<boolean | "temporary"> {
  const results = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
  if (results.some((r) => r.status === "fulfilled" && r.value.length > 0)) return true;
  if (results.some((r) => r.status === "rejected" && TEMPORARY.has(code(r.reason)))) return "temporary";
  return false;
}

/** Looks up how (and whether) a domain receives mail. Never throws. */
export async function checkDomain(domain: string, resolver: DnsResolver = createResolver()): Promise<DomainCheck> {
  const base: DomainCheck = { domain, mxHosts: [], nullMx: false, hasAddress: false, error: null };
  try {
    const records = await resolver.resolveMx(domain);
    const hosts = records
      .map((r) => ({ host: r.exchange.trim().toLowerCase().replace(/\.$/, ""), priority: r.priority }))
      .sort((a, b) => a.priority - b.priority);
    // RFC 7505: a single MX with an empty target means "this domain accepts no mail".
    if (hosts.length === 1 && hosts[0]!.host === "") return { ...base, nullMx: true };
    const mxHosts = hosts.map((h) => h.host).filter(Boolean);
    if (mxHosts.length > 0) return { ...base, mxHosts };
  } catch (e) {
    const c = code(e);
    if (c === "ENOTFOUND") return { ...base, error: "nxdomain" };
    if (TEMPORARY.has(c)) return { ...base, error: "temporary" };
    // ENODATA etc: the domain exists but has no MX → fall through to the A/AAAA check.
  }
  const addr = await hasAddress(resolver, domain);
  if (addr === "temporary") return { ...base, error: "temporary" };
  return { ...base, hasAddress: addr };
}

let disposable: Set<string> | undefined;

/** Community-maintained disposable-domain blocklist (also matches subdomains of listed domains). */
export function isDisposableDomain(domain: string): boolean {
  disposable ??= disposableEmailBlocklistSet();
  const d = domain.trim().toLowerCase();
  if (disposable.has(d)) return true;
  const parts = d.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    if (disposable.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

/** Runs `fn` over items with at most `limit` in flight. Preserves order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
