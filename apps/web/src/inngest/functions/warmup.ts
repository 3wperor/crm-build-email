import { cron } from "inngest";
import { planWarmup } from "@/lib/warmup/planner";
import { attemptWarmupSend } from "@/lib/warmup/sender";
import { inngest } from "../client";
import { warmupSendRequested, warmupTickRequested } from "../events";

const MAX_WAITS = 100;

/** Every 10 minutes: health checks + queue the next slice of warmup mail. */
export const warmupTick = inngest.createFunction(
  { id: "warmup-tick", triggers: [cron("*/10 * * * *"), warmupTickRequested], concurrency: [{ limit: 1, scope: "fn" }], retries: 1 },
  async ({ step }) => {
    const { planned, paused, stuck } = await step.run("plan", () => planWarmup());
    const all = [...planned, ...stuck];
    if (all.length) await step.sendEvent("dispatch", all.map((p) => warmupSendRequested.create(p)));
    return { planned: planned.length, paused: paused.length, redispatched: stuck.length };
  },
);

/** Sends one warmup email at its time. The database enforces pacing and caps shared with cold mail. */
export const warmupSend = inngest.createFunction(
  { id: "warmup-send", triggers: [warmupSendRequested], concurrency: [{ key: "event.data.accountId", limit: 1 }], retries: 2 },
  async ({ event, step }) => {
    await step.sleepUntil("scheduled", new Date(event.data.scheduledAt));
    for (let i = 0; i < MAX_WAITS; i++) {
      const r = await step.run(`attempt-${i}`, () => attemptWarmupSend(event.data.id));
      if (r.kind === "done") return r;
      await step.sleepUntil(`wait-${i}`, new Date(r.until));
    }
    return { kind: "done", outcome: "failed", detail: "gave up waiting for a slot" };
  },
);
