import { cron } from "inngest";
import { autoPromoteWinners } from "@/lib/analytics";
import { inngest } from "../client";
import { abEvaluateRequested } from "../events";

/** Every 30 minutes: promote significant A/B winners in campaigns that opted in. */
export const abEvaluate = inngest.createFunction(
  { id: "ab-evaluate", triggers: [cron("*/30 * * * *"), abEvaluateRequested], concurrency: [{ limit: 1, scope: "fn" }], retries: 1 },
  async ({ step }) => ({ promoted: await step.run("promote-winners", () => autoPromoteWinners()) }),
);
