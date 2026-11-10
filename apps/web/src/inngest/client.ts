import { Inngest } from "inngest";

// Keys come from INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY. For local dev run
// `pnpm inngest:dev` and set INNGEST_DEV=1.
// In production the dev-server mode is never honoured: with it on, /api/inngest
// would run jobs for anyone without checking the request signature.
const production = process.env.VERCEL_ENV === "production";
export const inngest = new Inngest({ id: "ycareach", ...(production ? { isDev: false } : {}) });
