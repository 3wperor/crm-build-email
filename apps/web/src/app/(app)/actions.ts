"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { can } from "@crm/core";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext, ORG_COOKIE } from "@/lib/org";

export async function switchOrganization(formData: FormData) {
  const orgId = String(formData.get("org_id") ?? "");
  const { orgs } = await getOrgContext();
  // Only accept orgs the user actually belongs to.
  if (!orgs.some((o) => o.org.id === orgId)) return;
  (await cookies()).set(ORG_COOKIE, orgId, { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

export type KillSwitchState = { error?: string } | undefined;

export async function setSendingPaused(_prev: KillSwitchState, formData: FormData): Promise<KillSwitchState> {
  const paused = formData.get("paused") === "true";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const { org, role } = await getOrgContext();

  if (!can(role, paused ? "sending.pause" : "sending.resume")) {
    return { error: paused ? "You don't have permission to pause sending." : "Only owners and admins can resume sending." };
  }

  // Authorization is re-checked (and the action audited) inside the RPC.
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sending_paused", {
    p_org_id: org.id,
    p_paused: paused,
    ...(reason ? { p_reason: reason } : {}),
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return undefined;
}
