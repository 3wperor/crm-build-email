import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { API_KEY_PREFIX, looksLikeApiKey } from "@crm/core";
import { createAdminClient } from "@/lib/supabase/admin";

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** A new key: shown to the user once; only its SHA-256 hash is stored. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export type ApiKeyContext = { apiKeyId: string; orgId: string; name: string };

/** Resolves "Authorization: Bearer ycr_…" to its workspace. Revoked or unknown keys → null. */
export async function authenticateApiKey(header: string | null): Promise<ApiKeyContext | null> {
  const key = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!key || !looksLikeApiKey(key)) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("api_keys").select("id, org_id, name, revoked_at").eq("key_hash", hashApiKey(key)).maybeSingle();
  if (!data || data.revoked_at) return null;
  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { apiKeyId: data.id, orgId: data.org_id, name: data.name };
}
