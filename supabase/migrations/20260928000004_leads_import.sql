-- =============================================================================
-- 0004 Lead import + suppression enforcement.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- imports: options + progress
-- -----------------------------------------------------------------------------
alter table public.imports
  add column options         jsonb   not null default '{}'::jsonb,
  add column processed_rows  integer not null default 0,
  add column updated_count   integer not null default 0,
  add column existing_count  integer not null default 0;

-- Clients may create an import row (sender+) but progress/counters are
-- written only by the background job (service role).
revoke insert, update on public.imports from authenticated;
grant insert (org_id, list_id, filename, column_mapping, options, total_rows, created_by)
  on public.imports to authenticated;

create index imports_org_created_idx on public.imports (org_id, created_at desc);

-- Faster case-insensitive search in the leads table UI.
create index leads_org_email_prefix_idx on public.leads (org_id, email text_pattern_ops);

-- -----------------------------------------------------------------------------
-- import_leads_chunk: set-based, idempotent chunk import. Service role only.
--
--   p_rows: [{ "row": 2, "email": "...", "first_name": ..., "last_name": ...,
--              "company": ..., "title": ..., "custom": {...} }, ...]
--           (already validated + de-duplicated within the file by the caller)
--   p_mode: 'skip' → existing leads untouched
--           'fill' → existing leads get empty fields filled; existing values win
--
-- Idempotent: re-running the same chunk (e.g. an Inngest retry) yields the same
-- result, because "imported" is determined by leads.import_id = p_import_id.
-- -----------------------------------------------------------------------------
create or replace function public.import_leads_chunk(
  p_org_id    uuid,
  p_import_id uuid,
  p_mode      text,
  p_rows      jsonb,
  p_list_id   uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_suppressed int[];
  v_imported   int[];
  v_existing   int[];
begin
  if p_mode not in ('skip', 'fill') then
    raise exception 'invalid mode %', p_mode;
  end if;

  -- 1. Suppressed addresses are never imported.
  select coalesce(array_agg(r."row" order by r."row"), '{}')
    into v_suppressed
    from jsonb_to_recordset(p_rows) as r("row" int, email text)
   where exists (
     select 1 from public.suppression_list s
      where s.org_id = p_org_id and s.email = lower(btrim(r.email))
   );

  -- 2. Insert new leads; optionally fill blanks on existing ones.
  insert into public.leads as l (org_id, email, first_name, last_name, company, title, custom_json, import_id)
  select p_org_id, lower(btrim(r.email)), r.first_name, r.last_name, r.company, r.title,
         coalesce(r.custom, '{}'::jsonb), p_import_id
    from jsonb_to_recordset(p_rows) as r("row" int, email text, first_name text, last_name text,
                                         company text, title text, custom jsonb)
   where not (r."row" = any (v_suppressed))
  on conflict (org_id, email) do update
     set first_name  = coalesce(l.first_name, excluded.first_name),
         last_name   = coalesce(l.last_name,  excluded.last_name),
         company     = coalesce(l.company,    excluded.company),
         title       = coalesce(l.title,      excluded.title),
         custom_json = excluded.custom_json || l.custom_json
   where p_mode = 'fill';

  -- 3. Classify rows (idempotent across retries).
  select coalesce(array_agg(r."row" order by r."row") filter (where l.import_id is not distinct from p_import_id), '{}'),
         coalesce(array_agg(r."row" order by r."row") filter (where l.import_id is distinct from p_import_id), '{}')
    into v_imported, v_existing
    from jsonb_to_recordset(p_rows) as r("row" int, email text)
    join public.leads l on l.org_id = p_org_id and l.email = lower(btrim(r.email))
   where not (r."row" = any (v_suppressed));

  -- 4. List membership for every non-suppressed row (new and existing leads).
  if p_list_id is not null then
    insert into public.lead_list_members (org_id, list_id, lead_id)
    select p_org_id, p_list_id, l.id
      from jsonb_to_recordset(p_rows) as r("row" int, email text)
      join public.leads l on l.org_id = p_org_id and l.email = lower(btrim(r.email))
     where not (r."row" = any (v_suppressed))
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'imported_rows',   to_jsonb(v_imported),
    'existing_rows',   to_jsonb(v_existing),
    'suppressed_rows', to_jsonb(v_suppressed)
  );
end;
$$;

revoke execute on function public.import_leads_chunk(uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.import_leads_chunk(uuid, uuid, text, jsonb, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Suppression is authoritative: adding an address immediately marks the lead
-- and stops every active enrollment. (The send path re-checks suppression at
-- send time as well — this is defense in depth, not the only guard.)
-- -----------------------------------------------------------------------------
create or replace function private.on_suppression_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := case new.reason
    when 'unsubscribe' then 'unsubscribed'
    when 'hard_bounce' then 'bounced'
    else 'do_not_contact'
  end;
begin
  update public.leads
     set status = v_status
   where org_id = new.org_id and email = new.email
     and status not in ('unsubscribed', 'bounced', 'do_not_contact');

  update public.campaign_leads cl
     set status = case v_status when 'do_not_contact' then 'stopped' else v_status end,
         stopped_reason = 'suppressed:' || new.reason,
         next_send_at = null
    from public.leads l
   where l.org_id = new.org_id and l.email = new.email
     and cl.org_id = l.org_id and cl.lead_id = l.id
     and cl.status in ('queued', 'active', 'paused');

  -- Cancel anything already scheduled but not yet handed to the mail server.
  update public.sends s
     set status = 'cancelled', error = 'suppressed:' || new.reason
    from public.leads l
   where l.org_id = new.org_id and l.email = new.email
     and s.org_id = l.org_id and s.lead_id = l.id
     and s.status in ('pending_approval', 'scheduled');

  return new;
end;
$$;

create trigger suppression_list_after_insert
  after insert on public.suppression_list
  for each row execute function private.on_suppression_insert();

-- Removing a suppression entry makes the lead contactable again (it is NOT
-- re-enrolled in anything automatically).
create or replace function private.on_suppression_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.leads
     set status = 'new'
   where org_id = old.org_id and email = old.email
     and status = case old.reason
       when 'unsubscribe' then 'unsubscribed'
       when 'hard_bounce' then 'bounced'
       else 'do_not_contact'
     end;
  return old;
end;
$$;

create trigger suppression_list_after_delete
  after delete on public.suppression_list
  for each row execute function private.on_suppression_delete();

-- -----------------------------------------------------------------------------
-- Storage bucket for uploaded CSVs and error reports (private; accessed only
-- through the server with signed URLs). Guarded so plain Postgres can migrate.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('imports', 'imports', false, 20971520)
    on conflict (id) do nothing;
  end if;
end;
$$;
