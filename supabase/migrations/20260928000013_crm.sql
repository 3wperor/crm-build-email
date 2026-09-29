-- =============================================================================
-- 0013 CRM integrations (HubSpot first). YCAReach stays the source of truth;
-- pipeline cards are pushed out as contacts + deals.
-- =============================================================================

create table public.crm_connections (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  provider        text not null check (provider in ('hubspot')),
  status          text not null default 'connected' check (status in ('connected', 'error', 'disabled')),
  account_label   text,                               -- e.g. HubSpot portal id
  pipeline_id     text,                               -- external deal pipeline
  stage_map       jsonb not null default '{}'::jsonb, -- { "<our stage id>": "<external stage id>" }
  last_synced_at  timestamptz,
  last_error      text,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, provider),
  unique (org_id, id)
);

create trigger crm_connections_updated_at before update on public.crm_connections
  for each row execute function private.set_updated_at();

-- Access tokens: service role only (like inbox passwords), AES-256-GCM with the connection id as AAD.
create table public.crm_credentials (
  connection_id  uuid primary key,
  org_id         uuid not null,
  ciphertext     text not null,
  key_version    integer not null default 1,
  updated_at     timestamptz not null default now(),
  foreign key (org_id, connection_id) references public.crm_connections (org_id, id) on delete cascade
);

-- Which external record each local record became.
create table public.crm_links (
  id             bigint generated always as identity primary key,
  org_id         uuid not null,
  connection_id  uuid not null,
  object         text not null check (object in ('contact', 'deal')),
  local_id       uuid not null,                     -- lead id (contact) / opportunity id (deal)
  external_id    text not null,
  synced_at      timestamptz not null default now(),
  unique (connection_id, object, local_id),
  foreign key (org_id, connection_id) references public.crm_connections (org_id, id) on delete cascade
);

-- Sync picks up cards moved or edited since the last run.
alter table public.opportunities add column updated_at timestamptz not null default now();
create trigger opportunities_updated_at before update on public.opportunities
  for each row execute function private.set_updated_at();
create index opportunities_org_updated_idx on public.opportunities (org_id, updated_at);

alter table public.crm_connections enable row level security;
alter table public.crm_credentials enable row level security;
alter table public.crm_links enable row level security;

create policy crm_connections_select on public.crm_connections for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy crm_links_select on public.crm_links for select to authenticated
  using (org_id in (select private.user_org_ids()));
-- Connecting, mapping and syncing go through server actions (admin role check + token encryption).
revoke insert, update, delete, truncate on public.crm_connections, public.crm_links from authenticated;
revoke all on public.crm_credentials from anon, authenticated;
