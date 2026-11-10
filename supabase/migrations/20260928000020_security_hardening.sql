-- =============================================================================
-- 0020 Security hardening (audit follow-up). No behaviour change for normal use.
--
--   1. Least privilege: anon gets nothing, authenticated loses TRUNCATE /
--      REFERENCES / TRIGGER (RLS does not cover TRUNCATE), internal SECURITY
--      DEFINER helpers are no longer executable by clients.
--   2. The "is this the server?" check in audited RPCs used current_user, which
--      inside a SECURITY DEFINER function is always the function owner.
--   3. One free trial per person: extra or re-created workspaces start without one.
--   4. Only owners/admins may switch a campaign to full-auto (was only checked
--      in the app, not for direct API writes).
--   5. Booking links must be http(s) URLs (they are rendered as links).
--   6. Size limits on free-text columns that clients write directly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Least privilege
-- -----------------------------------------------------------------------------
-- Tables created after 0003 inherited Supabase's default grants.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- New objects created by migrations start closed for anon; each migration
-- grants authenticated exactly what it needs.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- Internal helpers: only the three RLS helpers (and the pure day-start helper
-- used by caller-rights reports) are callable by signed-in users.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname in ('user_org_ids', 'user_org_ids_with_role', 'has_org_role', 'local_day_start') then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end;
$$;
-- Note for future migrations: functions are executable by PUBLIC when created, so every new
-- function in `private` or `public` must revoke that explicitly, as the ones above do.

-- -----------------------------------------------------------------------------
-- 2. Who is calling? (for SECURITY DEFINER RPCs that also serve the server)
--    The `role` setting keeps the caller's role inside a definer function;
--    current_user does not.
-- -----------------------------------------------------------------------------
create or replace function private.is_service_caller()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or coalesce(nullif(nullif(current_setting('role', true), ''), 'none'), session_user) in ('service_role', 'postgres', 'supabase_admin');
$$;
revoke execute on function private.is_service_caller() from public, anon;
grant execute on function private.is_service_caller() to authenticated, service_role;

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
  elsif private.is_service_caller() then
    v_actor := coalesce(p_actor, 'system');
    v_actor_type := case when v_actor like 'agent:%' then 'agent' else 'system' end;
  else
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  update public.organizations
     set sending_paused        = p_paused,
         sending_paused_at     = case when p_paused then now() else null end,
         sending_paused_by     = case when p_paused then v_actor else null end,
         sending_paused_reason = case when p_paused then left(p_reason, 500) else null end
   where id = p_org_id;
  if not found then
    raise exception 'organization not found' using errcode = 'no_data_found';
  end if;

  insert into public.agent_audit_log (org_id, actor, actor_type, action, target, payload)
  values (
    p_org_id, v_actor, v_actor_type,
    case when p_paused then 'pause_all_sending' else 'resume_all_sending' end,
    'organization:' || p_org_id::text,
    jsonb_build_object('reason', left(p_reason, 500))
  );
end;
$$;
revoke execute on function public.set_sending_paused(uuid, boolean, text, text) from public, anon;
grant execute on function public.set_sending_paused(uuid, boolean, text, text) to authenticated, service_role;

