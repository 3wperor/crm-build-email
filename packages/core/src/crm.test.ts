import { describe, expect, it } from "vitest";
import { CrmError, HubspotAdapter, dealName, defaultStageMap, type CrmPipeline } from "./crm";

type Call = { method: string; url: string; body: unknown; auth: string | undefined };

function fakeHubspot(handler: (c: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const call = { method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>).authorization };
    calls.push(call);
    const r = handler(call);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, adapter: new HubspotAdapter("pat-123", { baseUrl: "https://hs.test/", fetch: f }) };
}

const PIPELINES = {
  results: [
    {
      id: "default",
      label: "Sales Pipeline",
      stages: [
        { id: "appointmentscheduled", label: "Appointment Scheduled", metadata: { isClosed: "false", probability: "0.2" } },
        { id: "qualifiedtobuy", label: "Interested", metadata: { isClosed: "false", probability: "0.4" } },
        { id: "closedwon", label: "Closed Won", metadata: { isClosed: "true", probability: "1.0" } },
        { id: "closedlost", label: "Closed Lost", metadata: { isClosed: "true", probability: "0.0" } },
      ],
    },
  ],
};

describe("HubspotAdapter", () => {
  it("verifies the token and reads pipelines with won/lost stages", async () => {
    const { adapter, calls } = fakeHubspot((c) => (c.url.endsWith("/account-info/v3/details") ? { json: { portalId: 4242 } } : { json: PIPELINES }));
    expect(await adapter.verify()).toEqual({ ok: true, accountLabel: "Portal 4242" });
    expect(calls.every((c) => c.auth === "Bearer pat-123")).toBe(true);
    const [p] = await adapter.listPipelines();
    expect(p!.stages.map((s) => s.closed)).toEqual([null, null, "won", "lost"]);
  });

  it("explains a bad token or missing scope", async () => {
    expect(await fakeHubspot(() => ({ status: 401, json: { message: "expired" } })).adapter.verify()).toEqual({
      ok: false,
      error: "HubSpot rejected the access token (invalid, expired or revoked).",
    });
    const scoped = fakeHubspot((c) => (c.url.includes("account-info") ? { json: {} } : { status: 403, json: {} }));
    expect(await scoped.adapter.verify()).toMatchObject({ ok: false, error: expect.stringContaining("scope") });
  });

  it("upserts contacts by email", async () => {
    const { adapter, calls } = fakeHubspot(() => ({ json: { results: [{ id: "901" }] } }));
    const id = await adapter.upsertContact({ email: "ada@x.io", firstName: "Ada", lastName: null, company: "Engines", title: null });
    expect(id).toBe("901");
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "https://hs.test/crm/v3/objects/contacts/batch/upsert",
      body: { inputs: [{ idProperty: "email", id: "ada@x.io", properties: { email: "ada@x.io", firstname: "Ada", company: "Engines" } }] },
    });
  });

  it("creates a deal associated with the contact, then updates its stage", async () => {
    const { adapter, calls } = fakeHubspot((c) => (c.method === "POST" ? { json: { id: "d1" } } : { json: { id: "d1" } }));
    expect(await adapter.upsertDeal({ name: "Engines · Ada", pipelineId: "default", stageId: "qualifiedtobuy", contactExternalId: "901" })).toBe("d1");
    expect(calls[0]!.body).toMatchObject({
      properties: { dealname: "Engines · Ada", pipeline: "default", dealstage: "qualifiedtobuy" },
      associations: [{ to: { id: "901" }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }],
    });
    expect(await adapter.upsertDeal({ name: "x", pipelineId: "default", stageId: "closedwon", contactExternalId: "901", externalId: "d1" })).toBe("d1");
    expect(calls[1]).toMatchObject({ method: "PATCH", url: "https://hs.test/crm/v3/objects/deals/d1", body: { properties: { dealstage: "closedwon" } } });
  });

  it("re-creates a deal that was deleted in HubSpot", async () => {
    const { adapter, calls } = fakeHubspot((c) => (c.method === "PATCH" ? { status: 404, json: { message: "not found" } } : { json: { id: "d2" } }));
    expect(await adapter.upsertDeal({ name: "x", pipelineId: "default", stageId: "closedwon", contactExternalId: "901", externalId: "gone" })).toBe("d2");
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
  });

  it("marks rate limits and server errors retryable", async () => {
    const { adapter } = fakeHubspot(() => ({ status: 429, json: { message: "You have reached your secondly limit." } }));
    const err = await adapter.upsertContact({ email: "a@b.co", firstName: null, lastName: null, company: null, title: null }).catch((e) => e);
    expect(err).toBeInstanceOf(CrmError);
    expect(err).toMatchObject({ status: 429, retryable: true, message: "HubSpot: You have reached your secondly limit." });
  });
});

describe("defaultStageMap / dealName", () => {
  const pipeline: CrmPipeline = {
    id: "default",
    label: "Sales",
    stages: [
      { id: "appt", label: "Appointment Scheduled", closed: null },
      { id: "int", label: "Interested", closed: null },
      { id: "won", label: "Closed Won", closed: "won" },
      { id: "lost", label: "Closed Lost", closed: "lost" },
    ],
  };
  it("maps by name, then won/lost kind, then the first open stage", () => {
    const map = defaultStageMap(
      [
        { id: "s1", name: "Replied", kind: "open" },
        { id: "s2", name: "interested", kind: "open" },
        { id: "s3", name: "Won!", kind: "won" },
        { id: "s4", name: "Dead", kind: "lost" },
      ],
      pipeline,
    );
    expect(map).toEqual({ s1: "appt", s2: "int", s3: "won", s4: "lost" });
  });
  it("names deals by company and person", () => {
    expect(dealName({ firstName: "Ada", lastName: "Lovelace", company: "Engines", email: "a@x" })).toBe("Engines · Ada Lovelace");
    expect(dealName({ firstName: null, lastName: null, company: null, email: "a@x" })).toBe("a@x");
  });
});
