import { cron } from "inngest";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAccount } from "@/lib/replies/process";
import { inngest } from "../client";
import { imapSyncRequested } from "../events";

/** Every 3 minutes: one sync job per active inbox. */
export const imapSyncTick = inngest.createFunction(
  { id: "imap-sync-tick", triggers: [cron("*/3 * * * *")], concurrency: [{ limit: 1, scope: "fn" }], retries: 0 },
  async ({ step }) => {
    const accounts = await step.run("list-inboxes", async () => {
      const { data, error } = await createAdminClient().from("sending_accounts").select("id, org_id").eq("status", "active");
      if (error) throw new Error(error.message);
      return data ?? [];
    });
    if (accounts.length) {
      await step.sendEvent(
        "fan-out",
        accounts.map((a) => imapSyncRequested.create({ orgId: a.org_id, accountId: a.id })),
      );
    }
    return { inboxes: accounts.length };
  },
);

/** Syncs one inbox. One at a time per inbox; replies are idempotent by Message-ID. */
export const imapSyncAccount = inngest.createFunction(
  {
    id: "imap-sync-account",
    triggers: [imapSyncRequested],
    concurrency: [{ key: "event.data.accountId", limit: 1 }],
    retries: 2,
  },
  async ({ event, step }) => step.run("sync", () => syncAccount(event.data.orgId, event.data.accountId)),
);
