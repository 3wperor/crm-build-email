import { isValidEmailSyntax, normalizeEmail } from "./email";

/**
 * Email verification (Phase 4: DNS level).
 *
 * Without an SMTP RCPT probe (needs outbound port 25, which serverless hosts
 * block) we cannot tell whether a specific mailbox exists or whether the
 * domain is catch-all. So a pass here means "the domain can receive mail",
 * recorded as `detail.level = "mx"`. A future RCPT prober upgrades the level
 * to "smtp" through the `EmailProber` interface without schema changes.
 */

export type VerificationStatus = "valid" | "invalid" | "risky" | "unknown";

export type VerificationReason =
  | "syntax"
  | "disposable"
  | "domain_not_found"
  | "null_mx"
  | "no_mail_server"
  | "implicit_mx"
  | "role_account"
  | "dns_error"
  | "mailbox_not_found"
  | "catch_all";

export const VERIFICATION_REASON_LABELS: Record<VerificationReason, string> = {
  syntax: "Invalid email syntax",
  disposable: "Disposable / throwaway email domain",
  domain_not_found: "Domain does not exist",
  null_mx: "Domain explicitly accepts no email (null MX)",
  no_mail_server: "Domain has no mail server",
  implicit_mx: "No MX record; mail would go to the domain's A record",
  role_account: "Role address (info@, sales@…) — rarely a real person",
  dns_error: "DNS lookup failed; will retry",
  mailbox_not_found: "Mail server rejected the mailbox",
  catch_all: "Domain accepts all addresses (catch-all)",
};

/** Result of looking up a domain's mail setup. Cached per domain. */
export type DomainCheck = {
  domain: string;
  /** MX hosts ordered by priority (lowest first). Empty = no MX records. */
  mxHosts: string[];
  /** RFC 7505 null MX ("MX 0 ."): the domain accepts no mail. */
  nullMx: boolean;
  /** Has an A/AAAA record (implicit MX per RFC 5321 §5.1). Only checked when there is no MX. */
  hasAddress: boolean;
  /** Lookup failure: NXDOMAIN is definitive; temporary failures are not. */
  error: "nxdomain" | "temporary" | null;
};

export type VerificationDetail = {
  level: "syntax" | "dns" | "mx" | "smtp";
  reasons: VerificationReason[];
  domain: string | null;
  mx: string[];
  checkedAt: string;
};

export type VerificationResult = { status: VerificationStatus; detail: VerificationDetail };

/** Optional mailbox-level prober (SMTP RCPT). Not implemented in v1. */
export interface EmailProber {
  probe(email: string, domain: DomainCheck): Promise<{ status: "exists" | "not_found" | "catch_all" | "unknown" } | null>;
}

export const DOMAIN_CHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Temporary DNS failures are retried much sooner. */
export const DOMAIN_CHECK_ERROR_TTL_MS = 60 * 60 * 1000;

export function isDomainCheckFresh(check: { error: string | null; checkedAt: string | Date }, now: Date): boolean {
  const age = now.getTime() - new Date(check.checkedAt).getTime();
  return age < (check.error === "temporary" ? DOMAIN_CHECK_ERROR_TTL_MS : DOMAIN_CHECK_TTL_MS);
}

const ROLE_LOCAL_PARTS = new Set([
  "abuse", "accounting", "accounts", "admin", "administrator", "billing", "careers", "contact", "contactus",
  "customerservice", "enquiries", "enquiry", "feedback", "hello", "help", "helpdesk", "hr", "info", "inquiries",
  "inquiry", "jobs", "legal", "mail", "marketing", "media", "no-reply", "noreply", "office", "orders", "postmaster",
  "press", "privacy", "recruiting", "sales", "security", "service", "support", "team", "webmaster",
]);

export function isRoleAccount(email: string): boolean {
  const local = normalizeEmail(email).split("@")[0] ?? "";
  // Ignore +tags: "sales+eu@" is still a role address.
  return ROLE_LOCAL_PARTS.has(local.split("+")[0]!);
}

/**
 * Pure classification. Order matters: definitive failures first, then
 * soft signals.
 */
export function classifyEmail(
  rawEmail: string,
  domainCheck: DomainCheck | null,
  opts: { isDisposable: (domain: string) => boolean; now?: Date },
): VerificationResult {
  const checkedAt = (opts.now ?? new Date()).toISOString();
  const email = normalizeEmail(rawEmail);
  const detail = (level: VerificationDetail["level"], reasons: VerificationReason[]): VerificationDetail => ({
    level,
    reasons,
    domain: domainCheck?.domain ?? email.split("@")[1] ?? null,
    mx: domainCheck?.mxHosts.slice(0, 5) ?? [],
    checkedAt,
  });

  if (!isValidEmailSyntax(email)) return { status: "invalid", detail: detail("syntax", ["syntax"]) };
  const domain = email.split("@")[1]!;
  // Throwaway inboxes are never worth a cold email and hurt sender reputation.
  if (opts.isDisposable(domain)) return { status: "invalid", detail: detail("syntax", ["disposable"]) };
  if (!domainCheck) return { status: "unknown", detail: detail("syntax", ["dns_error"]) };

  if (domainCheck.error === "nxdomain") return { status: "invalid", detail: detail("dns", ["domain_not_found"]) };
  if (domainCheck.error === "temporary") return { status: "unknown", detail: detail("dns", ["dns_error"]) };
  if (domainCheck.nullMx) return { status: "invalid", detail: detail("dns", ["null_mx"]) };
  if (domainCheck.mxHosts.length === 0) {
    return domainCheck.hasAddress
      ? { status: "risky", detail: detail("dns", ["implicit_mx"]) }
      : { status: "invalid", detail: detail("dns", ["no_mail_server"]) };
  }

  if (isRoleAccount(email)) return { status: "risky", detail: detail("mx", ["role_account"]) };
  return { status: "valid", detail: detail("mx", []) };
}

/** Lead statuses the send path must refuse. `unknown`/`unverified` are allowed; `risky` is a campaign option (Phase 5). */
export function isSendableVerification(status: string): boolean {
  return status !== "invalid";
}
