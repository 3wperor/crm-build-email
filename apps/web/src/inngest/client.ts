import { Inngest } from "inngest";

// Keys come from INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY. For local dev run
// `pnpm inngest:dev` and set INNGEST_DEV=1.
export const inngest = new Inngest({ id: "outreach-crm" });
