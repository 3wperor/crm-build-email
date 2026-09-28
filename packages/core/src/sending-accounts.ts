import { z } from "zod";
import { normalizeEmail, isValidEmailSyntax } from "./email";

export const PROVIDERS = ["google", "smtp", "outlook"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Providers usable today. `outlook` is defined (adapter interface) but not implemented. */
export const ENABLED_PROVIDERS = ["google", "smtp"] as const satisfies readonly Provider[];

export type ConnectionSettings = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean; // implicit TLS (465). false = STARTTLS upgrade (587) when offered
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
};

export const PROVIDER_PRESETS: Record<Provider, ConnectionSettings | null> = {
  google: {
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
  },
  outlook: {
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
  },
  smtp: null, // user-supplied
};

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Input schemas (shared by the web UI and, later, the MCP server).
// ---------------------------------------------------------------------------

const emailField = z
  .string()
  .transform(normalizeEmail)
  .refine(isValidEmailSyntax, "Enter a valid email address");

const hostField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Host is required")
  .max(253)
  .regex(/^[a-z0-9.-]+$/, "Host may only contain letters, digits, dots and hyphens");

const portField = z.coerce.number().int().min(1).max(65535);

// HTML checkboxes send "on" or nothing; JSON callers send booleans.
// (z.coerce.boolean() would turn the string "false" into true.)
const boolField = z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());

const timezoneField = z
  .string()
  .trim()
  .max(64)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isValidTimeZone(v), "Unknown timezone");

export const DAILY_CAP_MAX = 2000;
const dailyCapField = z.coerce.number().int().min(1).max(DAILY_CAP_MAX);

// Gmail shows app passwords as "abcd efgh ijkl mnop"; spaces are not part of it.
const appPasswordField = z
  .string()
  .min(1, "App password is required")
  .max(512)
  .transform((v) => v.replace(/\s+/g, ""));

const baseAccount = z.object({
  email: emailField,
  displayName: z.string().trim().max(120).optional().transform((v) => v || null),
  password: appPasswordField,
  username: z.string().trim().max(320).optional().transform((v) => v || null),
  dailyCap: dailyCapField.default(30),
  timezone: timezoneField,
});

export const sendingAccountInputSchema = z.discriminatedUnion("provider", [
  baseAccount.extend({ provider: z.literal("google") }),
  baseAccount.extend({
    provider: z.literal("smtp"),
    smtpHost: hostField,
    smtpPort: portField,
    smtpSecure: boolField,
    imapHost: hostField,
    imapPort: portField,
    imapSecure: boolField,
  }),
]);

export type SendingAccountInput = z.input<typeof sendingAccountInputSchema>;

/** Fully resolved account config after applying provider presets. */
export type ResolvedAccountConfig = ConnectionSettings & {
  provider: Provider;
  email: string;
  username: string;
  password: string;
  displayName: string | null;
  dailyCap: number;
  timezone: string | null;
};

export function resolveAccountConfig(input: z.output<typeof sendingAccountInputSchema>): ResolvedAccountConfig {
  const connection: ConnectionSettings =
    input.provider === "smtp"
      ? {
          smtpHost: input.smtpHost,
          smtpPort: input.smtpPort,
          smtpSecure: input.smtpSecure,
          imapHost: input.imapHost,
          imapPort: input.imapPort,
          imapSecure: input.imapSecure,
        }
      : PROVIDER_PRESETS.google!;

  return {
    ...connection,
    provider: input.provider,
    email: input.email,
    // Google always authenticates with the full address.
    username: input.provider === "google" ? input.email : (input.username ?? input.email),
    password: input.password,
    displayName: input.displayName,
    dailyCap: input.dailyCap,
    timezone: input.timezone,
  };
}

export const sendingAccountUpdateSchema = z.object({
  displayName: z.string().trim().max(120).optional().transform((v) => v || null),
  dailyCap: dailyCapField,
  timezone: timezoneField,
  status: z.enum(["active", "paused"]),
});

export const passwordRotationSchema = z.object({ password: appPasswordField });

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type Health = "unknown" | "healthy" | "degraded" | "failing";

export type CheckResult = { ok: true; latencyMs: number } | { ok: false; error: string; hint?: string };

export type ConnectionTestResult = { smtp: CheckResult; imap: CheckResult };

/**
 * healthy  = can send and read replies
 * degraded = can send but not read (replies would be missed → stop-on-reply breaks)
 *            or can read but not send
 * failing  = neither works
 */
export function deriveHealth(result: ConnectionTestResult): { health: Health; score: number; detail: string | null } {
  const { smtp, imap } = result;
  if (smtp.ok && imap.ok) return { health: "healthy", score: 100, detail: null };
  if (!smtp.ok && !imap.ok) {
    return { health: "failing", score: 0, detail: `SMTP: ${smtp.error} · IMAP: ${imap.error}` };
  }
  if (!smtp.ok) return { health: "degraded", score: 40, detail: `SMTP: ${smtp.error}` };
  if (!imap.ok) return { health: "degraded", score: 50, detail: `IMAP: ${imap.error}` };
  return { health: "unknown", score: 0, detail: null }; // unreachable
}

// ---------------------------------------------------------------------------
// Daily counters
// ---------------------------------------------------------------------------

/** YYYY-MM-DD for `now` in the given IANA timezone. */
export function localDate(now: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * `sent_today` is only meaningful for the day stored in `sent_today_date`
 * (in the account's timezone). A stale counter from yesterday reads as 0.
 */
export function effectiveSentToday(
  account: { sent_today: number; sent_today_date: string | null; timezone: string | null },
  now: Date,
  fallbackTimeZone = "UTC",
): number {
  if (!account.sent_today_date) return 0;
  return account.sent_today_date === localDate(now, account.timezone ?? fallbackTimeZone) ? account.sent_today : 0;
}
