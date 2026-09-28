# Outreach CRM

A cold-email outreach CRM. It covers the full loop: upload leads → verify → run multi-step sequences from your own Google / SMTP inboxes → detect replies → stop on reply → work replied leads in a pipeline. An AI agent can drive the whole thing through an MCP server.

It's built for solo use first. Every table is org-scoped with Postgres RLS so it can become multi-tenant SaaS without a rewrite.

> **Status: Phases 1–2 complete** (scaffold, sending accounts). See [Roadmap](#roadmap).

## Stack

| Concern | Choice |
|---|---|
| Web app | Next.js 15 (App Router), TypeScript, Tailwind v4, shadcn/ui, deployed on Vercel |
| Data / auth | Supabase: Postgres, Auth, RLS, Storage, Realtime |
| Background jobs | Inngest (Phase 5+) |
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
2. Add the environment variables from `.env.example`: Supabase URL, anon key and service-role key, `NEXT_PUBLIC_APP_URL`, and the later-phase keys as those phases land.
3. Deploy.

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

### Email verification

Verification ships as syntax, MX, disposable-domain and role-address checks. Anything that would need an SMTP `RCPT` probe returns `unknown`. Serverless hosts, Vercel included, block outbound port 25. The prober sits behind an interface so a small port-25 VPS worker can be added later without schema changes.

## Roadmap

1. ✅ Scaffold: monorepo, auth, orgs and memberships, schema + RLS, base layout, kill switch, audit log
2. ✅ Sending accounts: add / test / encrypt, connection health
3. Leads: CSV upload, mapping, dedupe, suppression check
4. Verification: MX / syntax probe worker and statuses
5. Sequences + scheduler (Inngest)
6. Test email
7. Reply sync: IMAP polling, matching, classification, auto-pipeline
8. Pipeline kanban, lead detail, thread view
9. A/B variants and analytics
10. Warmup pool (beta)
11. MCP server, guardrails, audit log tooling
12. HubSpot adapter
