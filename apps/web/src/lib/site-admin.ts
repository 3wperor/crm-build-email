import "server-only";

/**
 * People who run this YCAReach site (not workspace owners): they can see setup
 * diagnostics such as why included AI isn't answering. Set on Vercel:
 *   SITE_ADMIN_EMAILS=you@example.com,colleague@example.com
 */
export function isSiteAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.SITE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}
