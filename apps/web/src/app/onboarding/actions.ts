"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE } from "@/lib/org";

export type OnboardingState = { error?: string } | undefined;

export async function createOrganization(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120) return { error: "Workspace name must be 1–120 characters." };

  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("create_organization", { p_name: name });
  if (error || !orgId) return { error: error?.message ?? "Could not create workspace." };

  (await cookies()).set(ORG_COOKIE, orgId, { path: "/", httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}
