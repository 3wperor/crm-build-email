/**
 * Role model. Mirrors the RLS policies in supabase/migrations/*_rls.sql —
 * the database is the enforcement layer; this module lets the UI and the
 * MCP server make the same decision up front (and return a clean error).
 */
export const ROLES = ["owner", "admin", "sender", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  "org.read": ["owner", "admin", "sender", "viewer"],
  "org.update": ["owner", "admin"],
  "org.delete": ["owner"],
  "members.manage": ["owner"],
  "api_keys.manage": ["owner", "admin"],
  "sending_accounts.manage": ["owner", "admin"],
  "pipeline_stages.manage": ["owner", "admin"],
  "leads.write": ["owner", "admin", "sender"],
  "campaigns.write": ["owner", "admin", "sender"],
  "opportunities.write": ["owner", "admin", "sender"],
  "replies.classify": ["owner", "admin", "sender"],
  "suppression.add": ["owner", "admin", "sender"],
  "suppression.remove": ["owner", "admin"],
  // Kill switch: pausing is a safety action anyone who can send may take;
  // resuming is deliberate and restricted.
  "sending.pause": ["owner", "admin", "sender"],
  "sending.resume": ["owner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
