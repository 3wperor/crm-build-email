import { eventType } from "inngest";
import { z } from "zod";

export const leadImportRequested = eventType("leads/import.requested", {
  schema: z.object({ orgId: z.string().uuid(), importId: z.string().uuid() }),
});

export const leadVerificationRequested = eventType("leads/verify.requested", {
  schema: z.object({ orgId: z.string().uuid(), runId: z.string().uuid() }),
});
