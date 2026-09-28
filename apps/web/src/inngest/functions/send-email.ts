import { attemptSend } from "@/lib/scheduler/sender";
import { inngest } from "../client";
import { emailSendRequested } from "../events";

const MAX_WAITS = 200; // pacing waits per send (a full inbox queue at 3–7 min gaps)

/**
 * Delivers one scheduled send. One at a time per inbox (concurrency key), and
 * durable sleeps for pacing: the DB decides when the inbox is next free.
 */
export const sendEmail = inngest.createFunction(
  {
    id: "send-email",
    triggers: [emailSendRequested],
    concurrency: [{ key: "event.data.accountId", limit: 1 }],
    retries: 3,
  },
  async ({ event, step }) => {
    const { orgId, sendId } = event.data;
    for (let i = 0; i < MAX_WAITS; i++) {
      const result = await step.run(`attempt-${i}`, () => attemptSend(orgId, sendId));
      if (result.kind === "done") return result;
      await step.sleepUntil(`wait-${i}`, new Date(result.until));
    }
    return { kind: "done", outcome: "failed", detail: "gave up waiting for a send slot" };
  },
);
