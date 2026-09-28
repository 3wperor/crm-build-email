"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { customKey } from "@crm/core/imports";
import { can as canDo } from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export type LeadFormState = { error?: string; message?: string } | undefined;

const optional = z.string().trim().max(500).optional().transform((v) => v || null);
const leadSchema = z.object({ first_name: optional, last_name: optional, company: optional, title: optional });

export async function updateLead(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const ctx = await getOrgContext();
  if (!canDo(ctx.role, "leads.write")) return { error: "You don't have permission to edit leads." };
  const leadId = String(formData.get("lead_id"));
  const parsed = leadSchema.safeParse(Object.fromEntries(["first_name", "last_name", "company", "title"].map((k) => [k, formData.get(k) ?? ""])));
  if (!parsed.success) return { error: "Values must be under 500 characters." };

  // Custom fields arrive as parallel custom_key[] / custom_value[] inputs; empty value = remove.
  const keys = formData.getAll("custom_key").map(String);
  const values = formData.getAll("custom_value").map(String);
  const custom: Record<string, string> = {};
  keys.forEach((k, i) => {
    const key = k.trim() ? customKey(k) : "";
    const value = (values[i] ?? "").trim().slice(0, 500);
    if (key && value) custom[key] = value;
  });
  if (Object.keys(custom).length > 100) return { error: "Too many custom fields (max 100)." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ ...parsed.data, custom_json: custom })
    .eq("org_id", ctx.org.id)
    .eq("id", leadId);
  if (error) return { error: error.message };
  revalidatePath(`/leads/${leadId}`);
  return { message: "Saved." };
}

export async function addNote(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const ctx = await getOrgContext();
  if (!canDo(ctx.role, "leads.write")) return { error: "You don't have permission to add notes." };
  const leadId = String(formData.get("lead_id"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Write something first." };
  if (body.length > 10000) return { error: "Notes are limited to 10,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.from("lead_notes").insert({ org_id: ctx.org.id, lead_id: leadId, user_id: ctx.user.id, body });
  if (error) return { error: error.message };
  revalidatePath(`/leads/${leadId}`);
  return { message: "Note added." };
}

export async function deleteNote(formData: FormData) {
  const ctx = await getOrgContext();
  const supabase = await createClient();
  // RLS: authors can delete their own notes; admins any.
  await supabase.from("lead_notes").delete().eq("org_id", ctx.org.id).eq("id", String(formData.get("note_id")));
  revalidatePath(`/leads/${String(formData.get("lead_id"))}`);
}

