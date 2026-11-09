import { generateReplyDraft } from "@/lib/replies/drafts";
import { inngest } from "../client";
import { replyDraftRequested } from "../events";

/** Writes the AI draft answer for a new reply. A couple at a time per workspace. */
export const replyDraft = inngest.createFunction(
  {
    id: "reply-draft",
    triggers: [replyDraftRequested],
    concurrency: [{ key: "event.data.orgId", limit: 2 }],
    retries: 1,
  },
  async ({ event, step }) =>
    step.run("draft", async () => {
      const res = await generateReplyDraft(event.data.orgId, event.data.replyId);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    }),
);
