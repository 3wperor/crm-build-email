/**
 * One place for how numbers, money and dates read, so every page agrees.
 * Everything is en-GB and takes the timezone explicitly: nothing here depends
 * on the server's own locale or clock zone.
 */
const LOCALE = "en-GB";

export function formatNumber(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString(LOCALE);
}

/** 0.1234 → "12.3%". Whole numbers drop the decimal ("12%"). */
export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return "–";
  return `${(ratio * 100).toLocaleString(LOCALE, { maximumFractionDigits: digits })}%`;
}

/** 20 → "£20", 12.5 → "£12.50". */
export function formatGBP(amount: number): string {
  return amount.toLocaleString(LOCALE, { style: "currency", currency: "GBP", minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 });
}

/** plural(1, "email") → "1 email"; plural(3, "email") → "3 emails"; plural(2, "reply", "replies"). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

type DateInput = string | number | Date | null | undefined;
const toDate = (v: DateInput): Date | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "12 Nov 2026" */
export function formatDay(value: DateInput, timeZone = "UTC"): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString(LOCALE, { timeZone, day: "numeric", month: "short", year: "numeric" }) : "–";
}

/** "12 Nov 2026, 14:05" (the exact moment, for tooltips and logs). */
export function formatDateTime(value: DateInput, timeZone = "UTC"): string {
  const d = toDate(value);
  return d ? d.toLocaleString(LOCALE, { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/**
 * Recent moments read the way people say them ("2 hours ago", "in 3 days");
 * anything more than a week away falls back to the date.
 */
export function formatDate(value: DateInput, timeZone = "UTC", now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return "–";
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "just now";
  if (abs < HOUR) return relative.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return relative.format(Math.round(diff / HOUR), "hour");
  if (abs < 7 * DAY) return relative.format(Math.round(diff / DAY), "day");
  return formatDay(d, timeZone);
}
