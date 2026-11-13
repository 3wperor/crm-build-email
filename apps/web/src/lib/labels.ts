/**
 * Internal values → the words people see, and which badge colour means what.
 * Add new statuses here rather than formatting them where they're shown.
 */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "outline";
type Entry = { label: string; tone: Tone };

const MAPS = {
  lead: {
    new: { label: "New", tone: "outline" },
    in_sequence: { label: "In a campaign", tone: "info" },
    replied: { label: "Replied", tone: "success" },
    bounced: { label: "Bounced", tone: "danger" },
    unsubscribed: { label: "Unsubscribed", tone: "warning" },
    do_not_contact: { label: "Do not contact", tone: "danger" },
  },
  verification: {
    unverified: { label: "Not checked", tone: "outline" },
    pending: { label: "Checking", tone: "neutral" },
    valid: { label: "Valid", tone: "success" },
    invalid: { label: "Invalid", tone: "danger" },
    risky: { label: "Risky", tone: "warning" },
    unknown: { label: "Can't tell", tone: "neutral" },
  },
  campaign: {
    draft: { label: "Draft", tone: "outline" },
    active: { label: "Running", tone: "success" },
    paused: { label: "Paused", tone: "warning" },
    completed: { label: "Finished", tone: "neutral" },
    archived: { label: "Archived", tone: "neutral" },
  },
  /** A lead's progress through one campaign. */
  enrollment: {
    queued: { label: "Waiting to start", tone: "outline" },
    active: { label: "In progress", tone: "info" },
    paused: { label: "Paused", tone: "warning" },
    completed: { label: "Finished", tone: "neutral" },
    replied: { label: "Replied", tone: "success" },
    bounced: { label: "Bounced", tone: "danger" },
    unsubscribed: { label: "Unsubscribed", tone: "warning" },
    stopped: { label: "Stopped", tone: "neutral" },
    failed: { label: "Failed", tone: "danger" },
  },
  send: {
    pending_approval: { label: "Waiting for approval", tone: "warning" },
    scheduled: { label: "Scheduled", tone: "outline" },
    sending: { label: "Sending", tone: "info" },
    sent: { label: "Sent", tone: "success" },
    failed: { label: "Failed", tone: "danger" },
    bounced: { label: "Bounced", tone: "danger" },
    cancelled: { label: "Cancelled", tone: "neutral" },
  },
  reply: {
    positive: { label: "Interested", tone: "success" },
    negative: { label: "Not interested", tone: "danger" },
    out_of_office: { label: "Out of office", tone: "neutral" },
    unsubscribe: { label: "Unsubscribe", tone: "warning" },
    neutral: { label: "Neutral", tone: "outline" },
    needs_reply: { label: "Needs reply", tone: "info" },
    all: { label: "All", tone: "outline" },
  },
  replySource: {
    heuristic: { label: "Sorted automatically", tone: "neutral" },
    ai: { label: "Sorted by AI", tone: "neutral" },
    manual: { label: "Sorted by you", tone: "neutral" },
  },
  import: {
    pending: { label: "Waiting", tone: "outline" },
    processing: { label: "In progress", tone: "info" },
    completed: { label: "Done", tone: "success" },
    failed: { label: "Failed", tone: "danger" },
  },
  health: {
    healthy: { label: "Healthy", tone: "success" },
    degraded: { label: "Needs attention", tone: "warning" },
    failing: { label: "Not working", tone: "danger" },
    unknown: { label: "Not checked", tone: "outline" },
  },
  suppression: {
    unsubscribe: { label: "Unsubscribed", tone: "warning" },
    hard_bounce: { label: "Bounced", tone: "danger" },
    complaint: { label: "Spam complaint", tone: "danger" },
    manual: { label: "Added by hand", tone: "neutral" },
  },
  audit: {
    ok: { label: "Done", tone: "success" },
    denied: { label: "Blocked", tone: "danger" },
    error: { label: "Failed", tone: "danger" },
    pending_approval: { label: "Waiting for approval", tone: "warning" },
  },
  approval: {
    pending: { label: "Waiting for approval", tone: "warning" },
    approved: { label: "Approved", tone: "info" },
    executed: { label: "Done", tone: "success" },
    rejected: { label: "Rejected", tone: "neutral" },
    failed: { label: "Failed", tone: "danger" },
    expired: { label: "Expired", tone: "neutral" },
  },
} satisfies Record<string, Record<string, Entry>>;

export type StatusKind = keyof typeof MAPS;

/** Unknown values still read as words ("some_new_state" → "Some new state"). */
function fallback(value: string): Entry {
  const words = value.replace(/_/g, " ").trim();
  return { label: words ? words.charAt(0).toUpperCase() + words.slice(1) : "–", tone: "outline" };
}

export function statusInfo(kind: StatusKind, value: string | null | undefined): Entry {
  if (!value) return { label: "–", tone: "outline" };
  return (MAPS[kind] as Record<string, Entry>)[value] ?? fallback(value);
}

export function statusLabel(kind: StatusKind, value: string | null | undefined): string {
  return statusInfo(kind, value).label;
}