create or replace function public.set_variant_winner(
  p_org_id     uuid,
  p_step_id    uuid,
  p_variant_id uuid,
  p_reason     text default null,
  p_actor      text default null
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
  v_label text;
  v_campaign uuid;
begin
  if v_uid is not null then
    if not private.has_org_role(p_org_id, array['owner', 'admin', 'sender']) then
      raise exception 'not allowed to change A/B winners' using errcode = 'insufficient_privilege';
    end if;
    v_actor := 'user:' || v_uid::text;
    v_actor_type := 'user';
  elsif private.is_service_caller() then
    v_actor := coalesce(p_actor, 'system');
    v_actor_type := case when v_actor like 'agent:%' then 'agent' else 'system' end;
  else
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select sq.campaign_id into v_campaign
    from public.sequence_steps st join public.sequences sq on sq.id = st.sequence_id
   where st.org_id = p_org_id and st.id = p_step_id;
  if not found then raise exception 'step not found' using errcode = 'no_data_found'; end if;

  if p_variant_id is not null then
    select ab_group into v_label from public.email_variants
     where org_id = p_org_id and step_id = p_step_id and id = p_variant_id and is_active and weight > 0;
    if not found then raise exception 'variant not found or not active' using errcode = 'no_data_found'; end if;
  end if;

  update public.email_variants set is_winner = false
   where org_id = p_org_id and step_id = p_step_id and is_winner and id is distinct from p_variant_id;
  if p_variant_id is not null then
    update public.email_variants set is_winner = true
     where org_id = p_org_id and step_id = p_step_id and id = p_variant_id and not is_winner;
  end if;

  insert into public.agent_audit_log (org_id, actor, actor_type, action, target, payload)
  values (
    p_org_id, v_actor, v_actor_type,
    case when p_variant_id is null then 'ab.clear_winner' else 'ab.promote_winner' end,
    'campaign:' || v_campaign::text,
    jsonb_build_object('step_id', p_step_id, 'variant_id', p_variant_id, 'variant', v_label, 'reason', left(p_reason, 500))
  );
end;
$$;
revoke execute on function public.set_variant_winner(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.set_variant_winner(uuid, uuid, uuid, text, text) to authenticated, service_role;

-- billing_status: a caller with no user id must be the server.
create or replace function public.billing_status(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if auth.uid() is not null then
    if p_org_id not in (select private.user_org_ids()) then
      raise exception 'not a member' using errcode = 'insufficient_privilege';
    end if;
  elsif not private.is_service_caller() then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  select * into v_org from public.organizations where id = p_org_id;
  if not found then raise exception 'organization not found' using errcode = 'no_data_found'; end if;
  return jsonb_build_object(
    'plan', v_org.plan,
    'block', private.send_block_reason(p_org_id, false),
    'trial_ends_at', v_org.trial_ends_at,
    'trial_email_limit', v_org.trial_email_limit,
    'trial_emails_used', case when v_org.plan = 'trial' then private.trial_emails_used(p_org_id) else null end,
    'billing_interval', v_org.billing_interval,
    'subscription_status', v_org.subscription_status,
    'current_period_end', v_org.current_period_end,
    'cancel_at_period_end', v_org.cancel_at_period_end,
    'has_customer', v_org.stripe_customer_id is not null
  );
end;
$$;
revoke execute on function public.billing_status(uuid) from public, anon;
grant execute on function public.billing_status(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. One free trial per person, and a cap on workspaces per person.
--    Before: every create_organization() call started a fresh 7-day / 200-email
--    trial with Pro features (including the included AI budget), so one account
--    could loop forever. Now only a person's first workspace gets the trial;
--    later ones start as 'expired' (data and setup work, sending needs a plan).
-- -----------------------------------------------------------------------------
alter table public.users add column if not exists trial_started_at timestamptz;

-- Everyone who already owns a workspace has had their trial.
update public.users u
   set trial_started_at = coalesce(
         (select min(o.created_at) from public.memberships m join public.organizations o on o.id = m.org_id
           where m.user_id = u.id and m.role = 'owner'),
         now())
 where u.trial_started_at is null
   and exists (select 1 from public.memberships m where m.user_id = u.id and m.role = 'owner');

create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_trial_used boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Serialize per user so parallel calls can't each claim the trial.
  select trial_started_at is not null into v_trial_used from public.users where id = v_uid for update;
  if not found then
    raise exception 'user profile not found' using errcode = 'no_data_found';
  end if;
  if (select count(*) from public.memberships where user_id = v_uid and role = 'owner') >= 10 then
    raise exception 'workspace limit reached (10 per person)' using errcode = 'check_violation';
  end if;

  insert into public.organizations (name, plan)
  values (btrim(p_name), case when v_trial_used then 'expired' else 'trial' end)
  returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, v_uid, 'owner');
  if not v_trial_used then
    update public.users set trial_started_at = now() where id = v_uid;
  end if;

  perform private.seed_org_defaults(v_org);
  return v_org;
end;
$$;
revoke execute on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Full-auto for the AI agent is an owner/admin decision. Senders can edit
--    campaigns, so without this a sender could flip approval_mode through the
--    API directly. The server (no user id) is unaffected.
-- -----------------------------------------------------------------------------
create or replace function private.guard_campaign_auto_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.approval_mode = 'auto'
     and (tg_op = 'INSERT' or old.approval_mode is distinct from 'auto')
     and auth.uid() is not null
     and not private.has_org_role(new.org_id, array['owner', 'admin'])
  then
    raise exception 'only owners and admins can enable full-auto for a campaign'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_campaign_auto_mode() from public, anon, authenticated;

drop trigger if exists campaigns_guard_auto_mode on public.campaigns;
create trigger campaigns_guard_auto_mode
  before insert or update of approval_mode on public.campaigns
  for each row execute function private.guard_campaign_auto_mode();

-- -----------------------------------------------------------------------------
-- 5. Booking links are shown as clickable links to the whole workspace:
--    only http(s), so a member can't store a javascript: URL.
-- -----------------------------------------------------------------------------
update public.opportunities
   set booking_link = null
 where booking_link is not null
   and (booking_link !~* '^https?://[^[:space:]]+$' or length(booking_link) > 500);

alter table public.opportunities
  add constraint opportunities_booking_link_http
  check (booking_link is null or (booking_link ~* '^https?://[^[:space:]]+$' and length(booking_link) <= 500));

-- -----------------------------------------------------------------------------
-- 6. Size limits on text that clients can write directly (the app already
--    validates these; this stops oversized writes through the API). NOT VALID:
--    existing rows are left alone, new and changed rows are checked.
-- -----------------------------------------------------------------------------
alter table public.email_variants
  add constraint email_variants_size check (length(subject) <= 500 and length(body) <= 50000) not valid;
alter table public.lead_notes
  add constraint lead_notes_size check (length(body) <= 10000) not valid;
alter table public.leads
  add constraint leads_size check (
    length(email) <= 320
    and coalesce(length(first_name), 0) <= 500 and coalesce(length(last_name), 0) <= 500
    and coalesce(length(company), 0) <= 500 and coalesce(length(title), 0) <= 500
    and pg_column_size(custom_json) <= 65536
  ) not valid;
alter table public.lead_lists
  add constraint lead_lists_size check (length(name) <= 200) not valid;
alter table public.pipeline_stages
  add constraint pipeline_stages_size check (length(name) <= 100) not valid;
alter table public.suppression_list
  add constraint suppression_list_size check (length(email) <= 320 and coalesce(length(source), 0) <= 500) not valid;
alter table public.api_keys
  add constraint api_keys_size check (length(name) <= 100 and length(prefix) <= 20 and key_hash ~ '^[0-9a-f]{64}$') not valid;
alter table public.organizations
  add constraint organizations_text_size check (
    coalesce(length(physical_address), 0) <= 500 and length(default_timezone) <= 64
    and coalesce(length(sending_paused_reason), 0) <= 500
  ) not valid;
alter table public.users
  add constraint users_size check (coalesce(length(full_name), 0) <= 200) not valid;
alter table public.sending_accounts
  add constraint sending_accounts_size check (
    length(email) <= 320 and coalesce(length(display_name), 0) <= 200
    and length(smtp_host) <= 253 and length(imap_host) <= 253 and length(username) <= 320
  ) not valid;
