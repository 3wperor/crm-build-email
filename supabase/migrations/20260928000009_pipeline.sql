-- =============================================================================
-- 0009 Pipeline management + lead notes.
-- =============================================================================

create table public.lead_notes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  lead_id     uuid not null,
  user_id     uuid references public.users (id) on delete set null,
  body        text not null check (length(btrim(body)) between 1 and 10000),
  created_at  timestamptz not null default now(),
  foreign key (org_id, lead_id) references public.leads (org_id, id) on delete cascade
);
create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

alter table public.lead_notes enable row level security;
create policy lead_notes_select on public.lead_notes for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy lead_notes_insert on public.lead_notes for insert to authenticated
  with check (org_id in (select private.user_org_ids_with_role(array['owner','admin','sender'])) and user_id = (select auth.uid()));
create policy lead_notes_delete on public.lead_notes for delete to authenticated
  using (user_id = (select auth.uid()) or org_id in (select private.user_org_ids_with_role(array['owner','admin'])));
revoke update on public.lead_notes from authenticated;

create index opportunities_org_stage_moved_idx on public.opportunities (org_id, stage_id, moved_at desc);

-- -----------------------------------------------------------------------------
-- Stage ordering: rewrite positions 1..n in the given order, atomically.
-- Runs as the caller: RLS limits it to admins of the org.
-- -----------------------------------------------------------------------------
create or replace function public.reorder_pipeline_stages(p_org_id uuid, p_stage_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.pipeline_stages where org_id = p_org_id;
  if v_count <> cardinality(p_stage_ids)
     or v_count <> (select count(*) from public.pipeline_stages where org_id = p_org_id and id = any (p_stage_ids)) then
    raise exception 'stage list must contain every stage of the organization exactly once';
  end if;
  set constraints all deferred;
  update public.pipeline_stages s
     set position = o.ord
    from unnest(p_stage_ids) with ordinality as o(id, ord)
   where s.id = o.id and s.org_id = p_org_id;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(p_stage_ids) then
    raise exception 'not allowed to reorder these stages' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke execute on function public.reorder_pipeline_stages(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_pipeline_stages(uuid, uuid[]) to authenticated, service_role;

-- Exactly one entry stage (where replies land); it must be an "open" stage.
create or replace function public.set_entry_stage(p_org_id uuid, p_stage_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pipeline_stages where org_id = p_org_id and id = p_stage_id and kind = 'open') then
    raise exception 'entry stage must be an open stage of this organization';
  end if;
  update public.pipeline_stages set is_entry = false where org_id = p_org_id and is_entry and id <> p_stage_id;
  update public.pipeline_stages set is_entry = true where org_id = p_org_id and id = p_stage_id;
  if not found then
    raise exception 'not allowed to change stages' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke execute on function public.set_entry_stage(uuid, uuid) from public, anon;
grant execute on function public.set_entry_stage(uuid, uuid) to authenticated, service_role;

-- The entry stage can't be deleted or turned into a won/lost stage.
create or replace function private.guard_entry_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.is_entry and exists (select 1 from public.organizations where id = old.org_id) then
    raise exception 'choose another entry stage before deleting this one' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.is_entry and new.kind <> 'open' then
    raise exception 'the entry stage must stay an open stage' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger pipeline_stages_guard_entry
  before update or delete on public.pipeline_stages
  for each row execute function private.guard_entry_stage();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.lead_notes;
  end if;
end;
$$;
