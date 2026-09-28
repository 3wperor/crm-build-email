-- =============================================================================
-- 0002 Outreach domain schema.
-- See 0001 for conventions (composite org FKs, text+CHECK enums, lowercase emails).
-- =============================================================================

-- Every tenant table gets UNIQUE (org_id, id) so children can reference it with
-- a composite FK. organizations needs no such key (org_id IS the id).

-- -----------------------------------------------------------------------------
-- domains (optional grouping of sending accounts)
-- -----------------------------------------------------------------------------
create table public.domains (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (name = lower(name)),
  created_at  timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name)
);

-- -----------------------------------------------------------------------------
-- sending_accounts
-- -----------------------------------------------------------------------------
create table public.sending_accounts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  domain_id          uuid,
  email              text not null check (email = lower(email)),
  display_name       text,
  provider           text not null check (provider in ('google', 'smtp', 'outlook')),
  -- Connection settings (host/port filled from provider presets for 'google').
  smtp_host          text not null,
  smtp_port          integer not null check (smtp_port between 1 and 65535),
  smtp_secure        boolean not null default true,
  imap_host          text not null,
  imap_port          integer not null check (imap_port between 1 and 65535),
  imap_secure        boolean not null default true,
  username           text not null,
  timezone           text,
  -- Volume
  daily_cap          integer not null default 30 check (daily_cap between 1 and 2000),
  sent_today         integer not null default 0 check (sent_today >= 0),
  sent_today_date    date,                 -- day (in account tz) sent_today refers to
  -- Warmup
  warmup_enabled     boolean not null default false,
  warmup_stage       integer not null default 0 check (warmup_stage >= 0),
  warmup_daily_target integer not null default 0 check (warmup_daily_target >= 0),
  -- Health
  status             text not null default 'active' check (status in ('active', 'paused', 'disconnected')),
  health             text not null default 'unknown' check (health in ('unknown', 'healthy', 'degraded', 'failing')),
  health_score       integer check (health_score between 0 and 100),
  health_detail      text,
  last_checked_at    timestamptz,
  -- IMAP sync cursor
  imap_uidvalidity   bigint,
  imap_last_uid      bigint,
  imap_last_synced_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, email),
  foreign key (org_id, domain_id) references public.domains (org_id, id) on delete set null (domain_id)
);

create trigger sending_accounts_updated_at before update on public.sending_accounts
  for each row execute function private.set_updated_at();
create trigger sending_accounts_normalize_email before insert or update of email on public.sending_accounts
  for each row execute function private.normalize_email();

-- Credentials live in their own table that ONLY the service role can touch.
-- Ciphertext is app-level AES-256-GCM ("v<key_version>:<iv>:<tag>:<data>").
-- Nothing in the client-facing API can ever select it.
create table public.sending_account_credentials (
  account_id   uuid primary key,
  org_id       uuid not null,
  ciphertext   text not null,
  key_version  integer not null default 1,
  updated_at   timestamptz not null default now(),
  foreign key (org_id, account_id) references public.sending_accounts (org_id, id) on delete cascade
);

create trigger sending_account_credentials_updated_at before update on public.sending_account_credentials
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- suppression_list
-- -----------------------------------------------------------------------------
create table public.suppression_list (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  email       text not null check (email = lower(email)),
  reason      text not null check (reason in ('unsubscribe', 'hard_bounce', 'complaint', 'manual')),
  source      text,              -- e.g. 'reply:<id>', 'import', 'agent', 'user:<id>'
  created_at  timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, email)
);

create trigger suppression_list_normalize_email before insert or update of email on public.suppression_list
  for each row execute function private.normalize_email();

-- -----------------------------------------------------------------------------
-- lead_lists / imports / leads
-- -----------------------------------------------------------------------------
create table public.lead_lists (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (org_id, id)
);

