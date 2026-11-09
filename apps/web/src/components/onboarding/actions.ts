"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export async function dismissChecklist() {
  const ctx = await getOrgContext();
  const supabase = await createClient();
  await supabase.from("organizations").update({ checklist_dismissed_at: new Date().toISOString() }).eq("id", ctx.org.id);
  revalidatePath("/dashboard");
}
