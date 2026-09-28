# YCAReach

YCAReach is a cold-email outreach CRM. It covers the full loop: upload leads → verify → run multi-step sequences from your own Google / SMTP inboxes → detect replies → stop on reply → work replied leads in a pipeline. An AI agent can drive the whole thing through an MCP server.

It's built for solo use first. Every table is org-scoped with Postgres RLS so it can become multi-tenant SaaS without a rewrite.

> **Status: Phases 1–5 complete** (scaffold, sending accounts, leads & import, verification, sequences & scheduler). See [Roadmap](#roadmap).

## Stack

| Concern | Choice |
|---|---|
| Web app | Next.js 15 (App Router), TypeScript, Tailwind v4, shadcn/ui, deployed on Vercel |
| Data / auth | Supabase: Postgres, Auth, RLS, Storage, Realtime |
| Background jobs | Inngest: lead import, verification, scheduler (cron), per-inbox senders; IMAP sync next |
| Mail | SMTP / IMAP with app passwords (`nodemailer`, `imapflow`, `mailparser`, from Phase 2) |
| Credential encryption | App-level AES-256-GCM, key from env, versioned for rotation |
| Agent control plane | MCP server (`apps/mcp`, Phase 11) |

## Repository layout

```
apps/
  web/            Next.js app (UI, server actions, Inngest endpoint)
  mcp/            MCP server (Phase 11)
packages/
  core/           Pure, unit-tested domain logic: roles, guardrails, validation, crypto, scheduler…
  db/             Supabase-generated TypeScript types
  mail/           Server-only SMTP/IMAP provider adapters (nodemailer, imapflow)
supabase/
  migrations/     All schema changes (never edit the DB by hand)
  seed.sql        Local dev data  (login: dev@example.com / password123)
  tests/rls.sql   Tenancy / RLS isolation tests
```

## Local setup

Prerequisites: Node 22, pnpm 10 (`corepack enable`), and Docker (for the local Supabase stack).

```bash
pnpm install
pnpm db:start                     # boots local Supabase, applies migrations + seed
cp .env.example apps/web/.env.local
#   fill NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from `pnpm db:start` output
pnpm dev                          # http://localhost:3000
pnpm inngest:dev                  # second terminal: Inngest dev server + UI at http://localhost:8288
```

Sign in as **dev@example.com / password123**, or sign up for a fresh account and go through onboarding. Auth emails such as magic links are captured by Inbucket at http://127.0.0.1:54324. Studio runs at http://127.0.0.1:54323.

### Testing inboxes locally

You can connect a real Gmail / Workspace account with an app password. You'll need 2-Step Verification turned on, then create the password at https://myaccount.google.com/apppasswords.

To test against a local mail catcher such as [Mailpit](https://mailpit.axllent.org), set these in `apps/web/.env.local`:

```
MAIL_ALLOW_PRIVATE_HOSTS=true    # allow localhost / private IPs (blocked by default: SSRF guard)
MAIL_ALLOW_PLAINTEXT_AUTH=true   # allow auth without TLS (refused by default)
```

Both flags are ignored when `VERCEL_ENV=production`.

### Useful scripts

| Command | What it does |
|---|---|
| `pnpm db:reset` | Re-create the local DB from migrations + seed |
| `pnpm db:test` | Run RLS / tenancy tests against the local DB |
| `pnpm db:types` | Regenerate `packages/db/src/database.types.ts` after a migration |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` / `pnpm lint` | Static checks |

### Adding a migration

```bash
pnpm supabase migration new <name>     # creates supabase/migrations/<timestamp>_<name>.sql
pnpm db:reset && pnpm db:test && pnpm db:types
```

## Deploying

### Supabase (hosted)

1. Create a project on **Postgres 15 or newer**. The schema uses `ON DELETE SET NULL (column)`.
2. `pnpm supabase link --project-ref <ref>`, then `pnpm supabase db push` to apply the migrations. Don't run `seed.sql` in production.
3. Auth → URL configuration:
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/auth/callback`
4. Auth → Providers → Email: turn on **Confirm email**.
5. Auth → SMTP: point Supabase auth emails at a transactional provider. Don't use your cold-outreach inboxes for this.

### Vercel

1. Import the repo and set the **Root Directory** to `apps/web`. Vercel detects the pnpm workspace and installs from the repo root.
2. Add the environment variables from `.env.example`: Supabase URL, anon key and service-role key, `NEXT_PUBLIC_APP_URL`, and the later-phase keys as those phases land. Do **not** set `INNGEST_DEV` in production.
3. Deploy.
4. Install the **Inngest Vercel integration**. It sets `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, and syncs `https://<your-domain>/api/inngest` on each deploy. The route runs with `maxDuration = 300`; on Vercel Hobby, 60s is the cap.

## Architecture notes

### Tenancy and RLS

- Every tenant row carries `org_id`. Child tables reference parents with **composite foreign keys** `(org_id, parent_id) → parent(org_id, id)`. The database therefore rejects a row in org A pointing at a campaign, lead or inbox in org B, even from service-role code. `supabase/tests/rls.sql` covers this.
- RLS helpers (`private.user_org_ids()`, …) are `SECURITY DEFINER` functions in a schema PostgREST doesn't expose.
- Roles: `viewer` < `sender` < `admin` < `owner`. The permission matrix in `packages/core/src/roles.ts` mirrors the policies, so the UI and the MCP server can refuse early. **The database stays the enforcement layer.**
- Column-level grants stop clients from writing counters, health, IMAP cursors or the kill switch directly.
- The active org comes from a cookie but is always re-validated against the user's memberships (`apps/web/src/lib/org.ts`). No org ID is hard-coded anywhere.

### Credentials

App passwords live in `sending_account_credentials`. Only the service role can read that table: RLS is on with no policies, and all privileges are revoked from `anon` and `authenticated`.

- Values are AES-256-GCM encrypted in the app (`@crm/core/crypto`) before they reach the DB.
- The ciphertext format is `v<keyVersion>:<iv>:<tag>:<data>`.
- The account ID is used as authenticated data, so a ciphertext copied onto another row won't decrypt.
- **Key rotation:** set the new key as `CREDENTIALS_ENCRYPTION_KEY`, bump `CREDENTIALS_ENCRYPTION_KEY_VERSION`, and keep the old key as `CREDENTIALS_ENCRYPTION_KEY_V<old>` until every row has been re-saved.
- The password is never returned to the browser.

### Mail connections

- `@crm/mail` defines a `MailAdapter` interface. `google` and `smtp` share the SMTP/IMAP implementation. `outlook` is declared but throws `ProviderNotImplementedError` until a Graph/OAuth adapter exists.
- **SSRF guard:** a user-supplied host is resolved once and rejected if *any* record points at a private or reserved range. The connection then goes to that pinned IP, with the hostname used only as the TLS servername, so DNS rebinding can't get around the check.
- **No cleartext auth:** non-TLS ports must upgrade with STARTTLS. Credentials never go over an unencrypted connection.
- "Test connection" checks SMTP (sending) and IMAP (opening INBOX read-only, which reply detection needs). Health is `healthy`, `degraded` (only one side works) or `failing`. Only the server can write it.

### Guardrails

- **Kill switch:** `organizations.sending_paused`, changed only through `set_sending_paused()`, which audits every change. Any sender can pause; only admins and owners can resume. The scheduler and every send path must check it (Phase 5).
- **Approval mode:** `draft` (default) or `auto`. Full-auto needs **both** the org and the campaign set to `auto` (`effectiveApprovalMode` in `@crm/core`).
- **`agent_audit_log`** is append-only and written only by the server.

### Lead import

1. The browser parses the CSV (papaparse) for an instant preview, auto-maps columns, and runs a dry-run count. It then uploads the file straight to the private `imports` Storage bucket through a one-time signed URL. File bodies never pass through a server action.
2. An Inngest event (`leads/import.requested`) starts `process-lead-import`, limited to one import at a time per org:
   - **start:** load the import and validate the mapping;
   - **chunk-N:** each chunk of 1,000 rows calls `import_leads_chunk()`, one set-based SQL call that checks the suppression list and existing leads (skip mode, or fill-empty-fields mode) and adds list membership;
   - **finish:** write the error CSV and the final counts.
3. Each step re-derives its rows from the stored file with the same pure functions (`@crm/core/imports`), so no large payloads pass between steps. `import_leads_chunk` is idempotent, so an Inngest retry doesn't change the result.
4. Suppression is authoritative. Adding an address marks the lead, stops its active enrollments and cancels scheduled sends, via a trigger. Send-time checks come in Phase 5.

### Email verification

Verification runs in the Inngest job `verify-leads`. It starts from the leads page (selected leads, or "Verify N unverified"), automatically after each import (org setting, on by default), and later from the agent.

| Check | Result |
|---|---|
| Bad syntax | `invalid` |
| Disposable domain ([community blocklist](https://github.com/disposable-email-domains/disposable-email-domains), subdomains included) | `invalid` |
| Domain doesn't exist (NXDOMAIN) | `invalid` |
| RFC 7505 null MX, or no MX and no A record | `invalid` |
| No MX but has an A record (implicit MX) | `risky` |
| Role address (`info@`, `sales@`, …) | `risky` |
| DNS timeout or SERVFAIL | `unknown` (retried after 1 h) |
| MX present | `valid`, with `detail.level = "mx"` |

- **What `valid` means here:** the domain receives mail. The individual mailbox and catch-all status aren't probed, because that needs an SMTP `RCPT` probe over outbound port 25, which serverless hosts block. A future prober on a small VPS plugs in through `EmailProber` in `@crm/core/verification` and raises `detail.level` to `"smtp"`. No schema change is needed.
- **Domain cache:** DNS results are cached per domain in `domain_checks`, shared across orgs because it's public DNS data. Good results are kept 7 days and temporary failures 1 hour, so a list of 10,000 `@gmail.com` leads costs one lookup. Lookups run 20 at a time with a 3 s timeout.
- **Runs:** each run claims its leads through `leads.verification_run_id`. Batches release leads as their results are written, so retries are idempotent and two runs never fight over a lead.
- **Invalid means never emailed:** a lead that turns out `invalid` has its active enrollments stopped and scheduled sends cancelled straight away. The send path re-checks at send time (Phase 5).
- Changing a lead's email resets it to `unverified`.

### Sequences and sending

```
cron (every minute) ─► scheduler-tick ─► planCampaign()     for each active campaign in unpaused orgs
                                          │  due enrollments → guard → caps → inbox → A/B variant → render
                                          ▼
                                      sends(status=scheduled) ──event──► send-email  (1 at a time per inbox)
                                                                          │ re-check every guard
                                                                          │ reserve_send_slot()  caps + pacing, atomic
                                                                          │ SMTP (own Message-ID, threading, List-Unsubscribe)
                                                                          ▼
                                                                  complete_send() → next step scheduled
```

- **Pure core.** Timezones, windows and DST, delays, variant split, inbox choice and the send guard are pure functions in `@crm/core/scheduler`, covered by unit tests.
- **Send guard.** `checkSend` runs twice: at plan time, and again immediately before SMTP. What happens depends on the check:

  | Check fails | Action |
  |---|---|
  | Kill switch on, or campaign not active | **hold**: re-planned on resume |
  | Suppressed, invalid, risky (unless the campaign opts in), or lead replied / bounced / unsubscribed | **stop** |
  | Verification still pending, or outside the send window | **defer** |
- **Caps and pacing.** Enforced atomically in `reserve_send_slot()` under row locks: the inbox's daily cap in its own timezone, the campaign's per-inbox cap, and the campaign's daily cap. Pacing is a random 3–7 minutes between sends per inbox (`SEND_GAP_*` env overrides it for local testing). A pacing wait is a durable Inngest `sleepUntil`.
- **Threading.** Step 1 picks the inbox with the most room left today. Follow-ups always use the same inbox and send `In-Reply-To`/`References`. A follow-up with an empty subject goes out as `Re: <step 1 subject>`.
- **A/B split.** Deterministic per lead and step (hash of lead and step), weighted, and a promoted winner takes all traffic.
- **Failures:**
  - 5xx recipient rejection → hard bounce: suppressed, and every sequence for that lead stops.
  - Auth failure → the inbox is marked disconnected, and step 1 moves to another inbox.
  - Transient error → retried up to 3 times with backoff.
  - A crash after the SMTP handoff is **never** re-sent.
- **Compliance.** Every email carries `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058 one-click), an HMAC-signed unsubscribe link (`/u/<token>`, with a confirm button so link scanners can't unsubscribe people), and the org's physical address. A campaign can't start without that address.
- **Hooks for later phases.** `stop_lead_sequences()` is ready for reply detection in Phase 7. `approval_mode` is stored per campaign for the agent in Phase 11.

## Roadmap

1. ✅ Scaffold: monorepo, auth, orgs and memberships, schema + RLS, base layout, kill switch, audit log
2. ✅ Sending accounts: add / test / encrypt, connection health
3. ✅ Leads: CSV upload, mapping, dedupe, suppression check
4. ✅ Verification: syntax, MX / DNS, disposable and role checks; statuses; auto-verify on import
5. ✅ Sequences + scheduler: steps, delays, A/B, windows, timezones, caps, pacing, threading, unsubscribe, bounce handling
6. Test email
7. Reply sync: IMAP polling, matching, classification, auto-pipeline
8. Pipeline kanban, lead detail, thread view
9. A/B variants and analytics
10. Warmup pool (beta)
11. MCP server, guardrails, audit log tooling
12. HubSpot adapter