create table public.imports (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  list_id            uuid,
  filename           text not null,
  storage_path       text,
  status             text not null default 'pending'
                       check (status in ('pending', 'processing', 'completed', 'failed')),
  column_mapping     jsonb not null default '{}'::jsonb,
  total_rows         integer not null default 0,
  imported_count     integer not null default 0,
  duplicate_count    integer not null default 0,
  suppressed_count   integer not null default 0,
  invalid_count      integer not null default 0,
  error_report_path  text,
  error              text,
  created_by         uuid references public.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  unique (org_id, id),
  foreign key (org_id, list_id) references public.lead_lists (org_id, id) on delete set null (list_id)
);

create table public.leads (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete cascade,
  email                text not null check (email = lower(email)),
  first_name           text,
  last_name            text,
  company              text,
  title                text,
  custom_json          jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_json) = 'object'),
  status               text not null default 'new'
                         check (status in ('new', 'in_sequence', 'replied', 'bounced', 'unsubscribed', 'do_not_contact')),
  verification_status  text not null default 'unverified'
                         check (verification_status in ('unverified', 'pending', 'valid', 'invalid', 'risky', 'unknown')),
  verification_detail  jsonb,
  verified_at          timestamptz,
  import_id            uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, email),
  foreign key (org_id, import_id) references public.imports (org_id, id) on delete set null (import_id)
);

create index leads_org_status_idx on public.leads (org_id, status);
create index leads_org_verification_idx on public.leads (org_id, verification_status);
create index leads_org_created_idx on public.leads (org_id, created_at desc);

create trigger leads_updated_at before update on public.leads
  for each row execute function private.set_updated_at();
create trigger leads_normalize_email before insert or update of email on public.leads
  for each row execute function private.normalize_email();

create table public.lead_list_members (
  org_id    uuid not null,
  list_id   uuid not null,
  lead_id   uuid not null,
  added_at  timestamptz not null default now(),
  primary key (list_id, lead_id),
  foreign key (org_id, list_id) references public.lead_lists (org_id, id) on delete cascade,
  foreign key (org_id, lead_id) references public.leads (org_id, id) on delete cascade
);

create index lead_list_members_lead_idx on public.lead_list_members (lead_id);

-- -----------------------------------------------------------------------------
-- campaigns / sequences / steps / variants
-- -----------------------------------------------------------------------------
create table public.campaigns (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations (id) on delete cascade,
  name                   text not null check (length(btrim(name)) between 1 and 200),
  status                 text not null default 'draft'
                           check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  timezone               text not null default 'UTC',
  send_window_start      time not null default '09:00',
  send_window_end        time not null default '17:00',
  -- ISO weekdays: 1 = Monday ... 7 = Sunday
  send_days              smallint[] not null default '{1,2,3,4,5}'
                           check (send_days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(send_days) > 0),
  daily_limit            integer not null default 50 check (daily_limit between 0 and 10000),
  daily_limit_per_inbox  integer not null default 30 check (daily_limit_per_inbox between 0 and 2000),
  approval_mode          text not null default 'draft' check (approval_mode in ('draft', 'auto')),
  track_opens            boolean not null default false,
  track_clicks           boolean not null default false,
  auto_promote_winner    boolean not null default false,
  created_by             uuid references public.users (id) on delete set null,
  started_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (org_id, id),
  check (send_window_start <> send_window_end)
);

create index campaigns_org_status_idx on public.campaigns (org_id, status);

create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function private.set_updated_at();

-- Which inboxes a campaign rotates through.
create table public.campaign_sending_accounts (
  org_id              uuid not null,
  campaign_id         uuid not null,
  sending_account_id  uuid not null,
  created_at          timestamptz not null default now(),
  primary key (campaign_id, sending_account_id),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete cascade,
  foreign key (org_id, sending_account_id) references public.sending_accounts (org_id, id) on delete cascade
);

-- One sequence per campaign (sequences.campaign_id is UNIQUE), so campaigns
-- does not need a back-pointer `sequence_id`.
create table public.sequences (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  campaign_id    uuid not null unique,
  stop_on_reply  boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete cascade
);

