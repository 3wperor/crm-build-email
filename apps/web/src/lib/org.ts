import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isRole, type Role } from "@crm/core";
import { createClient } from "@/lib/supabase/server";

export const ORG_COOKIE = "crm_org";

export type OrgSummary = {
  id: string;
  name: string;
  approval_mode: string;
  default_timezone: string;
  sending_paused: boolean;
  sending_paused_at: string | null;
  sending_paused_by: string | null;
  sending_paused_reason: string | null;
};

export type OrgContext = {
  user: { id: string; email: string };
  org: OrgSummary;
  role: Role;
  orgs: { org: OrgSummary; role: Role }[];
};

/**
 * Resolves the signed-in user and their active organization for this request.
 * The active org comes from a cookie but is always validated against the
 * user's memberships — the cookie is a preference, never an authorization.
 * Redirects to /login or /onboarding when there is nothing to show.
 */
export const getOrgContext = cache(async (): Promise<OrgContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("memberships")
    .select(
      "role, organizations!inner(id, name, approval_mode, default_timezone, sending_paused, sending_paused_at, sending_paused_by, sending_paused_reason)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load memberships: ${error.message}`);

  const orgs = (data ?? []).flatMap((m) =>
    m.organizations && isRole(m.role) ? [{ org: m.organizations as OrgSummary, role: m.role }] : [],
  );
  if (orgs.length === 0) redirect("/onboarding");

  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const active = orgs.find((o) => o.org.id === preferred) ?? orgs[0]!;

  return { user: { id: user.id, email: user.email ?? "" }, org: active.org, role: active.role, orgs };
});
