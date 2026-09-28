import "server-only";
import { deriveHealth, type ConnectionTestResult, type Provider } from "@crm/core";
import { decryptSecret, encryptSecret, keyringFromEnv, type Keyring } from "@crm/core/crypto";
import { createMailAdapter, testConnection, type AdapterOptions, type MailAccountConfig } from "@crm/mail";
import { createAdminClient } from "@/lib/supabase/admin";

let keyring: Keyring | undefined;
function getKeyring(): Keyring {
  keyring ??= keyringFromEnv(process.env);
  return keyring;
}

/** Local-dev escape hatches (e.g. Mailpit on localhost). Ignored on Vercel production. */
export function mailAdapterOptions(): AdapterOptions {
  const prod = process.env.VERCEL_ENV === "production";
  return {
    timeoutMs: 10_000,
    allowPrivateHosts: !prod && process.env.MAIL_ALLOW_PRIVATE_HOSTS === "true",
    allowPlaintextAuth: !prod && process.env.MAIL_ALLOW_PLAINTEXT_AUTH === "true",
  };
}

export function encryptAccountPassword(accountId: string, password: string) {
  // AAD = account id: the ciphertext only decrypts for this row.
  return encryptSecret(password, accountId, getKeyring());
}

export type AccountRow = {
  id: string;
  org_id: string;
  provider: string;
  email: string;
  username: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
};

export function toMailConfig(row: AccountRow, password: string): MailAccountConfig {
  return {
    provider: row.provider as Provider,
    email: row.email,
    username: row.username,
    password,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure,
  };
}

/** Service-role read of the credential. Callers must have authorized access to the account first. */
export async function loadAccountPassword(orgId: string, accountId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sending_account_credentials")
    .select("ciphertext")
    .eq("org_id", orgId)
    .eq("account_id", accountId)
    .single();
  if (error || !data) throw new Error("Credential not found for this account");
  return decryptSecret(data.ciphertext, accountId, getKeyring());
}

export async function storeAccountPassword(orgId: string, accountId: string, password: string) {
  const { ciphertext, keyVersion } = encryptAccountPassword(accountId, password);
  const admin = createAdminClient();
  const { error } = await admin
    .from("sending_account_credentials")
    .upsert({ account_id: accountId, org_id: orgId, ciphertext, key_version: keyVersion });
  if (error) throw new Error(`Failed to store credential: ${error.message}`);
}

export async function runConnectionTest(config: MailAccountConfig): Promise<ConnectionTestResult> {
  return testConnection(createMailAdapter(config, mailAdapterOptions()));
}

/** Persists a test result as the account's health (service role: health is not client-writable). */
export async function recordHealth(orgId: string, accountId: string, result: ConnectionTestResult) {
  const { health, score, detail } = deriveHealth(result);
  const admin = createAdminClient();
  const { error } = await admin
    .from("sending_accounts")
    .update({ health, health_score: score, health_detail: detail, last_checked_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", accountId);
  if (error) throw new Error(`Failed to record health: ${error.message}`);
}

/** Loads credential, tests SMTP + IMAP, records health. */
export async function checkAccount(row: AccountRow): Promise<ConnectionTestResult> {
  const password = await loadAccountPassword(row.org_id, row.id);
  const result = await runConnectionTest(toMailConfig(row, password));
  await recordHealth(row.org_id, row.id, result);
  return result;
}

export const ACCOUNT_CONNECTION_COLUMNS =
  "id, org_id, provider, email, username, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure" as const;
