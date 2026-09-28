/** Canonical form used everywhere emails are stored or compared. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Pragmatic syntax check (not full RFC 5322): one @, non-empty local part,
// dotted domain with a 2+ char TLD, no whitespace.
const EMAIL_RE = /^[^\s@"(),:;<>[\\\]]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function isValidEmailSyntax(email: string): boolean {
  const e = normalizeEmail(email);
  if (e.length > 254) return false;
  const local = e.split("@")[0] ?? "";
  if (local.length === 0 || local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return EMAIL_RE.test(e);
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at === -1 ? null : normalizeEmail(email.slice(at + 1));
}
