/**
 * Only allow same-origin relative paths as post-login redirect targets.
 *
 * Browsers (and the URL parser) drop tabs and newlines and treat "\" like "/",
 * so "/\t/evil.example" or "/\evil.example" would leave the site. Reject those
 * outright, then confirm the parsed result still points at our own origin.
 */
const BASE = "http://internal.invalid";

export function safeNextPath(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || next.length > 2000) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  // Control characters (incl. tab / CR / LF) and backslashes never belong in our paths.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
