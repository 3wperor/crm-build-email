import { createAdminClient } from "@/lib/supabase/admin";
import { verifyNextBatch } from "@/lib/verification/batch";
import { inngest } from "../client";
import { leadVerificationRequested } from "../events";

const MAX_BATCHES = 2000; // 500k leads at 250/batch — a runaway guard, not a product limit.

export const verifyLeads = inngest.createFunction(
  {
    id: "verify-leads",
    triggers: [leadVerificationRequested],
    retries: 3,
    // One run per org at a time; a few orgs in parallel. DNS lookups are
    // cheap and don't touch recipients' mail servers, but stay polite.
    concurrency: [
      { key: "event.data.orgId", limit: 1 },
      { limit: 5, scope: "fn" },
    ],
    onFailure: async ({ event, error }) => {
      const { orgId, runId } = event.data.event.data as { orgId: string; runId: string };
      const admin = createAdminClient();
      // Release unfinished leads so they can be verified again later.
      await admin
        .from("leads")
        .update({ verification_status: "unverified", verification_run_id: null })
        .eq("org_id", orgId)
        .eq("verification_run_id", runId);
      await admin
        .from("verification_runs")
        .update({ status: "failed", error: error.message.slice(0, 500), completed_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("id", runId);
    },
  },
  async ({ event, step }) => {
    const { orgId, runId } = event.data;

    await step.run("start", async () => {
      await createAdminClient().from("verification_runs").update({ status: "running" }).eq("org_id", orgId).eq("id", runId);
    });

    let verified = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const batch = await step.run(`batch-${i}`, () => verifyNextBatch(orgId, runId));
      if (batch.fetched === 0) break;
      // Every fetched lead gets a result; if none applied, something is wrong — fail loudly instead of looping.
      if (batch.applied === 0) throw new Error(`Batch ${i}: ${batch.fetched} leads fetched but none updated`);
      verified += batch.applied;
    }

    await step.run("finish", async () => {
      await createAdminClient()
        .from("verification_runs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("id", runId);
    });
    return { verified };
  },
);
