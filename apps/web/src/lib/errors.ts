import "server-only";

type AnyError = { message?: string; code?: string; status?: number; details?: string | null } | null | undefined;

const GENERIC = "Something went wrong on our side. Please try again in a moment.";

/** Postgres / PostgREST codes people can do something about. */
const BY_CODE: Record<string, string> = {
  "23505": "That already exists. Try a different name or value.",
  "23503": "This is still used somewhere else, so it can't be changed or removed yet.",
  "23502": "Something required is missing. Check the form and try again.",
  "23514": "One of those values isn't allowed. Check the form and try again.",
  "22001": "That's too long. Shorten it and try again.",
  "22P02": "One of those values isn't in the right format.",
  "42501": "You don't have permission to do that. Ask a workspace owner or admin.",
  PGRST116: "We couldn't find that. It may have been removed.",
  PGRST301: "Your session has ended. Sign in again.",
};

/** Sign-in and sign-up problems (Supabase Auth error codes). */
const AUTH: Record<string, string> = {
  invalid_credentials: "That email and password don't match. Check them and try again, or use a sign-in link.",
  email_not_confirmed: "Confirm your email first: open the link we sent you, then sign in.",
  user_already_exists: "There's already an account with that email. Sign in instead.",
  email_exists: "There's already an account with that email. Sign in instead.",
  weak_password: "Choose a stronger password: at least 10 characters, and not a common one.",
  over_email_send_rate_limit: "We've just sent you an email. Wait a minute before asking for another.",
  over_request_rate_limit: "Too many tries in a short time. Wait a minute and try again.",
  signup_disabled: "New sign-ups are closed at the moment.",
  email_address_invalid: "That email address doesn't look right. Check it and try again.",
};

/**
 * Turns a database or provider error into something a person can act on, and
 * keeps the raw detail in the server log. Messages our own database functions
 * raise on purpose (code P0001) are already written for people and pass through.
 */
export function friendlyError(error: AnyError, fallback: string = GENERIC): string {
  if (!error) return fallback;
  const code = error.code ?? "";
  if (code === "P0001" && error.message) return error.message;
  const known = BY_CODE[code] ?? AUTH[code];
  if (!known) console.error("[action error]", code || "(no code)", error.message, error.details ?? "");
  return known ?? fallback;
}
