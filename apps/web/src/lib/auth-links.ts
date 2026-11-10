/** What the login page says after an email link didn't sign the person in. */
export const AUTH_LINK_MESSAGES = {
  other_browser: {
    tone: "info",
    text: "Your email is confirmed. That link was opened in a different browser from the one you signed up in, so please log in below to continue.",
  },
  expired: {
    tone: "error",
    text: "That link has expired or was already used. If you've just signed up, your email is probably confirmed already: try logging in. Otherwise sign up again for a new link.",
  },
  invalid: { tone: "error", text: "That link is incomplete. Open it straight from the email, or log in below." },
} as const;

export function authLinkMessage(key: string | undefined) {
  return key && key in AUTH_LINK_MESSAGES ? AUTH_LINK_MESSAGES[key as keyof typeof AUTH_LINK_MESSAGES] : null;
}
