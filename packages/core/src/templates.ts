/**
 * Email templating: merge tags, plain-text → minimal HTML, compliance footer.
 *
 * Merge tags: {{first_name}}, {{company|your team}} (fallback after "|"),
 * {{custom.plan}} or just {{plan}} for custom fields, {{sender_name}}.
 */

export type MergeLead = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  custom_json?: Record<string, unknown> | null;
};

export type MergeSender = { name: string | null; email: string };

export type MergeContext = { lead: MergeLead; sender: MergeSender };

const TAG_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|([^}]*))?\}\}/g;

export const BUILTIN_TAGS = [
  "first_name",
  "last_name",
  "full_name",
  "company",
  "title",
  "email",
  "sender_name",
  "sender_first_name",
  "sender_email",
] as const;

function lookup(key: string, ctx: MergeContext): string | null {
  const { lead, sender } = ctx;
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null);
  switch (key) {
    case "first_name":
      return str(lead.first_name);
    case "last_name":
      return str(lead.last_name);
    case "full_name":
      return str([lead.first_name, lead.last_name].filter(Boolean).join(" "));
    case "company":
      return str(lead.company);
    case "title":
      return str(lead.title);
    case "email":
      return str(lead.email);
    case "sender_name":
      return str(sender.name);
    case "sender_first_name":
      return str(sender.name?.split(/\s+/)[0]);
    case "sender_email":
      return str(sender.email);
  }
  const custom = lead.custom_json ?? {};
  const k = key.startsWith("custom.") ? key.slice(7) : key;
  return str(custom[k]);
}

export type RenderResult = { text: string; missing: string[] };

/** Replaces merge tags. Tags with no value and no fallback render empty and are reported in `missing`. */
export function renderTemplate(template: string, ctx: MergeContext): RenderResult {
  const missing = new Set<string>();
  const text = template.replace(TAG_RE, (_m, key: string, fallback: string | undefined) => {
    const v = lookup(key, ctx);
    if (v !== null) return v;
    if (fallback !== undefined) return fallback.trim();
    missing.add(key);
    return "";
  });
  return { text, missing: [...missing] };
}

/** Tags used in a template (for editor hints / validation). */
export function templateTags(template: string): string[] {
  return [...new Set([...template.matchAll(TAG_RE)].map((m) => m[1]!))];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Plain text → minimal HTML that renders like a hand-written email. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`);
  return paragraphs.join("\n");
}

export type BuiltEmail = { subject: string; text: string; html: string; missing: string[] };

/**
 * Builds the final message. Follow-ups with an empty subject reply in-thread
 * ("Re: <first subject>"). Every email carries an unsubscribe link and the
 * sender's physical address (CAN-SPAM / GDPR).
 */
export function buildEmail(opts: {
  subject: string;
  body: string;
  ctx: MergeContext;
  threadSubject?: string | null;
  unsubscribeUrl: string;
  physicalAddress: string | null;
}): BuiltEmail {
  const s = renderTemplate(opts.subject, opts.ctx);
  const b = renderTemplate(opts.body, opts.ctx);
  let subject = s.text.replace(/[\r\n]+/g, " ").trim();
  if (!subject && opts.threadSubject) {
    subject = /^re:/i.test(opts.threadSubject) ? opts.threadSubject : `Re: ${opts.threadSubject}`;
  }

  const body = b.text.replace(/\r\n/g, "\n").trim();
  const footerText = [`Not interested? Unsubscribe: ${opts.unsubscribeUrl}`, opts.physicalAddress].filter(Boolean).join("\n");
  const text = `${body}\n\n\n${footerText}\n`;
  const footerHtml =
    `<p style="color:#888;font-size:12px;margin-top:32px">Not interested? <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#888">Unsubscribe</a>` +
    (opts.physicalAddress ? `<br>${escapeHtml(opts.physicalAddress)}` : "") +
    `</p>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">\n${textToHtml(body)}\n${footerHtml}\n</div>`;

  return { subject, text, html, missing: [...new Set([...s.missing, ...b.missing])] };
}
