# Handoff prompt: walk the owner through setting up YCAReach

Paste everything below the line into a new AI session that has access to the GitHub repo `3wperor/crm-build-email`.

---

You're helping me, the owner, deploy and start using **YCAReach**, a cold email outreach CRM that was built for me in an earlier AI session. I'm not deeply technical. Walk me through setup **one step at a time**: tell me exactly where to click and what to paste, wait for me to confirm each step, and help me debug when something fails.

## The code

- Repo: `github.com/3wperor/crm-build-email`, branch **`claude/nifty-gates-nmn656`**. All the work is on this branch and has not been merged into `main` yet. The first step is to decide with me: either open and merge a pull request into `main`, or deploy straight from the branch.
- Before you explain anything, read these three files. They are the source of truth. If this prompt and the code disagree, trust the code and tell me.
  - `README.md`: architecture, local setup, deploy steps, and how each feature works.
  - `docs/HANDOFF.md`: phase status, decisions I already made (don't ask me again), and what hasn't been tested against real services.
  - `.env.example`: every environment variable, with comments.

## What it is (so you can explain it to me)

The stack is a pnpm monorepo:
- `apps/web`: a Next.js 15 app, deployed on Vercel.
- `packages/core`: pure logic, with tests.
- `packages/mail`: SMTP/IMAP (nodemailer, imapflow).
- `packages/db`: database types.

It runs on Supabase (Postgres with row-level security on every table, Auth, Storage, Realtime) and uses Inngest for background jobs.

What works (phases 1–10 are done):
- Inboxes connected with app passwords. Credentials are encrypted with AES-256-GCM, and connections are tested.
- CSV lead import with dedupe and a suppression list, then email verification (syntax, MX, disposable, role addresses).
- Sequences with A/B variants, send windows, timezones, daily caps and 3–7 minute pacing. Follow-ups stay in the same thread, and one-click unsubscribe is built in.
- Test emails, and a "Pause all sending" kill switch.
- IMAP reply sync, including the spam folder: bounce detection, rule-based reply classification (optional AI with an Anthropic key), and automatic pipeline cards.
- A kanban pipeline and lead pages.
- Analytics: opt-in open/click tracking and A/B significance testing with a winner promoter.
- A warmup pool (beta) between my own inboxes.

Also built (optional to set up):
- Phase 11: an MCP server so an AI agent can operate the CRM within approval guardrails. See the README section "AI agent control plane (MCP)".
- Phase 12: HubSpot sync using a private app token. See the README section "CRM sync (HubSpot)".

Offer these only after the core setup works.

Everything passes automated tests against a **local fake mail server**, but it has **never been run against real services**. Expect first-contact issues with the following (help me read logs, identify the problem and fix it):
- a real Gmail inbox;
- hosted Supabase Storage (CSV upload);
- Realtime;
- the Inngest Cloud sync.

## The setup path (confirm the details against the README as you go)

1. **Accounts.** I need Supabase, Vercel and Inngest accounts, and GitHub access to the repo.
2. **Supabase project** (Postgres 15+).
   - Apply the migrations in `supabase/migrations` with `supabase link` and `supabase db push`, or by pasting them in order into the SQL editor if I can't use a CLI.
   - Don't run `seed.sql` in production.
   - Auth settings: set the Site URL to my Vercel domain and add the redirect URL `https://<domain>/auth/callback`. Turn on email confirmation, and point auth emails at a transactional SMTP provider, never at my outreach inboxes.
   - Check that the `imports` storage bucket exists after the migrations.
3. **Secrets.** Generate `CREDENTIALS_ENCRYPTION_KEY` and `LINK_SIGNING_SECRET`, for example with `openssl rand -base64 32`, or show me a browser-safe way.
   - Tell me to store them in a password manager.
   - If the encryption key is lost, every saved inbox password becomes unreadable.
   - If the signing secret changes, old unsubscribe links stop working.
4. **Vercel.**
   - Import the repo and set the Root Directory to `apps/web`.
   - Set the environment variables from `.env.example`: `NEXT_PUBLIC_APP_URL`, the Supabase URL and anon and service-role keys, `CREDENTIALS_ENCRYPTION_KEY` with `_VERSION=1`, `LINK_SIGNING_SECRET`, and optionally `ANTHROPIC_API_KEY`.
   - Do **not** set `INNGEST_DEV`, `MAIL_ALLOW_*` or `SEND_GAP_*`/`WARMUP_*` in production.
   - Check my Vercel plan against the Inngest route's `maxDuration = 300` in `apps/web/src/app/api/inngest/route.ts`. Hobby caps function duration lower. If I'm on Hobby, tell me the options: upgrade, or lower the value.
5. **Inngest.**
   - Install the Inngest Vercel integration, which sets `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` and syncs `https://<domain>/api/inngest`.
   - Confirm in the Inngest dashboard that the app `ycareach` and its functions appear: imports, verification, scheduler tick and send, IMAP sync, A/B evaluate, warmup tick and send.
6. **First login.** Sign up, create the workspace, and fill in the physical mailing address in Settings; it's required in every email for CAN-SPAM.
7. **Sending domain DNS.** Before any real volume, check SPF, DKIM and DMARC for the domain I send from, and explain them simply. Recommend a separate domain for cold outreach, not my main one.
8. **Connect one Gmail/Workspace inbox.**
   - It needs 2-step verification, an app password, and IMAP enabled.
   - Use "Test connection" before saving.
   - Keep the daily cap low (20–30) at first, and consider warmup for new inboxes.
9. **Smoke test with myself.**
   - Import a tiny CSV containing a couple of my own addresses.
   - Create a campaign, send a test email, then start it with 1–2 leads.
   - Check that the email arrives, reply to it, and check it appears in Replies and the Pipeline.
   - Click unsubscribe and check it lands on the suppression list.
   - Watch the Inngest runs for errors.
10. **Then** real leads at low volume, and the Analytics page.

## How to work with me

- One step at a time: tell me what I should see, then wait for my confirmation.
- When something fails, ask me for the exact error text, a screenshot, or the Vercel, Inngest or Supabase logs. Then find the cause in the code before suggesting a fix.
- If a fix needs a code change, make it on the branch, explain it in one or two sentences, and keep it minimal.
- Never ask me to paste secrets into chat. Tell me where to put them instead.
- Keep your explanations short and plain. I care about getting it working safely, not about theory.
