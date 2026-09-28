-- =============================================================================
-- 0005 Email verification (DNS level; SMTP RCPT prober can be added later).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- domain_checks: cache of public DNS facts, shared across orgs (contains no
-- tenant data). Service role only.
-- -----------------------------------------------------------------------------
create table public.domain_checks (
  domain       text primary key check (domain = lower(domain)),
  mx_hosts     text[] not null default '{}',
  null_mx      boolean not null default false,
  has_address  boolean not null default false,
  error        text check (error in ('nxdomain', 'temporary')),
  checked_at   timestamptz not null default now()
);
alter table public.domain_checks enable row level security;
revoke all on public.domain_checks from anon, authenticated;

-- -----------------------------------------------------------------------------
-- verification_runs: one per "verify these leads" request (UI, import, agent).
-- -----------------------------------------------------------------------------
create table public.verification_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  source         text not null check (source in ('manual', 'import', 'agent')),
  requested_by   uuid references public.users (id) on delete set null,
  import_id      uuid,
  status         text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  total          integer not null default 0,
  processed      integer not null default 0,
  valid_count    integer not null default 0,
  invalid_count  integer not null default 0,
  risky_count    integer not null default 0,
  unknown_count  integer not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  unique (org_id, id),
  foreign key (org_id, import_id) references public.imports (org_id, id) on delete set null (import_id)
);

create index verification_runs_org_created_idx on public.verification_runs (org_id, created_at desc);

alter table public.verification_runs enable row level security;
create policy verification_runs_select on public.verification_runs for select to authenticated
  using (org_id in (select private.user_org_ids()));
revoke insert, update, delete, truncate on public.verification_runs from anon, authenticated;

-- A lead belongs to at most one in-flight run; the job only touches its own leads.
alter table public.leads
  add column verification_run_id uuid,
  add foreign key (org_id, verification_run_id) references public.verification_runs (org_id, id)
    on delete set null (verification_run_id);

create index leads_verification_run_idx on public.leads (verification_run_id, id) where verification_run_id is not null;

-- Org setting: verify leads automatically after every import.
alter table public.organizations add column auto_verify_imports boolean not null default true;
grant update (auto_verify_imports) on public.organizations to authenticated;

-- Changing a lead's email invalidates its verification.
create or replace function private.reset_verification_on_email_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    new.verification_status := 'unverified';
    new.verification_detail := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

create trigger leads_reset_verification before update of email on public.leads
  for each row execute function private.reset_verification_on_email_change();

-- -----------------------------------------------------------------------------
-- claim_leads_for_verification: marks target leads 'pending' and attaches
-- them to the run. Exactly one of p_lead_ids / p_import_id / p_all_unverified.
-- Leads already in another in-flight run are left alone. Service role only.
-- -----------------------------------------------------------------------------
create or replace function public.claim_leads_for_verification(
  p_org_id          uuid,
  p_run_id          uuid,
  p_lead_ids        uuid[] default null,
  p_import_id       uuid default null,
  p_all_unverified  boolean default false
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (p_lead_ids is not null)::int + (p_import_id is not null)::int + p_all_unverified::int <> 1 then
    raise exception 'specify exactly one of p_lead_ids, p_import_id, p_all_unverified';
  end if;

  update public.leads l
     set verification_status = 'pending',
         verification_run_id = p_run_id
   where l.org_id = p_org_id
     and l.verification_run_id is null
     and (
       (p_lead_ids is not null and l.id = any (p_lead_ids))
       or (p_import_id is not null and l.import_id = p_import_id and l.verification_status = 'unverified')
       or (p_all_unverified and l.verification_status = 'unverified')
     );
  get diagnostics v_count = row_count;

  update public.verification_runs set total = v_count where org_id = p_org_id and id = p_run_id;
  return v_count;
end;
$$;

revoke execute on function public.claim_leads_for_verification(uuid, uuid, uuid[], uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_leads_for_verification(uuid, uuid, uuid[], uuid, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- apply_verification_results: writes results for leads still attached to the
-- run (idempotent on retry), updates run counters, and stops enrollments /
-- cancels scheduled sends for leads that turned out invalid.
--   p_results: [{ "id": uuid, "status": "valid|invalid|risky|unknown", "detail": {...} }]
-- -----------------------------------------------------------------------------
create or replace function public.apply_verification_results(
  p_org_id  uuid,
  p_run_id  uuid,
  p_results jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_applied integer;
begin
  with input as (
    select r.id, r.status, r.detail
      from jsonb_to_recordset(p_results) as r(id uuid, status text, detail jsonb)
     where r.status in ('valid', 'invalid', 'risky', 'unknown')
  ),
  updated as (
    update public.leads l
       set verification_status = i.status,
           verification_detail = i.detail,
           verified_at = now(),
           verification_run_id = null
      from input i
     where l.id = i.id and l.org_id = p_org_id and l.verification_run_id = p_run_id
    returning l.id, i.status
  ),
  counts as (
    select count(*) as n,
           count(*) filter (where status = 'valid')   as v,
           count(*) filter (where status = 'invalid') as inv,
           count(*) filter (where status = 'risky')   as r,
           count(*) filter (where status = 'unknown') as u
      from updated
  )
  update public.verification_runs vr
     set processed     = vr.processed + c.n,
         valid_count   = vr.valid_count + c.v,
         invalid_count = vr.invalid_count + c.inv,
         risky_count   = vr.risky_count + c.r,
         unknown_count = vr.unknown_count + c.u
    from counts c
   where vr.org_id = p_org_id and vr.id = p_run_id
  returning c.n into v_applied;

  -- Invalid addresses must never be emailed: stop them everywhere now.
  update public.campaign_leads cl
     set status = 'stopped', stopped_reason = 'invalid_email', next_send_at = null
    from public.leads l
   where l.org_id = p_org_id and l.verification_status = 'invalid'
     and l.id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_results) x where x ->> 'status' = 'invalid')
     and cl.org_id = l.org_id and cl.lead_id = l.id
     and cl.status in ('queued', 'active', 'paused');

  update public.sends s
     set status = 'cancelled', error = 'invalid_email'
    from public.leads l
   where l.org_id = p_org_id and l.verification_status = 'invalid'
     and l.id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_results) x where x ->> 'status' = 'invalid')
     and s.org_id = l.org_id and s.lead_id = l.id
     and s.status in ('pending_approval', 'scheduled');

  return coalesce(v_applied, 0);
end;
$$;

revoke execute on function public.apply_verification_results(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_verification_results(uuid, uuid, jsonb) to service_role;

-- Live progress in the UI.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.verification_runs;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Leads column privileges: clients edit contact fields (and may override
-- status / verification_status manually); job bookkeeping is server-only.
-- -----------------------------------------------------------------------------
revoke insert, update on public.leads from authenticated;
grant insert (org_id, email, first_name, last_name, company, title, custom_json, status)
  on public.leads to authenticated;
grant update (email, first_name, last_name, company, title, custom_json, status, verification_status)
  on public.leads to authenticated;
