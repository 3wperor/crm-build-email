/**
 * Who runs YCAReach and how to reach them, for the homepage, Privacy Policy and
 * Terms. Set on Vercel so personal details never live in the code:
 *   LEGAL_ENTITY_NAME    e.g. "Jane Smith trading as YCAReach" or "YCA Ltd (company no. 12345678)"
 *   LEGAL_CONTACT_EMAIL  e.g. hello@yourbrand.com (falls back to SYSTEM_EMAIL_ADDRESS)
 */
export const LEGAL_LAST_UPDATED = "10 November 2026";

export function legalEntity(): string {
  return process.env.LEGAL_ENTITY_NAME?.trim() || "YCAReach";
}

export function legalContact(): string | null {
  return process.env.LEGAL_CONTACT_EMAIL?.trim() || process.env.SYSTEM_EMAIL_ADDRESS?.trim() || null;
}

export function legalEntityConfigured(): boolean {
  return !!process.env.LEGAL_ENTITY_NAME?.trim();
}
