"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { welcomeAnswersSchema } from "@crm/core/growth";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export type WelcomeState = { error?: string } | undefined;

/** Saves the welcome answers (all optional), then goes to the inbox setup or the dashboard. */
export async function saveWelcome(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const ctx = await getOrgContext();
  const skipAll = formData.get("skip") === "1";
  const parsed = welcomeAnswersSchema.safeParse({
    customerValue: formData.get("customer_value"),
    customersPerMonth: formData.get("customers_per_month"),
    channels: formData.getAll("channels"),
    offer: formData.get("offer"),
    audience: formData.get("audience"),
    hasList: formData.get("has_list"),
  });
  if (!parsed.success && !skipAll) return { error: "Please check your answers (amounts must be whole numbers)." };

  const supabase = await createClient();
  const now = new Date().toISOString();
  const update =
    skipAll || !parsed.success
      ? { onboarding_answered_at: now }
      : {
          goal_customer_value: parsed.data.customerValue,
          goal_customers_per_month: parsed.data.customersPerMonth,
          acquisition_channels: parsed.data.channels,
          onboarding_offer: parsed.data.offer,
          onboarding_audience: parsed.data.audience,
          onboarding_has_list: parsed.data.hasList,
          onboarding_answered_at: now,
        };
  const { error } = await supabase.from("organizations").update(update).eq("id", ctx.org.id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  redirect(formData.get("next") === "inbox" && !skipAll ? "/inboxes/new" : "/dashboard");
}
