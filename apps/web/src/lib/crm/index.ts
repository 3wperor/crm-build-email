import "server-only";
import { CrmError, HubspotAdapter, dealName, type CrmAdapter } from "@crm/core";
import { decryptSecret, encryptSecret, keyringFromEnv } from "@crm/core/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** HUBSPOT_API_BASE points at a fake HubSpot in local tests; ignored in production. */
function hubspotBaseUrl(): string | undefined {
  return process.env.VERCEL_ENV === "production" ? undefined : process.env.HUBSPOT_API_BASE || undefined;
}

export function hubspotAdapter(token: string): CrmAdapter {
  return new HubspotAdapter(token, { baseUrl: hubspotBaseUrl() });
}

const keyring = () => keyringFromEnv(process.env);

// AAD = connection id: the ciphertext only decrypts for this connection.
export async function storeCrmToken(orgId: string, connectionId: string, token: string) {
  const { ciphertext, keyVersion } = encryptSecret(token, connectionId, keyring());
  const { error } = await createAdminClient().from("crm_credentials").upsert({ connection_id: connectionId, org_id: orgId, ciphertext, key_version: keyVersion });
  if (error) throw new Error(`Failed to store the token: ${error.message}`);
}

export async function loadCrmAdapter(connectionId: string): Promise<CrmAdapter> {
  const { data } = await createAdminClient().from("crm_credentials").select("ciphertext").eq("connection_id", connectionId).single();
  if (!data) throw new Error("No token stored for this connection");
  return hubspotAdapter(decryptSecret(data.ciphertext, connectionId, keyring()));
}

export type SyncSummary = { contacts: number; deals: number; skipped: number; error?: string };

const BATCH = 200;

/**
 * Push pipeline cards that are new to the CRM or changed since the last sync.
 * Auth/scope errors mark the connection as errored; rate limits and 5xx throw
 * so the job retries later (links already written make the retry cheap).
 */
export async function syncCrmConnection(connectionId: string): Promise<SyncSummary> {
  const admin = createAdminClient();
  const { data: conn } = await admin.from("crm_connections").select("id, org_id, status, pipeline_id, stage_map, last_synced_at").eq("id", connectionId).maybeSingle();
  if (!conn || conn.status === "disabled") return { contacts: 0, deals: 0, skipped: 0 };
  if (!conn.pipeline_id) return { contacts: 0, deals: 0, skipped: 0, error: "Choose a HubSpot pipeline first." };
  const stageMap = conn.stage_map as Record<string, string>;

  const { data: links } = await admin.from("crm_links").select("object, local_id, external_id").eq("connection_id", conn.id);
  const contactLink = new Map((links ?? []).filter((l) => l.object === "contact").map((l) => [l.local_id, l.external_id]));
  const dealLink = new Map((links ?? []).filter((l) => l.object === "deal").map((l) => [l.local_id, l.external_id]));

  const { data: opps } = await admin
    .from("opportunities")
    .select("id, stage_id, updated_at, leads!inner(id, email, first_name, last_name, company, title)")
    .eq("org_id", conn.org_id)
    .order("updated_at")
    .limit(5000);
  const since = conn.last_synced_at ? new Date(conn.last_synced_at).getTime() : 0;
  const due = (opps ?? []).filter((o) => !dealLink.has(o.id) || new Date(o.updated_at).getTime() > since).slice(0, BATCH);

  const adapter = await loadCrmAdapter(conn.id);
  const summary: SyncSummary = { contacts: 0, deals: 0, skipped: 0 };
  let watermark = conn.last_synced_at;
  try {
    for (const o of due) {
      const stage = stageMap[o.stage_id];
      if (!stage) {
        summary.skipped++;
        continue;
      }
      const lead = o.leads as unknown as { id: string; email: string; first_name: string | null; last_name: string | null; company: string | null; title: string | null };
      const contact = { email: lead.email, firstName: lead.first_name, lastName: lead.last_name, company: lead.company, title: lead.title };
      let contactId = contactLink.get(lead.id);
      if (!contactId) {
        contactId = await adapter.upsertContact(contact);
        await link(admin, conn, "contact", lead.id, contactId);
        contactLink.set(lead.id, contactId);
        summary.contacts++;
      }
      const dealId = await adapter.upsertDeal({ name: dealName(contact), pipelineId: conn.pipeline_id, stageId: stage, contactExternalId: contactId, externalId: dealLink.get(o.id) });
      await link(admin, conn, "deal", o.id, dealId);
      summary.deals++;
      if (!watermark || o.updated_at > watermark) watermark = o.updated_at;
    }
  } catch (e) {
    if (e instanceof CrmError && !e.retryable) {
      await admin.from("crm_connections").update({ status: "error", last_error: e.message }).eq("id", conn.id);
      return { ...summary, error: e.message };
    }
    // Keep progress, then let the job retry.
    if (watermark) await admin.from("crm_connections").update({ last_synced_at: watermark }).eq("id", conn.id);
    throw e;
  }
  await admin
    .from("crm_connections")
    .update({ status: "connected", last_error: null, last_synced_at: due.length === BATCH ? watermark : new Date().toISOString() })
    .eq("id", conn.id);
  return summary;
}

async function link(admin: Admin, conn: { id: string; org_id: string }, object: "contact" | "deal", localId: string, externalId: string) {
  const { error } = await admin
    .from("crm_links")
    .upsert({ org_id: conn.org_id, connection_id: conn.id, object, local_id: localId, external_id: externalId, synced_at: new Date().toISOString() }, { onConflict: "connection_id,object,local_id" });
  if (error) throw new Error(error.message);
}