create table public.sequence_steps (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  sequence_id  uuid not null,
  step_order   integer not null check (step_order >= 1),
  delay_days   integer not null default 0 check (delay_days between 0 and 365),
  delay_hours  integer not null default 0 check (delay_hours between 0 and 23),
  created_at   timestamptz not null default now(),
  unique (org_id, id),
  unique (sequence_id, step_order) deferrable initially immediate,
  foreign key (org_id, sequence_id) references public.sequences (org_id, id) on delete cascade
);

create table public.email_variants (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  step_id     uuid not null,
  ab_group    text not null default 'A',
  subject     text not null default '',
  body        text not null default '',
  weight      integer not null default 100 check (weight between 0 and 10000),
  is_active   boolean not null default true,
  is_winner   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, id),
  unique (step_id, ab_group),
  foreign key (org_id, step_id) references public.sequence_steps (org_id, id) on delete cascade
);

create trigger email_variants_updated_at before update on public.email_variants
  for each row execute function private.set_updated_at();

-- Per-lead enrollment state in a campaign. This is what the scheduler walks.
create table public.campaign_leads (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null,
  campaign_id          uuid not null,
  lead_id              uuid not null,
  status               text not null default 'queued'
                         check (status in ('queued', 'active', 'paused', 'completed', 'replied',
                                           'bounced', 'unsubscribed', 'stopped', 'failed')),
  current_step_order   integer not null default 0,  -- last step sent (0 = none yet)
  next_send_at         timestamptz,
  sending_account_id   uuid,                        -- sticky inbox for the whole thread
  stopped_reason       text,
  last_sent_at         timestamptz,
  enrolled_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, id),
  unique (campaign_id, lead_id),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete cascade,
  foreign key (org_id, lead_id) references public.leads (org_id, id) on delete cascade,
  foreign key (org_id, sending_account_id) references public.sending_accounts (org_id, id)
    on delete set null (sending_account_id)
);

create index campaign_leads_due_idx on public.campaign_leads (next_send_at)
  where status in ('queued', 'active');
create index campaign_leads_lead_idx on public.campaign_leads (lead_id);

create trigger campaign_leads_updated_at before update on public.campaign_leads
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- sends
-- -----------------------------------------------------------------------------
create table public.sends (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  campaign_id         uuid not null,
  campaign_lead_id    uuid not null,
  lead_id             uuid not null,
  step_id             uuid,
  variant_id          uuid,
  sending_account_id  uuid,
  status              text not null default 'scheduled'
                        check (status in ('pending_approval', 'scheduled', 'sending', 'sent',
                                          'failed', 'bounced', 'cancelled')),
  message_id          text,          -- RFC 5322 Message-ID we generated
  in_reply_to         text,          -- previous send's Message-ID (threads follow-ups)
  subject             text,
  body_html           text,
  body_text           text,
  scheduled_at        timestamptz,
  sent_at             timestamptz,
  error               text,
  attempt_count       integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, id),
  -- A lead can never receive the same step twice in a campaign.
  unique (campaign_lead_id, step_id),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete cascade,
  foreign key (org_id, campaign_lead_id) references public.campaign_leads (org_id, id) on delete cascade,
  foreign key (org_id, lead_id) references public.leads (org_id, id) on delete cascade,
  foreign key (org_id, step_id) references public.sequence_steps (org_id, id) on delete set null (step_id),
  foreign key (org_id, variant_id) references public.email_variants (org_id, id) on delete set null (variant_id),
  foreign key (org_id, sending_account_id) references public.sending_accounts (org_id, id)
    on delete set null (sending_account_id)
);

create unique index sends_message_id_idx on public.sends (message_id) where message_id is not null;
create index sends_org_status_scheduled_idx on public.sends (org_id, status, scheduled_at);
create index sends_account_sent_idx on public.sends (sending_account_id, sent_at desc);
create index sends_lead_idx on public.sends (lead_id);
create index sends_campaign_sent_idx on public.sends (campaign_id, sent_at);

