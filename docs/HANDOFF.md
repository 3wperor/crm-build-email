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
| 9 A/B stats + analytics (+ open/click tracking) | ✅ | 8900bab |
| 10 Warmup pool (beta) | ✅ | c3612d3 |
| 11 MCP server + guardrails + agent audit | ✅ | 5b0b8a2 |
| 12 HubSpot adapter (`CrmAdapter` interface) | ✅ | (this commit) |

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
- **Warmup:** the pool is the workspace's own inboxes only; text comes from a built-in phrase bank; warmup counts toward each inbox's daily cap.
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

Suite totals at the last run: 208 core tests, 49 mail tests, 4 MCP tests, 167 database assertions, 133 browser steps across 12 end-to-end suites.

## Not yet verified against real services

- A real Gmail/Workspace inbox, over SMTP and IMAP.
- Real Supabase Storage for the signed CSV upload.
- Supabase Realtime: the kanban refresh is wired but was never run.
- A live Claude API call for reply classification, since no key was available.

## Phase 9 (done)

- **Tracking:** signed `/t/o` and `/t/c` routes, applied at send time only. Bot-flagged hits are stored but excluded from rates.
- **Queries:** `analytics_breakdown` and `analytics_daily`.
- **A/B:** `evaluateAbTest` (reply rate, Bonferroni correction, at least 100 sends per variant). Winners change only through `set_variant_winner`, which is audited, and the `ab-evaluate` cron handles auto-promotion.
- **Charts:** inline SVG in `components/charts/daily-charts.tsx`. The palette was validated with the dataviz skill's validator; tokens are `--viz-1..3` in `globals.css`.

## Phase 10 (done)

- **Code:** `packages/core/src/warmup.ts` (ramp, spreading, peers, reply decision, text bank, health) and `apps/web/src/lib/warmup/*`, plus the Inngest functions `warmup-tick` and `warmup-send`.
- **Database:** migration 0011 adds `warmup_messages`, `reserve_warmup_slot`, `finish_warmup_send`, `record_warmup_received`, `warmup_stats` and `warmup_daily`.
- **Reply sync:** `processMessage` engages with warmup mail only when the Message-ID matches mail we queued for that inbox. Mailbox writes go through `MailAdapter.engage`.
- **Fake mail server:** now multi-user, delivers locally and supports `UID STORE` and `UID MOVE`.

## Phases 11–12 (done)

- **Phase 11, agent:**
  - The tool catalog and guardrail are in `packages/core/src/agent.ts`; the implementations are in `apps/web/src/lib/agent/*`, behind `/api/agent` with API-key auth.
  - Approvals live in the `agent_approvals` table and are handled under Settings → AI agent.
  - `apps/mcp` is a thin MCP server (stdio + Streamable HTTP) that forwards to `/api/agent`.
  - Decisions: the official MCP SDK was approved.
- **Phase 12, CRM:**
  - The `CrmAdapter` interface and the HubSpot adapter are in `packages/core/src/crm.ts`; sync is in `apps/web/src/lib/crm`, the Inngest functions are `crm-sync-tick` and `crm-sync`, and the page is Settings → Integrations.
  - Decisions: HubSpot uses a private app token, stored encrypted.

## Possible next steps

- Deploy and test against real services. `docs/SETUP_PROMPT.md` walks through it.
- Salesforce adapter, Outlook/Graph (non-goals for v1), billing and multi-tenant signup.
