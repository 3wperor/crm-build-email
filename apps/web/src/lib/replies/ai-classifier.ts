import "server-only";
import { classifyPrompt, parseClassification } from "@crm/core/ai";
import type { ReplyClass } from "@crm/core";
import { runAi } from "@/lib/ai/provider";

/**
 * AI fallback for replies the rules can't settle. Uses the workspace's AI
 * (included or their own key). Any failure returns null and the rules' answer stands.
 */
export async function classifyReplyWithAi(orgId: string, input: { subject: string; replyText: string }): Promise<{ classification: ReplyClass; reason: string } | null> {
  const res = await runAi(orgId, "classify_reply", classifyPrompt(input), { timeoutMs: 30_000 });
  return res.ok ? parseClassification(res.text) : null;
}