create trigger sends_updated_at before update on public.sends
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- replies
-- -----------------------------------------------------------------------------
create table public.replies (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null,
  sending_account_id     uuid,
  send_id                uuid,
  lead_id                uuid,
  message_id             text not null,
  in_reply_to            text,
  "references"           text[] not null default '{}',
  from_email             text not null,
  subject                text,
  body_text              text,
  body_html              text,
  classification         text check (classification in ('positive', 'negative', 'out_of_office',
                                                        'unsubscribe', 'neutral')),
  classification_source  text check (classification_source in ('heuristic', 'ai', 'manual')),
  match_method           text check (match_method in ('in_reply_to', 'references', 'from_email', 'none')),
  received_at            timestamptz not null,
  created_at             timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, message_id),
  foreign key (org_id, sending_account_id) references public.sending_accounts (org_id, id)
    on delete set null (sending_account_id),
  foreign key (org_id, send_id) references public.sends (org_id, id) on delete set null (send_id),
  foreign key (org_id, lead_id) references public.leads (org_id, id) on delete set null (lead_id)
);

create index replies_org_received_idx on public.replies (org_id, received_at desc);
create index replies_lead_idx on public.replies (lead_id);

-- -----------------------------------------------------------------------------
-- events (open / click / bounce / reply / unsubscribe / delivered)
-- -----------------------------------------------------------------------------
create table public.events (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,
  send_id     uuid not null,
  type        text not null check (type in ('delivered', 'open', 'click', 'bounce', 'reply', 'unsubscribe')),
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  foreign key (org_id, send_id) references public.sends (org_id, id) on delete cascade
);

create index events_send_type_idx on public.events (send_id, type);
create index events_org_created_idx on public.events (org_id, created_at);

-- -----------------------------------------------------------------------------
-- pipeline
-- -----------------------------------------------------------------------------
create table public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null,
  position    integer not null,
  kind        text not null default 'open' check (kind in ('open', 'won', 'lost')),
  -- The stage replies land in automatically. Exactly one per org (partial index).
  is_entry    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, position) deferrable initially immediate
);

create unique index pipeline_stages_one_entry_idx on public.pipeline_stages (org_id) where is_entry;

create table public.opportunities (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  lead_id       uuid not null,
  stage_id      uuid not null,
  campaign_id   uuid,
  source        text not null check (source in ('reply', 'manual')),
  booking_link  text,
  notes         text,
  moved_at      timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, lead_id),
  foreign key (org_id, lead_id) references public.leads (org_id, id) on delete cascade,
  foreign key (org_id, stage_id) references public.pipeline_stages (org_id, id) on delete restrict,
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete set null (campaign_id)
);

create index opportunities_stage_idx on public.opportunities (stage_id);

-- -----------------------------------------------------------------------------
-- warmup_events
-- -----------------------------------------------------------------------------
create table public.warmup_events (
  id               bigint generated always as identity primary key,
  org_id           uuid not null,
  account_id       uuid not null,
  -- Peer may be in another org once the pool goes cross-tenant, so no composite FK.
  peer_account_id  uuid references public.sending_accounts (id) on delete set null,
  type             text not null check (type in ('sent', 'received', 'replied', 'rescued_from_spam', 'bounced')),
  message_id       text,
  created_at       timestamptz not null default now(),
  foreign key (org_id, account_id) references public.sending_accounts (org_id, id) on delete cascade
);

create index warmup_events_account_created_idx on public.warmup_events (account_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Defaults seeded for every new org (called from create_organization).
-- -----------------------------------------------------------------------------
create or replace function private.seed_org_defaults(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- (position is a deferrable unique, which ON CONFLICT cannot arbitrate on)
  if exists (select 1 from public.pipeline_stages where org_id = p_org_id) then
    return;
  end if;
  insert into public.pipeline_stages (org_id, name, position, kind, is_entry) values
    (p_org_id, 'Replied',        1, 'open', true),
    (p_org_id, 'Interested',     2, 'open', false),
    (p_org_id, 'Meeting Booked', 3, 'open', false),
    (p_org_id, 'Closed Won',     4, 'won',  false),
    (p_org_id, 'Closed Lost',    5, 'lost', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Realtime (Supabase-only; guarded so plain Postgres can apply migrations too).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.replies, public.opportunities, public.imports, public.organizations;
  end if;
end;
$$;
