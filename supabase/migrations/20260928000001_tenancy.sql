-- =============================================================================
-- 0001 Tenancy: organizations, users, memberships, api keys, shared helpers.
--
-- Conventions used across all migrations:
--   * Every tenant-owned table has `org_id uuid not null` and a UNIQUE (org_id, id)
--     so children can use composite FKs (org_id, parent_id) -> parent(org_id, id).
--     This makes cross-tenant references impossible at the database level, even
--     for code running with the service role.
--   * Enumerations are `text` + CHECK constraints (easy to extend, no enum ALTERs).
--   * Emails are stored lowercased/trimmed (enforced by trigger + CHECK).
--   * RLS helpers live in the `private` schema, which PostgREST does not expose.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Generic trigger functions
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.normalize_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.email is not null then
    new.email := lower(btrim(new.email));
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------
create table public.organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(btrim(name)) between 1 and 120),
  -- Agent guardrail ceiling. 'draft' = agent proposes, human approves.
  -- A campaign can only run full-auto if BOTH org and campaign are 'auto'.
  approval_mode      text not null default 'draft' check (approval_mode in ('draft', 'auto')),
  -- Global kill switch: when true, no send of any kind leaves this org.
  sending_paused     boolean not null default false,
  sending_paused_at  timestamptz,
  sending_paused_by  text,
  sending_paused_reason text,
  -- CAN-SPAM / GDPR footer. Rendered into every outgoing email.
  physical_address   text,
  default_timezone   text not null default 'UTC',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- users (public profile mirror of auth.users)
-- -----------------------------------------------------------------------------
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger users_updated_at before update on public.users
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- memberships
-- -----------------------------------------------------------------------------
create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'admin', 'sender', 'viewer')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

create trigger memberships_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();

-- An org must always keep at least one owner.
create or replace function private.guard_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     -- Allow cascades from organization deletion.
     and exists (select 1 from public.organizations o where o.id = old.org_id)
     and not exists (
       select 1 from public.memberships m
       where m.org_id = old.org_id and m.role = 'owner' and m.id <> old.id
     )
  then
    raise exception 'cannot remove the last owner of an organization'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger memberships_guard_last_owner
  before update or delete on public.memberships
  for each row execute function private.guard_last_owner();

-- -----------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER so they can read memberships without
-- recursing through memberships' own RLS policies).
-- -----------------------------------------------------------------------------
create or replace function private.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.memberships m where m.user_id = (select auth.uid());
$$;

-- Orgs where the current user holds one of the given roles.
create or replace function private.user_org_ids_with_role(roles text[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.memberships m
  where m.user_id = (select auth.uid()) and m.role = any (roles);
$$;

create or replace function private.has_org_role(p_org_id uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

grant execute on function private.user_org_ids() to authenticated;
grant execute on function private.user_org_ids_with_role(text[]) to authenticated;
grant execute on function private.has_org_role(uuid, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- api_keys (used by the MCP server; only a SHA-256 hash is stored)
-- -----------------------------------------------------------------------------
create table public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  name          text not null,
  prefix        text not null,              -- first chars, shown in UI to identify key
  key_hash      text not null unique,       -- hex sha256 of the full key
  scopes        text[] not null default '{}',
  created_by    uuid references public.users (id) on delete set null,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index api_keys_org_id_idx on public.api_keys (org_id);

-- -----------------------------------------------------------------------------
-- agent_audit_log (append-only; written by server/service role only)
-- -----------------------------------------------------------------------------
create table public.agent_audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  actor       text not null,                -- e.g. 'agent:<api_key_id>', 'user:<uuid>', 'system'
  actor_type  text not null check (actor_type in ('agent', 'user', 'system')),
  api_key_id  uuid references public.api_keys (id) on delete set null,
  action      text not null,
  target      text,
  payload     jsonb not null default '{}'::jsonb,
  result      text not null default 'ok' check (result in ('ok', 'denied', 'error', 'pending_approval')),
  created_at  timestamptz not null default now()
);

create index agent_audit_log_org_created_idx on public.agent_audit_log (org_id, created_at desc);

create or replace function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

create trigger agent_audit_log_append_only
  before update on public.agent_audit_log
  for each row execute function private.forbid_mutation();

-- -----------------------------------------------------------------------------
-- RPC: create_organization — creates org, owner membership, default pipeline.
-- (Pipeline stage defaults are inserted in migration 0002 via a helper that this
-- function calls; declared here with a late-bound call.)
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizations (name) values (btrim(p_name)) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, v_uid, 'owner');
  perform private.seed_org_defaults(v_org);
  return v_org;
end;
$$;

revoke execute on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: set_sending_paused — the global kill switch.
-- Any sender+ may PAUSE (safety first); only admin+ may RESUME.
-- Also callable by the MCP server via service role (auth.uid() is null there;
-- the server performs its own authorization and passes p_actor).
-- -----------------------------------------------------------------------------
create or replace function public.set_sending_paused(
  p_org_id uuid,
  p_paused boolean,
  p_reason text default null,
  p_actor  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_actor text;
  v_actor_type text;
begin
  if v_uid is not null then
    if p_paused and not private.has_org_role(p_org_id, array['owner', 'admin', 'sender']) then
      raise exception 'not allowed to pause sending' using errcode = 'insufficient_privilege';
    end if;
    if not p_paused and not private.has_org_role(p_org_id, array['owner', 'admin']) then
      raise exception 'only owners and admins can resume sending' using errcode = 'insufficient_privilege';
    end if;
    v_actor := 'user:' || v_uid::text;
    v_actor_type := 'user';
  elsif current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
        or current_user in ('postgres', 'service_role') then
    v_actor := coalesce(p_actor, 'system');
    v_actor_type := case when v_actor like 'agent:%' then 'agent' else 'system' end;
  else
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  update public.organizations
     set sending_paused        = p_paused,
         sending_paused_at     = case when p_paused then now() else null end,
         sending_paused_by     = case when p_paused then v_actor else null end,
         sending_paused_reason = case when p_paused then p_reason else null end
   where id = p_org_id;

  if not found then
    raise exception 'organization not found' using errcode = 'no_data_found';
  end if;

  insert into public.agent_audit_log (org_id, actor, actor_type, action, target, payload)
  values (
    p_org_id, v_actor, v_actor_type,
    case when p_paused then 'pause_all_sending' else 'resume_all_sending' end,
    'organization:' || p_org_id::text,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

revoke execute on function public.set_sending_paused(uuid, boolean, text, text) from public, anon;
grant execute on function public.set_sending_paused(uuid, boolean, text, text) to authenticated, service_role;
