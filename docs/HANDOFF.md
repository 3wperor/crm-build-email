# YCAReach — build handoff

Status of the phased build. It's for whoever, human or AI, continues the work.
Read it with `README.md`, which covers architecture, setup and deploy.

## Where we are

| Phase | State | Commit |
|---|---|---|
| 1 Scaffold (auth, orgs, schema, RLS, shell, kill switch, audit log) | ✅ | 489e413 |
| 2 Sending accounts (encrypted creds, SMTP/IMAP test, health) | ✅ | ad63407 |
| 3 Leads (CSV import via Storage + Inngest, dedupe, suppression) | ✅ | b265af9 |
| 4 Verification (syntax, MX/DNS, disposable, role; auto after import) | ✅ | 8a95192 |
| 5 Sequences + scheduler (windows/DST, caps, pacing, threading, unsubscribe, bounces), renamed to **YCAReach** | ✅ | d39df58 |
| 6 Test email | ✅ | 21f3e14 |
| 7 Reply sync (IMAP + Junk, matching, DSN bounces, classification rules + optional Claude, auto-pipeline) | ✅ | ce8b337 |
| 8 Pipeline kanban, stage editor, lead detail | ✅ | aa60c97 |
| 9 A/B stats + analytics (+ open/click tracking) | ⏳ next | |
| 10 Warmup pool (beta) | ⏳ | |
| 11 MCP server + guardrails + agent audit | ⏳ | |
| 12 HubSpot adapter (`CrmAdapter` interface) | ⏳ | |

## Decisions the user made (don't re-ask)

- **Stack:**
  - pnpm monorepo: `apps/web`, `apps/mcp`, `packages/core`, `packages/db`, `packages/mail`.
  - Next.js 15, Supabase, Inngest.
- **Credentials:** app-level AES-256-GCM with a versioned key.
- **Verification:** MX-only. No SMTP RCPT probe, because serverless hosts block port 25. A domain passing the MX check is stored as `valid` with `detail.level = "mx"`.
- **Approved dependencies:**
  - `zod`, `vitest`, `papaparse`, `nodemailer`, `imapflow`, `mailparser`, `inngest`;
  - `disposable-email-domains-js`, which replaced the stale `disposable-email-domains`;
  - `@anthropic-ai/sdk`, for optional reply classification;
  - `@dnd-kit/core`.
- **Sending:**
  - Random 3–7 minute gap per inbox.
  - Risky leads skipped unless the campaign opts in.
  - Plain text plus a generated minimal HTML version.
  - The kill switch also blocks test emails.
- **Replies:**
  - Out-of-office doesn't stop the sequence; the next step moves to the return date, or +3 days.
  - Negative replies go to Closed Lost.
  - The Gmail Spam folder is scanned too.
- **Rule:** ask before adding dependencies or changing the stack.

## How it was verified (repeat this for every phase)

1. **Unit tests:** `pnpm test`.
2. **Database tests:** `supabase/tests/rls.sql`, run via `pnpm db:test` against local Supabase. It asserts tenancy isolation, grants and every RPC.
3. **End-to-end:** real browser runs (Playwright, Chromium) against a local stack.

The cloud dev container has no Docker, so the stack was assembled by hand:
- Postgres 16, with GoTrue and PostgREST from their release binaries;
- a small Node gateway on `:54321` that also fakes the Storage API;
- the real Inngest dev server (`inngest-cli`);
- the fake mail server in `packages/mail/src/testing/` (SMTP `:2525`, IMAP `:2143`, HTTP control `:2580`).

Local fakes and escape hatches:
- **Fake mail server:** start it with `node --experimental-strip-types packages/mail/src/testing/run-fake-mail.mjs`. The control API lets tests read captured mail and append messages to IMAP folders.
- **Private hosts:** `MAIL_ALLOW_PRIVATE_HOSTS=true` and `MAIL_ALLOW_PLAINTEXT_AUTH=true` allow the fake mail server. Both are ignored when `VERCEL_ENV=production`.
- **Faster pacing:** `SEND_GAP_MIN_SECONDS` / `SEND_GAP_MAX_SECONDS` shorten the gap for tests.

With Docker available, the normal flow applies: `pnpm db:start` (Supabase), `pnpm dev`, `pnpm inngest:dev`.

Suite totals at the last run: 157 core tests, 47 mail tests, 109 database assertions, 89 browser steps across 7 end-to-end suites.

## Not yet verified against real services

- A real Gmail/Workspace inbox, over SMTP and IMAP.
- Real Supabase Storage for the signed CSV upload.
- Supabase Realtime: the kanban refresh is wired but was never run.
- A live Claude API call for reply classification, since no key was available.

## Phase 9 plan (next)

- **Open/click tracking**, off by default because it hurts deliverability; the toggles already exist on `campaigns`.
  - Signed `/t/o/<token>` pixel and `/t/c/<token>` redirect, recording `open` / `click` events.
  - The middleware already excludes `/t/`.
  - Tracking must never apply to test emails.
- **Per-variant stats:** sent, opened, clicked, replied, positive, bounced, and their rates.
  - Significance: a two-proportion z-test on reply rate against variant A, with a minimum sample per arm.
  - A "winner" badge. When `campaigns.auto_promote_winner` is on, set `email_variants.is_winner`; `pickVariant` already routes all traffic to the winner.
- **`/analytics`** page:
  - per campaign / inbox / variant tables;
  - daily sent/reply/bounce series for the last 30 days;
  - charts drawn with inline SVG, so there's no chart dependency.

## Phases 10–12 notes

- **Warmup:**
  - Inboxes marked `warmup_enabled` email each other, and the `warmup_events` table already exists.
  - Ramp from 5–10 a day upward.
  - Tag messages with `X-YCAReach-Warmup` (reply sync already ignores it) and auto-reply to simulate threads.
  - Pause on bounce or reply spikes, and label the feature beta.
- **MCP:**
  - `apps/mcp` exists as a placeholder, and `api_keys` stores SHA-256 hashes of keys.
  - Tools must reuse the core/lib functions: `sendTestEmail`, `createVerificationRun`, `enroll_leads`, `set_sending_paused(p_actor='agent:<key>')`.
  - Honor `approval_mode` (`effectiveApprovalMode`) and write every action to `agent_audit_log`.
- **HubSpot:** define `CrmAdapter` in core, then build a HubSpot implementation that syncs pipeline cards.
