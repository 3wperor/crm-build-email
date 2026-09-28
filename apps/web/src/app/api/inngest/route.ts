import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Long-running steps (imports, IMAP sync) need more than the default duration.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
