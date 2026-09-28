import { eventType } from "inngest";
import { z } from "zod";

export const leadImportRequested = eventType("leads/import.requested", {
  schema: z.object({ orgId: z.string().uuid(), importId: z.string().uuid() }),
});

export const leadVerificationRequested = eventType("leads/verify.requested", {
  schema: z.object({ orgId: z.string().uuid(), runId: z.string().uuid() }),
});

/** Ask the planner to run now (e.g. right after a campaign starts) instead of waiting for the cron. */
export const schedulerTickRequested = eventType("scheduler/tick.requested", {
  schema: z.object({ reason: z.string().optional() }),
});

export const emailSendRequested = eventType("email/send.requested", {
  schema: z.object({ orgId: z.string().uuid(), sendId: z.string().uuid(), accountId: z.string().uuid() }),
});

export const imapSyncRequested = eventType("imap/sync.requested", {
  schema: z.object({ orgId: z.string().uuid(), accountId: z.string().uuid() }),
});
