"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { welcomeAnswersSchema } from "@crm/core/onboarding";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export type WelcomeState = { error?: string } | undefined;

/** Saves the welcome answers (all optional) and goes to the dashboard checklist. */
export async function saveWelcome(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const ctx = await getOrgContext();
  const skip = formData.get("skip") === "1";
  const parsed = welcomeAnswersSchema.safeParse({
    offer: formData.get("offer") ?? "",
    audience: formData.get("audience") ?? "",
    provider: formData.get("provider") ?? "",
    hasList: formData.get("has_list") ?? "",
  });
  if (!parsed.success && !skip) return { error: "Please check your answers." };
  const a = parsed.success && !skip ? parsed.data : { offer: null, audience: null, provider: null, hasList: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      onboarding_offer: a.offer,
      onboarding_audience: a.audience,
      onboarding_provider: a.provider,
      onboarding_has_list: a.hasList,
      onboarding_answered_at: new Date().toISOString(),
    })
    .eq("id", ctx.org.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
