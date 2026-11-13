/**
 * The look of emails YCAReach sends as itself (trial and billing reminders):
 * logo, the message, one button, a footer. Tables and inline styles only,
 * because that's what email apps reliably show. Colours match the app.
 */
const BLUE = "#165dfc";
const INK = "#171c2b";
const MUTED = "#667085";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isUrl = (line: string) => /^https?:\/\/\S+$/.test(line.trim());

function buttonLabel(url: string): string {
  return /\/billing(\b|$)/.test(url) ? "Go to billing" : "Open YCAReach";
}

const LOGO = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:28px;height:28px;background:${BLUE};border-radius:7px;text-align:center;vertical-align:middle;font:700 17px/28px Arial,Helvetica,sans-serif;color:#ffffff;">Y</td>
<td style="padding-left:9px;font:700 17px/28px Arial,Helvetica,sans-serif;color:${INK};letter-spacing:-0.3px;">YCA<span style="color:${BLUE};">Reach</span></td>
</tr></table>`;

/** Plain-text message → branded HTML. A line that is only a link becomes the button. */
export function brandedEmailHtml(subject: string, text: string, footer = "You're getting this because you have a YCAReach workspace."): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push(`<p style="margin:0 0 16px;font:400 15px/24px Arial,Helvetica,sans-serif;color:${INK};">${paragraph.join("<br>")}</p>`);
    paragraph = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) flush();
    else if (isUrl(line)) {
      flush();
      const url = escapeHtml(line.trim());
      blocks.push(
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;"><tr><td style="background:${BLUE};border-radius:8px;">` +
          `<a href="${url}" style="display:inline-block;padding:11px 20px;font:700 15px/20px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;">${buttonLabel(line)}</a>` +
          `</td></tr></table>` +
          `<p style="margin:0 0 16px;font:400 12px/18px Arial,Helvetica,sans-serif;color:${MUTED};">Or paste this into your browser: <a href="${url}" style="color:${MUTED};">${url}</a></p>`,
      );
    } else paragraph.push(escapeHtml(line));
  }
  flush();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f9;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:0 4px 20px;">${LOGO}</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e7ee;border-radius:12px;padding:28px 28px 12px;">${blocks.join("\n")}</td></tr>
<tr><td style="padding:16px 4px 0;font:400 12px/18px Arial,Helvetica,sans-serif;color:${MUTED};">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}
