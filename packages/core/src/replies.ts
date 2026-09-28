/**
 * Reply handling: quote stripping, heuristic classification, out-of-office
 * return dates, bounce (DSN) parsing and reply → send matching.
 * Pure: the IMAP job feeds it parsed messages and database lookups.
 */

export const REPLY_CLASSES = ["positive", "negative", "out_of_office", "unsubscribe", "neutral"] as const;
export type ReplyClass = (typeof REPLY_CLASSES)[number];

// ---------------------------------------------------------------------------
// Quote stripping
// ---------------------------------------------------------------------------

const QUOTE_HEADERS = [
  /^On .{1,300}wrote:\s*$/im, // Gmail / Apple Mail (can wrap; handled below)
  /^-{2,}\s*Original Message\s*-{2,}/im, // Outlook
  /^_{10,}\s*$/m, // Outlook desktop separator
  /^From:\s.+\n(?:.*\n){0,3}?(?:Sent|Date):\s/im, // Outlook header block
  /^Le .{1,200} a écrit\s*:/im,
  /^Am .{1,200} schrieb .{1,200}:/im,
  /^El .{1,200} escribió:/im,
];

/** The new text of a reply, without quoted history or trailing ">" lines. */
export function extractReplyText(text: string): string {
  let body = text.replace(/\r\n/g, "\n");
  // Gmail wraps long "On … wrote:" lines; join a line ending without ":" with the next if it then ends in "wrote:".
  body = body.replace(/^(On [^\n]{1,200})\n([^\n]{0,200}wrote:)\s*$/m, "$1 $2");
  let cut = body.length;
  for (const re of QUOTE_HEADERS) {
    const m = re.exec(body);
    if (m && m.index < cut) cut = m.index;
  }
  body = body.slice(0, cut);
  // Drop quoted lines and a trailing signature delimiter block.
  body = body
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n");
  const sig = /^--\s*$/m.exec(body);
  if (sig) body = body.slice(0, sig.index);
  return body.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type ClassifyInput = {
  subject: string;
  /** Full text body (quotes are stripped internally). */
  text: string;
  headers?: Record<string, string | undefined>;
  receivedAt?: Date;
};

export type HeuristicResult = {
  classification: ReplyClass;
  /** "high" = rule matched clearly; "low" = defaulted to neutral (AI may help). */
  confidence: "high" | "low";
  reason: string;
  /** For out_of_office: when to resume, if a return date was found. */
  oooUntil: Date | null;
};

const AUTO_REPLY_SUBJECT = /\b(out of (the )?office|automatic reply|auto[- ]?reply|autoreply|abwesenheitsnotiz|absence|on vacation|away from (the )?office|réponse automatique|respuesta automática)\b/i;
const OOO_BODY =
  /\b(i am|i'm|i will be|i'll be|currently)\s+(out of (the )?office|away|on (annual |parental |maternity |paternity |sick )?leave|on vacation|on holiday|travell?ing with limited)|\bout of (the )?office\b|\blimited access to (my )?e-?mail\b|\bwill (respond|reply|get back to you) (to your (e-?mail|message) )?(when|upon|after) (i|my) return/i;

const UNSUBSCRIBE = [
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\btake me off\b/i,
  /\b(stop|quit|cease) (e-?mailing|contacting|sending|messaging)\b/i,
  /\bdo not (e-?mail|contact)\b/i,
  /\bdon'?t (e-?mail|contact) me\b/i,
  /\bopt(-| )?out\b/i,
  /\bno more e-?mails\b/i,
  /\bnot interested,? (please )?(remove|stop)\b/i,
];

const NEGATIVE = [
  /\bnot interested\b/i,
  /\bno,? thanks?\b/i,
  /\bno thank you\b/i,
  /\bnot (a )?(good )?fit\b/i,
  /\bnot (for|relevant to) us\b/i,
  /\bwe'?re (all set|good|covered)\b/i,
  /\bwe (already )?(have|use) (a |an )?(solution|vendor|provider|partner)\b/i,
  /\bno need\b/i,
  /\bnot at this time\b/i,
];

const POSITIVE = [
  /\b(i'?m|we'?re|i am|we are|would be|am) (very |definitely |quite )?interested\b/i,
  /\binterested in (learning|hearing|a|the|this|chatting)/i,
  /\blet'?s (chat|talk|connect|meet|do it|set (it|something) up)\b/i,
  /\bsounds (good|great|interesting)\b/i,
  /\b(book|schedule|set up|arrange) (a |some )?(call|meeting|time|demo|chat)\b/i,
  /\b(happy|glad|open) to (chat|talk|connect|learn more|hop on)\b/i,
  /\btell me more\b/i,
  /\bsend (me |over )?(more )?(info|information|details|pricing|a deck)\b/i,
  /\bwhen are you (free|available)\b/i,
  /\b(my|here'?s my) calendar\b/i,
  /\bcalendly\.com\b/i,
  /\bhow much (is|does)\b/i,
  /^\s*(yes|yep|sure|absolutely|definitely)\b/im,
];

function headerValue(headers: ClassifyInput["headers"], name: string): string {
  if (!headers) return "";
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (headers[key] ?? "") : "";
}

/** RFC 3834 auto-responses and common vendor headers. */
export function isAutoReply(input: Pick<ClassifyInput, "headers" | "subject">): boolean {
  const auto = headerValue(input.headers, "auto-submitted").toLowerCase();
  if (auto && auto !== "no") return true;
  if (headerValue(input.headers, "x-autoreply") || headerValue(input.headers, "x-autorespond")) return true;
  if (/auto[_-]?reply/i.test(headerValue(input.headers, "precedence"))) return true;
  return AUTO_REPLY_SUBJECT.test(input.subject);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Finds a return date in an out-of-office message ("back on October 5",
 * "returning 2026-10-05", "until 10/05"). Returns the first date after
 * `receivedAt` (next day at 00:00 UTC of that date), or null.
 */
export function parseOooReturnDate(text: string, receivedAt: Date): Date | null {
  const t = text.replace(/\s+/g, " ");
  const cue = /\b(back|return(ing)?|returns|until|till|through|thru|in the office|resume)\b[^.]{0,60}/gi;
  const candidates: Date[] = [];
  const year = receivedAt.getUTCFullYear();
  for (const m of t.matchAll(cue)) {
    const s = m[0];
    // ISO 2026-10-05
    for (const d of s.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) candidates.push(new Date(Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!)));
    // "October 5(th)(, 2026)" / "5 October (2026)"
    for (const d of s.matchAll(/\b([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b/gi)) {
      const mi = MONTHS.indexOf(d[1]!.slice(0, 3).toLowerCase());
      if (mi >= 0) candidates.push(new Date(Date.UTC(d[3] ? +d[3] : year, mi, +d[2]!)));
    }
    for (const d of s.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\.?(?: (\d{4}))?\b/gi)) {
      const mi = MONTHS.indexOf(d[2]!.slice(0, 3).toLowerCase());
      if (mi >= 0) candidates.push(new Date(Date.UTC(d[3] ? +d[3] : year, mi, +d[1]!)));
    }
    // US numeric 10/05(/2026)
    for (const d of s.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
      const y = d[3] ? (d[3].length === 2 ? 2000 + +d[3] : +d[3]) : year;
      candidates.push(new Date(Date.UTC(y, +d[1]! - 1, +d[2]!)));
    }
  }
  const start = Date.UTC(receivedAt.getUTCFullYear(), receivedAt.getUTCMonth(), receivedAt.getUTCDate());
  const valid = candidates
    .map((d) => {
      // A month/day without a year that already passed means next year.
      if (d.getTime() < start && d.getUTCFullYear() === year) d = new Date(Date.UTC(year + 1, d.getUTCMonth(), d.getUTCDate()));
      return d;
    })
    .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() >= start && d.getTime() - start < 366 * 864e5)
    .sort((a, b) => a.getTime() - b.getTime());
  return valid[0] ?? null;
}

export const OOO_DEFAULT_DELAY_DAYS = 3;

/**
 * Rules first. Order matters: auto-replies, then explicit opt-outs (they
 * often also say "not interested"), then negative ("not interested" contains
 * "interested"), then positive. Anything else is a low-confidence neutral.
 */
export function classifyReplyHeuristic(input: ClassifyInput): HeuristicResult {
  const receivedAt = input.receivedAt ?? new Date();
  const reply = extractReplyText(input.text);
  const haystack = `${input.subject}\n${reply}`;

  if (isAutoReply(input) || OOO_BODY.test(reply)) {
    const back = parseOooReturnDate(reply, receivedAt);
    return {
      classification: "out_of_office",
      confidence: "high",
      reason: isAutoReply(input) ? "auto-reply headers/subject" : "out-of-office wording",
      oooUntil: back ?? new Date(receivedAt.getTime() + OOO_DEFAULT_DELAY_DAYS * 864e5),
    };
  }
  // Reason = the phrase that matched, readable in the UI ('matched "not interested"').
  const hit = (rules: RegExp[]) => {
    for (const r of rules) {
      const m = r.exec(haystack);
      if (m) return `matched "${m[0].trim().toLowerCase()}"`;
    }
    return null;
  };
  const u = hit(UNSUBSCRIBE);
  if (u) return { classification: "unsubscribe", confidence: "high", reason: u, oooUntil: null };
  const n = hit(NEGATIVE);
  if (n) return { classification: "negative", confidence: "high", reason: n, oooUntil: null };
  const p = hit(POSITIVE);
  if (p) return { classification: "positive", confidence: "high", reason: p, oooUntil: null };
  return { classification: "neutral", confidence: "low", reason: "no rule matched", oooUntil: null };
}

// ---------------------------------------------------------------------------
// Bounces (DSN)
// ---------------------------------------------------------------------------

export type BounceInfo = {
  permanent: boolean;
  status: string | null; // e.g. "5.1.1"
  recipient: string | null;
  diagnostic: string | null;
};

/** Is this message a delivery-status notification (bounce)? */
export function isBounceMessage(input: { from: string; subject: string; contentType?: string; raw?: string }): boolean {
  if (/multipart\/report/i.test(input.contentType ?? "") && /delivery-status/i.test(input.contentType ?? input.raw ?? "")) return true;
  const fromDaemon = /(mailer-daemon|postmaster|mail delivery (subsystem|system))/i.test(input.from);
  const bounceSubject = /(undeliver|delivery (status notification|has failed|failure)|mail delivery failed|returned mail|failure notice|delivery incomplete)/i.test(
    input.subject,
  );
  return fromDaemon && bounceSubject;
}

/** Extracts status/recipient from the raw DSN. 5.x.x = permanent (hard), 4.x.x = transient. */
export function parseBounce(rawInput: string): BounceInfo {
  const raw = rawInput.replace(/\r\n/g, "\n");
  const status = /^Status:\s*([245]\.\d{1,3}\.\d{1,3})/im.exec(raw)?.[1] ?? /\b([45]\.\d\.\d{1,3})\b/.exec(raw)?.[1] ?? null;
  const recipient =
    /^Final-Recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?/im.exec(raw)?.[1]?.toLowerCase() ??
    /^Original-Recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?/im.exec(raw)?.[1]?.toLowerCase() ??
    null;
  const diagnostic = /^Diagnostic-Code:\s*(.+(?:\n[ \t].+)*)/im.exec(raw)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 300) ?? null;
  const action = /^Action:\s*(\w+)/im.exec(raw)?.[1]?.toLowerCase();
  const permanent = status ? status.startsWith("5") : action === "failed" || /\b55\d\b/.test(diagnostic ?? "");
  return { permanent, status, recipient, diagnostic };
}

/**
 * Message-IDs referenced anywhere in a raw message — including the original
 * message's headers embedded in a bounce. Only Message-ID / In-Reply-To /
 * References headers count (not From:/To: addresses).
 */
export function extractMessageIds(raw: string): string[] {
  const unfolded = raw.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
  const ids = new Set<string>();
  for (const m of unfolded.matchAll(/^(?:Message-ID|In-Reply-To|References):\s*(.+)$/gim)) {
    for (const id of m[1]!.matchAll(/<[^<>\s@]+@[^<>\s]+>/g)) ids.add(id[0]);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export type MatchCandidate = { sendId: string; leadId: string; leadEmail: string; messageId: string | null; sentAt: string | null };

export type ReplyMatch = { sendId: string; leadId: string; method: "in_reply_to" | "references" | "from_email" } | null;

export const FROM_EMAIL_MATCH_WINDOW_DAYS = 30;

/**
 * Header threading wins (In-Reply-To, then References newest-first); the
 * sender-address fallback only matches a send to that same address within
 * the window, and picks the most recent.
 */
export function pickReplyMatch(opts: {
  inReplyTo: string | null;
  references: string[];
  fromEmail: string;
  receivedAt: Date;
  byMessageId: MatchCandidate[];
  byLeadEmail: MatchCandidate[];
}): ReplyMatch {
  const byId = new Map(opts.byMessageId.filter((c) => c.messageId).map((c) => [c.messageId!, c]));
  if (opts.inReplyTo && byId.has(opts.inReplyTo)) {
    const c = byId.get(opts.inReplyTo)!;
    return { sendId: c.sendId, leadId: c.leadId, method: "in_reply_to" };
  }
  for (const ref of [...opts.references].reverse()) {
    const c = byId.get(ref);
    if (c) return { sendId: c.sendId, leadId: c.leadId, method: "references" };
  }
  const from = opts.fromEmail.toLowerCase();
  const cutoff = opts.receivedAt.getTime() - FROM_EMAIL_MATCH_WINDOW_DAYS * 864e5;
  const recent = opts.byLeadEmail
    .filter((c) => c.leadEmail.toLowerCase() === from && c.sentAt && new Date(c.sentAt).getTime() >= cutoff && new Date(c.sentAt).getTime() <= opts.receivedAt.getTime())
    .sort((a, b) => new Date(b.sentAt!).getTime() - new Date(a.sentAt!).getTime());
  const c = recent[0];
  return c ? { sendId: c.sendId, leadId: c.leadId, method: "from_email" } : null;
}
