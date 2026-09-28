"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  can,
  passwordRotationSchema,
  resolveAccountConfig,
  sendingAccountInputSchema,
  sendingAccountUpdateSchema,
  type ConnectionTestResult,
} from "@crm/core";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldErrors, formToObject, type FieldErrors } from "@/lib/forms";
import {
  ACCOUNT_CONNECTION_COLUMNS,
  checkAccount,
  recordHealth,
  runConnectionTest,
  storeAccountPassword,
  type AccountRow,
} from "@/lib/sending-accounts";

export type AccountFormState =
  | { error?: string; fieldErrors?: FieldErrors; test?: ConnectionTestResult; saved?: boolean }
  | undefined;

const FORBIDDEN = { error: "Only owners and admins can manage sending accounts." };

async function requireManager() {
  const ctx = await getOrgContext();
  return can(ctx.role, "sending_accounts.manage") ? ctx : null;
}

/** Tests a not-yet-saved account. Nothing is persisted. */
export async function testNewAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  // Role check also stops non-admins using the server as a network probe.
  if (!(await requireManager())) return FORBIDDEN;

  const parsed = sendingAccountInputSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: "Fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const cfg = resolveAccountConfig(parsed.data);
  return { test: await runConnectionTest(cfg) };
}

export async function createAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const ctx = await requireManager();
  if (!ctx) return FORBIDDEN;

  const parsed = sendingAccountInputSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: "Fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const cfg = resolveAccountConfig(parsed.data);

  // Insert as the user so RLS + column grants apply.
  const supabase = await createClient();
  const { data: account, error } = await supabase
    .from("sending_accounts")
    .insert({
      org_id: ctx.org.id,
      email: cfg.email,
      display_name: cfg.displayName,
      provider: cfg.provider,
      username: cfg.username,
      smtp_host: cfg.smtpHost,
      smtp_port: cfg.smtpPort,
      smtp_secure: cfg.smtpSecure,
      imap_host: cfg.imapHost,
      imap_port: cfg.imapPort,
      imap_secure: cfg.imapSecure,
      daily_cap: cfg.dailyCap,
      timezone: cfg.timezone,
    })
    .select("id")
    .single();

  if (error || !account) {
    if (error?.code === "23505") return { error: `${cfg.email} is already connected.`, fieldErrors: { email: ["Already connected"] } };
    return { error: error?.message ?? "Could not save the account." };
  }

  try {
    await storeAccountPassword(ctx.org.id, account.id, cfg.password);
  } catch (e) {
    // Don't leave an account without credentials behind.
    await createAdminClient().from("sending_accounts").delete().eq("org_id", ctx.org.id).eq("id", account.id);
    return { error: e instanceof Error ? e.message : "Could not store the credential." };
  }

  const test = await runConnectionTest(cfg);
  await recordHealth(ctx.org.id, account.id, test);

  revalidatePath("/inboxes");
  redirect(`/inboxes/${account.id}?created=1`);
}

async function loadAccount(orgId: string, accountId: string): Promise<AccountRow | null> {
  // User-scoped read: RLS proves the account belongs to an org the user is in.
  const supabase = await createClient();
  const { data } = await supabase
    .from("sending_accounts")
    .select(ACCOUNT_CONNECTION_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", accountId)
    .maybeSingle();
  return data;
}

export async function retestAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const ctx = await requireManager();
  if (!ctx) return FORBIDDEN;
  const account = await loadAccount(ctx.org.id, String(formData.get("account_id")));
  if (!account) return { error: "Account not found." };

  try {
    const test = await checkAccount(account);
    revalidatePath("/inboxes");
    revalidatePath(`/inboxes/${account.id}`);
    return { test };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Connection test failed." };
  }
}

export async function updateAccount(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const ctx = await requireManager();
  if (!ctx) return FORBIDDEN;
  const accountId = String(formData.get("account_id"));

  const parsed = sendingAccountUpdateSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: "Fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sending_accounts")
    .update({
      display_name: parsed.data.displayName,
      daily_cap: parsed.data.dailyCap,
      timezone: parsed.data.timezone,
      status: parsed.data.status,
    })
    .eq("org_id", ctx.org.id)
    .eq("id", accountId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Account not found." };

  revalidatePath("/inboxes");
  revalidatePath(`/inboxes/${accountId}`);
  return { saved: true };
}

export async function rotatePassword(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const ctx = await requireManager();
  if (!ctx) return FORBIDDEN;
  const account = await loadAccount(ctx.org.id, String(formData.get("account_id")));
  if (!account) return { error: "Account not found." };

  const parsed = passwordRotationSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: "Enter the new app password.", fieldErrors: fieldErrors(parsed.error) };

  await storeAccountPassword(ctx.org.id, account.id, parsed.data.password);
  // Reconnecting a disconnected account re-activates it.
  await createAdminClient()
    .from("sending_accounts")
    .update({ status: "active" })
    .eq("org_id", ctx.org.id)
    .eq("id", account.id)
    .eq("status", "disconnected");

  const test = await checkAccount(account);
  revalidatePath("/inboxes");
  revalidatePath(`/inboxes/${account.id}`);
  return { saved: true, test };
}

export async function deleteAccount(formData: FormData) {
  const ctx = await requireManager();
  if (!ctx) return;
  const supabase = await createClient();
  // Credentials cascade via FK. Historical sends keep their rows (sending_account_id → NULL).
  await supabase.from("sending_accounts").delete().eq("org_id", ctx.org.id).eq("id", String(formData.get("account_id")));
  revalidatePath("/inboxes");
  redirect("/inboxes");
}
