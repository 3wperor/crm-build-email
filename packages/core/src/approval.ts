/**
 * Agent approval guardrail.
 *
 * `draft` (default): agent actions that would send email are recorded as
 * proposals (sends in `pending_approval`) until a human approves.
 * `auto`: full-auto. Only effective when BOTH the org and the campaign opt in,
 * so an org-wide switch back to `draft` instantly reins in every campaign.
 */
export type ApprovalMode = "draft" | "auto";

export function effectiveApprovalMode(
  orgMode: ApprovalMode,
  campaignMode: ApprovalMode,
): ApprovalMode {
  return orgMode === "auto" && campaignMode === "auto" ? "auto" : "draft";
}
