/**
 * External CRM sync. YCAReach is the source of truth; adapters push pipeline
 * cards out as contacts + deals. HubSpot first (private app token), Salesforce
 * later behind the same interface. `fetch` is injected so adapters are testable.
 */

export type CrmContact = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
};

export type CrmDeal = {
  name: string;
  pipelineId: string;
  stageId: string;
  contactExternalId: string;
  /** Existing external deal id: update instead of create. */
  externalId?: string | null;
};

export type CrmPipeline = { id: string; label: string; stages: { id: string; label: string; closed: "won" | "lost" | null }[] };

export type CrmVerifyResult = { ok: true; accountLabel: string | null } | { ok: false; error: string };

export interface CrmAdapter {
  readonly provider: "hubspot";
  verify(): Promise<CrmVerifyResult>;
  listPipelines(): Promise<CrmPipeline[]>;
  /** Create or update by email; returns the external contact id. */
  upsertContact(c: CrmContact): Promise<string>;
  /** Create (associated with the contact) or update the stage; returns the external deal id. */
  upsertDeal(d: CrmDeal): Promise<string>;
}

export class CrmError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CrmError";
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

// ---------------------------------------------------------------------------
// HubSpot (CRM v3 API, private app access token)
// Scopes: crm.objects.contacts.read/write, crm.objects.deals.read/write
// ---------------------------------------------------------------------------

export const HUBSPOT_API_BASE = "https://api.hubapi.com";
/** HubSpot-defined association type: deal → contact. */
const DEAL_TO_CONTACT = 3;

type HubspotPipeline = { id: string; label: string; stages: { id: string; label: string; metadata?: { isClosed?: string; probability?: string } }[] };

export class HubspotAdapter implements CrmAdapter {
  readonly provider = "hubspot" as const;
  private readonly token: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(token: string, opts: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.token = token;
    this.base = (opts.baseUrl ?? HUBSPOT_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      let message = `HubSpot ${method} ${path} failed (${res.status})`;
      try {
        const j = (await res.json()) as { message?: string; category?: string };
        if (j.message) message = `HubSpot: ${j.message}`;
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 401) message = "HubSpot rejected the access token (invalid, expired or revoked).";
      if (res.status === 403) message = "The HubSpot token is missing a required scope (contacts + deals read/write).";
      throw new CrmError(message, res.status);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async verify(): Promise<CrmVerifyResult> {
    try {
      const info = await this.request<{ portalId?: number }>("GET", "/account-info/v3/details").catch((e: unknown) => {
        // account-info needs no extra scope on most tokens; fall back to a scoped call when it's unavailable.
        if (e instanceof CrmError && e.status === 404) return {} as { portalId?: number };
        throw e;
      });
      await this.listPipelines();
      return { ok: true, accountLabel: info.portalId ? `Portal ${info.portalId}` : null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async listPipelines(): Promise<CrmPipeline[]> {
    const r = await this.request<{ results: HubspotPipeline[] }>("GET", "/crm/v3/pipelines/deals");
    return r.results.map((p) => ({
      id: p.id,
      label: p.label,
      stages: p.stages.map((s) => ({
        id: s.id,
        label: s.label,
        closed: s.metadata?.isClosed === "true" ? (s.metadata.probability === "1.0" || s.metadata.probability === "1" ? "won" : "lost") : null,
      })),
    }));
  }

  async upsertContact(c: CrmContact): Promise<string> {
    const properties = Object.fromEntries(
      Object.entries({ email: c.email, firstname: c.firstName, lastname: c.lastName, company: c.company, jobtitle: c.title }).filter(([, v]) => v),
    );
    const r = await this.request<{ results: { id: string }[] }>("POST", "/crm/v3/objects/contacts/batch/upsert", {
      inputs: [{ idProperty: "email", id: c.email, properties }],
    });
    const id = r.results[0]?.id;
    if (!id) throw new CrmError("HubSpot returned no contact id", 502);
    return id;
  }

  async upsertDeal(d: CrmDeal): Promise<string> {
    if (d.externalId) {
      try {
        await this.request("PATCH", `/crm/v3/objects/deals/${encodeURIComponent(d.externalId)}`, {
          properties: { dealstage: d.stageId, pipeline: d.pipelineId },
        });
        return d.externalId;
      } catch (e) {
        // Deleted in HubSpot: create it again below.
        if (!(e instanceof CrmError && e.status === 404)) throw e;
      }
    }
    const r = await this.request<{ id: string }>("POST", "/crm/v3/objects/deals", {
      properties: { dealname: d.name, pipeline: d.pipelineId, dealstage: d.stageId },
      associations: [{ to: { id: d.contactExternalId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: DEAL_TO_CONTACT }] }],
    });
    return r.id;
  }
}

// ---------------------------------------------------------------------------
// Stage mapping
// ---------------------------------------------------------------------------

export type LocalStage = { id: string; name: string; kind: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Suggested mapping of our stages onto an external pipeline: same name first,
 * then won → the pipeline's won stage, lost → its lost stage, else its first
 * open stage.
 */
export function defaultStageMap(local: LocalStage[], pipeline: CrmPipeline): Record<string, string> {
  const map: Record<string, string> = {};
  const firstOpen = pipeline.stages.find((s) => !s.closed) ?? pipeline.stages[0];
  for (const st of local) {
    const byName = pipeline.stages.find((s) => norm(s.label) === norm(st.name));
    const byKind = st.kind === "won" || st.kind === "lost" ? pipeline.stages.find((s) => s.closed === st.kind) : undefined;
    const target = byName ?? byKind ?? firstOpen;
    if (target) map[st.id] = target.id;
  }
  return map;
}

export function dealName(c: { firstName: string | null; lastName: string | null; company: string | null; email: string }): string {
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return [c.company, person || c.email].filter(Boolean).join(" · ").slice(0, 200);
}
