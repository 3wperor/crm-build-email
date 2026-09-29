# YCAReach

YCAReach is a cold-email outreach CRM. It covers the full loop: upload leads → verify → run multi-step sequences from your own Google / SMTP inboxes → detect replies → stop on reply → work replied leads in a pipeline. An AI agent can drive the whole thing through an MCP server.

It's built for solo use first. Every table is org-scoped with Postgres RLS so it can become multi-tenant SaaS without a rewrite.

> **Status: Phases 1–8 complete** (scaffold, sending accounts, leads & import, verification, sequences & scheduler, test email, reply sync, pipeline & lead detail). See [Roadmap](#roadmap).

## Stack

| Concern | Choice |
|---|---|
| Web app | Next.js 15 (App Router), TypeScript, Tailwind v4, shadcn/ui, deployed on Vercel |
| Data / auth | Supabase: Postgres, Auth, RLS, Storage, Realtime |
| Background jobs | Inngest: lead import, verification, scheduler (cron), per-inbox senders, IMAP reply sync (cron) |
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

### Test email

Every variant has a **Test** button. It sends the variant *as currently edited*, saved or not, to any address from any inbox, rendered with a lead from the campaign (or a sample lead).

- The subject is prefixed `[TEST]`, and follow-ups show their real `Re:` subject.
- Delivery errors (auth, 550, TLS…) appear inline, with the same hints as the connection test.
- Tests never touch campaign sends, caps or the suppression list.
- They're logged in `test_sends` and limited to 20 per hour per user or agent.
- The kill switch blocks them too.
- The logic lives in `lib/test-email.ts` so the MCP `send_test_email` tool can reuse it.

### Reply detection

Every 3 minutes, `imap-sync-tick` fans out one `imap-sync-account` job per active inbox, one at a time per inbox.

**Fetch.** Each job reads new mail read-only from INBOX and the `\Junk` mailbox (Gmail's Spam), using per-mailbox UID cursors stored in `sending_accounts.imap_cursors`. On the first sync, or after a UIDVALIDITY change, the job starts from "now" rather than importing old mail. Cursors advance only after every message in the batch has been processed.

**Skip.** Our own mail, test emails (`X-YCAReach-Test`), duplicates (replies are unique by Message-ID) and unrelated mail (no matching send) are never stored.

**Bounces.** Delivery-status notifications are parsed with `parseBounce`. A 5.x.x status marks the send bounced, suppresses the address and stops the sequence; 4.x.x is only logged.

**Matching** (`pickReplyMatch`), in priority order:
1. `In-Reply-To` against our Message-IDs.
2. `References`, newest first.
3. Sender address plus a send to that same address from this inbox within 30 days.

**Classification** (`classifyReplyHeuristic`):
- Quoted history is stripped first.
- Checks run in order: auto-reply headers/subject/wording → out of office (with a return date when one is given) → unsubscribe → negative → positive.
- Anything else is a low-confidence neutral.
- Optionally, only those low-confidence replies go to Claude (`@anthropic-ai/sdk`: structured JSON output, low effort, server-side refusal fallback). It's enabled per workspace in Settings and needs `ANTHROPIC_API_KEY`; the model is `AI_CLASSIFIER_MODEL`, default `claude-opus-5-5`. Any AI failure keeps the rule-based result.

**Outcomes** (`apply_reply_outcome`, atomic and idempotent, re-run on manual reclassification):

| Classification | What happens |
|---|---|
| Out of office | Sequence continues; the next step moves to the return date (or +3 days); anything already scheduled is pulled back |
| Unsubscribe | Suppressed, every sequence stopped, no pipeline card |
| Negative | Every sequence stopped, lead marked replied, pipeline → **Closed Lost** |
| Positive / neutral | Every sequence stopped, lead marked replied, pipeline → **Replied** |

**Local testing.** `packages/mail/src/testing/fake-mail.ts` is a fake SMTP + IMAP server, used by the unit tests and runnable standalone:

```bash
node --experimental-strip-types packages/mail/src/testing/run-fake-mail.mjs
```

### Pipeline and lead detail

**Kanban** (`/pipeline`):
- Built on `@dnd-kit/core`. Mouse and touch drags start after a 6px move. On the keyboard, Space picks a card up, ←/→ jump between columns, and Space drops it.
- Screen readers hear names ("Grace Hopper is over Interested"), not internal IDs.
- Every card also has an accessible **Move to…** menu.
- Moves are optimistic and roll back on error.
- The board refreshes through Supabase Realtime when replies or cards change; RLS applies to what each browser receives.
- Viewers get a read-only board.

**Stages** (`/pipeline/stages`, admins only):
- Rename, set the type (open / won / lost), add, and reorder. Reordering goes through `reorder_pipeline_stages`, which rewrites positions atomically.
- Choose the **entry stage**, where replies land (`set_entry_stage`: exactly one, and it must be open).
- Negative replies go to the first *lost* stage.
- Guards: a stage that still has cards can't be deleted (foreign key), and neither can the entry stage.

**Lead page** (`/leads/[id]`):
- The full conversation: every email sent and every reply, across campaigns.
- Editable fields and custom fields; keys are normalized to `snake_case` and usable as `{{field}}` in emails.
- Notes: authors, owners and admins can delete them.
- Pipeline card: stage, booking link, add or remove manually.
- Campaign enrollments, list memberships, suppression status and verification details.

### Analytics, tracking and A/B tests

**Open and click tracking** is off by default and turned on per campaign under Settings, because it can hurt deliverability.
- It is added only at send time. The stored body, the thread view and test emails never carry it.
- **Opens:** a signed `/t/o/<token>` pixel, served as an uncached GIF. A forged token still gets the GIF but records nothing.
- **Clicks:** links in the HTML part go through `/t/c/<token>`, which redirects (302) to the original URL. The token signs the destination as well as the send, so it can't be used as an open redirect.
- **Never tracked:** the unsubscribe link and the plain-text part.
- **Bot filtering:** hits within 60 s of sending, from known security scanners (Barracuda, Proofpoint, Mimecast, curl…) or with no user agent are stored with `meta.bot = true` and left out of every rate. A click also counts as an open.
- **Flood protection:** at most 20 events per send and type (`record_tracking_event`).

**Reports:**
- `/analytics` has a 7/30/90-day range and campaign and inbox filters.
- It shows headline figures, sends per day and responses per day (inline SVG with hover and keyboard readouts, plus a table view), and breakdowns by campaign, inbox and variant.
- Headline figures and tables count the sends made in the range plus everything that came back from them, so rates can't exceed 100%.
- The charts count responses on the day they arrived.
- "Delivered" means sent minus bounced.
- Bounce rates above 3% are flagged.
- The queries are `analytics_breakdown` and `analytics_daily`. Both are security invoker, so RLS scopes them.

**A/B tests** (campaign → Results):
- **Metric:** variants are compared on **reply rate**, because open rates are distorted by Apple Mail Privacy Protection and image proxies.
- **Display:** each rate comes with a 95% Wilson interval.
- **Winner rule:** the leading variant must beat every other active variant with a two-proportion z-test, p < 0.05 / (k − 1) (Bonferroni). Each variant also needs at least 100 sends, and the leader at least 5 replies. See `evaluateAbTest` in `packages/core/src/analytics.ts`.
- **Caveat:** checking a running test repeatedly still raises the chance of a false winner. The floors reduce that risk but don't remove it.
- **Manual promotion:** **Promote** gives a variant every new send for its step (`pickVariant` honours `is_winner`), and **Clear winner** restores the weighted split.
- **Audit:** both go through `set_variant_winner`, which writes to the audit log. `is_winner` can't be changed directly.
- **Auto-promote** (a per-campaign setting): the `ab-evaluate` Inngest cron runs every 30 minutes, or on the `ab/evaluate.requested` event. It promotes significant winners in active campaigns, acting as `system:ab-auto-promote`, and never overrides an existing winner.

### Warmup pool (beta)

Warmup runs **only between your workspace's own inboxes**, and needs at least two. There is no shared pool across customers.

**Ramp:**
- Each inbox starts at 2 new warmup emails a day and adds *increase per day* (default 2) up to a target (default 20, maximum 50).
- Weekends get half the volume.
- The day's quota is spread over 08:00–18:00 in the inbox's timezone. The `warmup-tick` cron runs every 10 minutes and queues at most 3 per inbox per tick, each to the peer emailed least today.
- The ramp restarts when warmup was off for more than 3 days or is restarted after an auto-pause.

**Sharing with cold mail:**
- Warmup and cold mail share pacing (3–7 min gaps) and the inbox's **daily cap** through `reserve_warmup_slot`: at full ramp, a cap of 30 with a target of 20 leaves 10 for campaigns.
- The **kill switch** stops warmup too.

**Content:** a built-in bank of neutral business snippets (subjects, greetings, bodies, sign-offs; `packages/core/src/warmup.ts`). No AI and no third-party API. Every warmup email carries `X-YCAReach-Warmup: 1`.

**Engagement:** when the receiving inbox syncs (IMAP, INBOX + Spam), a warmup email we queued is:
- opened (`\Seen`), and starred about 15% of the time;
- **moved out of Spam into INBOX**, with the spam landing recorded;
- replied to at the inbox's reply rate (default 30%, max 60%, up to 4 messages per thread). Replies go out in-thread after a short delay and count toward the replier's cap but not its quota.

The header alone proves nothing: only Message-IDs we queued for that inbox count as warmup. Anything else goes through normal reply detection, so a forged header can't hide a real reply. Warmup mail never appears in Replies, the pipeline or Analytics.

**Health:**
- Each inbox is scored by inbox placement at its peers over the last 7 days.
- It **auto-pauses** when more than 20% of its warmup mail lands in spam (with at least 10 received) or when 2 warmup emails bounce. The pause is audited as `warmup.auto_pause`.
- Pausing cancels its queued mail. **Restart warmup** clears the pause and restarts the ramp.

**Testing locally:** the fake mail server accepts any `@example.test` user with the fake password and delivers mail between them. `POST /spam/<address>` routes that recipient's incoming mail to Spam. `WARMUP_JITTER_SECONDS` and `WARMUP_REPLY_DELAY_*` shorten the delays.

### AI agent control plane (MCP)

The architecture has three parts:
- **Where the logic lives:** all agent logic is in the web app (`apps/web/src/lib/agent/*`) behind `POST /api/agent`, authenticated with a workspace API key (`Authorization: Bearer ycr_…`).
- **The MCP server:** `apps/mcp` is a thin server that forwards MCP tool calls to that endpoint.
- **Tool catalog and guardrail:** both live in `@crm/core/agent` (`AGENT_TOOLS`, `agentGuard`), with tests.

**API keys:**
- Created by owners and admins under Settings → AI agent.
- Shown once; only the SHA-256 hash is stored.
- Scoped to one workspace, and revocable (takes effect immediately).

**Tools (27).** The spec's list, plus `enroll_leads` and `pause_all_sending` (the kill switch). Inputs are validated with Zod, and the hard caps (daily volume, per-inbox limits, lead batch sizes) are part of the schemas.

**Guardrails:**

| Risk | Tools | Behaviour |
|---|---|---|
| read | list/get/analytics/status/audit log | always allowed |
| write | drafts, copy, leads, enrollment, send window, pipeline, reply classification, add or test inbox | allowed (none of these can send by themselves) |
| send | `start_campaign`, raising `set_daily_volume`, `send_test_email` to a non-member | **queued for approval** unless the workspace AND the campaign are full-auto |
| safety | `pause_campaign`, `add_to_suppression`, `pause_all_sending` | always allowed |

**Hard limits on the agent:**
- It can **never** resume sending, change approval modes, remove suppressions, or turn on "include risky leads".
- Inboxes it adds start **paused** until a human activates them.
- The send path still enforces suppression, verification, caps and pacing.

**Approvals and audit:**
- Pending requests appear under Settings → AI agent with Approve / Reject.
- Approving runs the call, claimed atomically so it can't run twice.
- Every call is written to `agent_audit_log`: allowed, pending, denied or failed. Passwords and tokens are redacted from the log.

**Running the MCP server:**

```bash
# stdio, e.g. for Claude Desktop / Claude Code
YCAREACH_URL=https://your-app.vercel.app YCAREACH_API_KEY=ycr_… pnpm --filter @crm/mcp start
# Streamable HTTP on :3333/mcp; each request sends its own Bearer key
YCAREACH_URL=https://your-app.vercel.app pnpm --filter @crm/mcp start:http
```

Claude Desktop config:

```json
{ "mcpServers": { "ycareach": {
  "command": "node",
  "args": ["--experimental-strip-types", "--no-warnings", "/path/to/repo/apps/mcp/src/index.ts"],
  "env": { "YCAREACH_URL": "https://your-app.vercel.app", "YCAREACH_API_KEY": "ycr_…" } } } }
```

(`pnpm install` first; Node 22.6+.)

## Roadmap

1. ✅ Scaffold: monorepo, auth, orgs and memberships, schema + RLS, base layout, kill switch, audit log
2. ✅ Sending accounts: add / test / encrypt, connection health
3. ✅ Leads: CSV upload, mapping, dedupe, suppression check
4. ✅ Verification: syntax, MX / DNS, disposable and role checks; statuses; auto-verify on import
5. ✅ Sequences + scheduler: steps, delays, A/B, windows, timezones, caps, pacing, threading, unsubscribe, bounce handling
6. ✅ Test email
7. ✅ Reply sync: IMAP polling (+ spam folder), matching, bounce parsing, classification (rules + optional AI), auto-pipeline
8. ✅ Pipeline kanban, lead detail, thread view
9. ✅ A/B variants and analytics (+ open/click tracking)
10. ✅ Warmup pool (beta)
11. ✅ MCP server, guardrails, approvals, audit log, kill switch
12. HubSpot adapter
