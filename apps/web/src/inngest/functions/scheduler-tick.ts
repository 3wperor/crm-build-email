import { cron } from "inngest";
import { planAll } from "@/lib/scheduler/planner";
import { inngest } from "../client";
import { emailSendRequested, schedulerTickRequested } from "../events";

/**
 * The planner: every minute (or on demand), turn due enrollments into
 * scheduled sends and hand each to `send-email`. Single-flight so two ticks
 * never plan the same campaign concurrently.
 */
export const schedulerTick = inngest.createFunction(
  {
    id: "scheduler-tick",
    triggers: [cron("* * * * *"), schedulerTickRequested],
    concurrency: [{ limit: 1, scope: "fn" }],
    retries: 1,
  },
  async ({ step }) => {
    const plan = await step.run("plan", () => planAll());
    if (plan.requests.length) {
      await step.sendEvent(
        "dispatch-sends",
        plan.requests.map((r) => emailSendRequested.create(r, { id: `send-${r.sendId}` })),
      );
    }
    return { campaigns: plan.campaigns, scheduled: plan.requests.length };
  },
);
