import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const UPGRADE_MESSAGE = "Upgrade to start sending campaigns";

/** Whether the signed-in user has paid. Read through RLS (users can see their own row). */
export const isCurrentUserPaid = cache(async (userId: string): Promise<boolean> => {
  const supabase = await createClient();
  const { data } = await supabase.from("users").select("is_paid").eq("id", userId).maybeSingle();
  return data?.is_paid === true;
});

/** Same check for a user who isn't the caller (e.g. the creator of an agent API key). */
export async function isUserPaid(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data } = await createAdminClient().from("users").select("is_paid").eq("id", userId).maybeSingle();
  return data?.is_paid === true;
}

/**
 * Payment link with the user prefilled, or null when PAYMENT_LINK_URL isn't set.
 * client_reference_id lets you match the payment to the account in your payment dashboard.
 */
export function upgradeUrl(user: { id: string; email: string }): string | null {
  const base = process.env.PAYMENT_LINK_URL;
  if (!base) return null;
  try {
    const url = new URL(base);
    url.searchParams.set("client_reference_id", user.id);
    if (user.email) url.searchParams.set("prefilled_email", user.email);
    return url.toString();
  } catch {
    console.error("PAYMENT_LINK_URL is not a valid URL");
    return null;
  }
}
