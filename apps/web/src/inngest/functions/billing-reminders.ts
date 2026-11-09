import { cron } from "inngest";
import { runBillingReminders } from "@/lib/billing-reminders";
import { inngest } from "../client";

/** Hourly: trial ending / ended / out of emails, failed payments. Each sent once. */
export const billingReminders = inngest.createFunction(
  { id: "billing-reminders", triggers: [cron("23 * * * *")], concurrency: [{ limit: 1, scope: "fn" }], retries: 0 },
  async ({ step }) => step.run("remind", () => runBillingReminders()),
);
