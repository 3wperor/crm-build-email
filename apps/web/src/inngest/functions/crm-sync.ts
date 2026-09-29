import { cron } from "inngest";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncCrmConnection } from "@/lib/crm";
import { inngest } from "../client";
import { crmSyncRequested } from "../events";

/** Every 15 minutes: one sync job per connected CRM. */
export const crmSyncTick = inngest.createFunction(
  { id: "crm-sync-tick", triggers: [cron("*/15 * * * *")], concurrency: [{ limit: 1, scope: "fn" }], retries: 0 },
  async ({ step }) => {
    const conns = await step.run("list", async () => {
      const { data } = await createAdminClient().from("crm_connections").select("id").eq("status", "connected").not("pipeline_id", "is", null);
      return data ?? [];
    });
    if (conns.length) await step.sendEvent("fan-out", conns.map((c) => crmSyncRequested.create({ connectionId: c.id })));
    return { connections: conns.length };
  },
);

/** One connection at a time; rate limits / 5xx retry with backoff. */
export const crmSync = inngest.createFunction(
  { id: "crm-sync", triggers: [crmSyncRequested], concurrency: [{ key: "event.data.connectionId", limit: 1 }], retries: 4 },
  async ({ event, step }) => step.run("sync", () => syncCrmConnection(event.data.connectionId)),
);
