-- =============================================================================
-- 0006 Sequences + scheduler.
-- =============================================================================

alter table public.campaigns
  add column include_risky boolean not null default false,
  add column last_error text;

alter table public.campaign_leads
  add column thread_message_id text,   -- Message-ID of step 1 (References root)
  add column last_message_id text,     -- Message-ID of the latest send (In-Reply-To)
  add column thread_subject text,      -- subject of step 1 (for "Re:" follow-ups)
  add column attempt_count integer not null default 0;

alter table public.sending_accounts
  add column next_available_at timestamptz;  -- pacing: earliest next send from this inbox

alter table public.sends
  add column "references" text[] not null default '{}',
  add column claimed_at timestamptz;          -- when a send slot was reserved (counts toward caps)

-- A lead gets each step at most once — but a failed/cancelled attempt must not
-- block a retry of that step, so uniqueness applies to live sends only.
alter table public.sends drop constraint sends_campaign_lead_id_step_id_key;
create unique index sends_one_live_per_step on public.sends (campaign_lead_id, step_id)
  where status not in ('failed', 'cancelled');

create index sends_campaign_claimed_idx on public.sends (campaign_id, claimed_at) where claimed_at is not null;
create index sends_account_claimed_idx on public.sends (sending_account_id, claimed_at) where claimed_at is not null;
create index sends_inflight_idx on public.sends (campaign_lead_id) where status in ('scheduled', 'sending');
create index campaign_leads_campaign_due_idx on public.campaign_leads (campaign_id, next_send_at)
  where status in ('queued', 'active');

-- Campaign settings clients may change (status only through server actions).
revoke update on public.campaigns from authenticated;
grant update (name, timezone, send_window_start, send_window_end, send_days, daily_limit, daily_limit_per_inbox,
              approval_mode, track_opens, track_clicks, auto_promote_winner, include_risky)
  on public.campaigns to authenticated;

-- Enrollment bookkeeping is server-only; clients may insert (via enroll_leads) and delete.
revoke update on public.campaign_leads from authenticated;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function private.local_day_start(p_tz text, p_at timestamptz default now())
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('day', p_at at time zone p_tz) at time zone p_tz;
$$;

-- -----------------------------------------------------------------------------
-- enroll_leads: add leads to a campaign. Runs as the caller (RLS applies).
-- Skips leads that must not be emailed and leads already in another live
-- campaign (never run two sequences at one person).
-- -----------------------------------------------------------------------------
create or replace function public.enroll_leads(
  p_campaign_id  uuid,
  p_lead_ids     uuid[] default null,
  p_list_id      uuid default null,
  p_all_eligible boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_candidates integer;
  v_enrolled integer;
begin
  select * into v_campaign from public.campaigns where id = p_campaign_id;
  if not found then raise exception 'campaign not found' using errcode = 'no_data_found'; end if;
  if v_campaign.status in ('completed', 'archived') then raise exception 'campaign is %', v_campaign.status; end if;
  if (p_lead_ids is not null)::int + (p_list_id is not null)::int + p_all_eligible::int <> 1 then
    raise exception 'specify exactly one of p_lead_ids, p_list_id, p_all_eligible';
  end if;

  with cand as (
    select l.id, l.email, l.status, l.verification_status
      from public.leads l
     where l.org_id = v_campaign.org_id
       and (
         (p_lead_ids is not null and l.id = any (p_lead_ids))
         or (p_list_id is not null and exists (select 1 from public.lead_list_members m where m.list_id = p_list_id and m.lead_id = l.id))
         or p_all_eligible
       )
  ),
  counted as (select count(*) as n from cand),
  ins as (
    insert into public.campaign_leads (org_id, campaign_id, lead_id, status, next_send_at)
    select v_campaign.org_id, p_campaign_id, c.id, 'queued',
           case when v_campaign.status = 'active' then now() else null end
      from cand c
     where c.status in ('new', 'in_sequence')
       and c.verification_status not in ('invalid', 'pending')
       and (v_campaign.include_risky or c.verification_status <> 'risky')
       and not exists (select 1 from public.suppression_list s where s.org_id = v_campaign.org_id and s.email = c.email)
       and not exists (
         select 1 from public.campaign_leads other
          where other.lead_id = c.id and other.campaign_id <> p_campaign_id and other.status in ('queued', 'active', 'paused')
       )
    on conflict (campaign_id, lead_id) do nothing
    returning 1
  )
  select (select n from counted), (select count(*) from ins) into v_candidates, v_enrolled;

  return jsonb_build_object('candidates', v_candidates, 'enrolled', v_enrolled, 'skipped', v_candidates - v_enrolled);
end;
$$;

revoke execute on function public.enroll_leads(uuid, uuid[], uuid, boolean) from public, anon;
grant execute on function public.enroll_leads(uuid, uuid[], uuid, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- reserve_send_slot: the atomic cap + pacing gate, called by the sender right
-- before SMTP. Locks the inbox and campaign rows so concurrent senders can't
-- overshoot. Returns { ok } or { ok:false, reason, retry_at? }.
--   reasons: not_scheduled | pacing (retry_at) | inbox_daily_cap | campaign_inbox_cap | campaign_daily_cap
-- -----------------------------------------------------------------------------
create or replace function public.reserve_send_slot(
  p_org_id     uuid,
  p_send_id    uuid,
  p_min_gap_s  integer default 180,
  p_max_gap_s  integer default 420
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_send public.sends;
  v_campaign public.campaigns;
  v_account public.sending_accounts;
  v_org_tz text;
  v_account_tz text;
  v_today date;
  v_sent_today integer;
  v_campaign_today integer;
  v_campaign_inbox_today integer;
  v_gap interval;
begin
  select * into v_send from public.sends where org_id = p_org_id and id = p_send_id for update;
  if not found or v_send.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'not_scheduled');
  end if;

  select * into v_campaign from public.campaigns where id = v_send.campaign_id for update;
  select * into v_account from public.sending_accounts where id = v_send.sending_account_id for update;
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_inbox');
  end if;
  select default_timezone into v_org_tz from public.organizations where id = p_org_id;

  if v_account.next_available_at is not null and v_account.next_available_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'pacing', 'retry_at', v_account.next_available_at);
  end if;

  -- Inbox-wide daily cap (all campaigns), counted in the inbox's timezone.
  v_account_tz := coalesce(v_account.timezone, v_org_tz, 'UTC');
  v_today := (now() at time zone v_account_tz)::date;
  v_sent_today := case when v_account.sent_today_date = v_today then v_account.sent_today else 0 end;
  if v_sent_today >= v_account.daily_cap then
    return jsonb_build_object('ok', false, 'reason', 'inbox_daily_cap');
  end if;

  -- Campaign caps, counted in the campaign's timezone.
  select count(*) filter (where s.sending_account_id = v_account.id), count(*)
    into v_campaign_inbox_today, v_campaign_today
    from public.sends s
   where s.campaign_id = v_campaign.id
     and s.claimed_at >= private.local_day_start(v_campaign.timezone);
  if v_campaign_inbox_today >= v_campaign.daily_limit_per_inbox then
    return jsonb_build_object('ok', false, 'reason', 'campaign_inbox_cap');
  end if;
  if v_campaign_today >= v_campaign.daily_limit then
    return jsonb_build_object('ok', false, 'reason', 'campaign_daily_cap');
  end if;

  v_gap := make_interval(secs => p_min_gap_s + floor(random() * (greatest(p_max_gap_s, p_min_gap_s) - p_min_gap_s + 1)));
  update public.sending_accounts
     set sent_today = v_sent_today + 1,
         sent_today_date = v_today,
         next_available_at = now() + v_gap
   where id = v_account.id;

  update public.sends
     set status = 'sending', claimed_at = now(), attempt_count = attempt_count + 1
   where id = p_send_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Give back a reserved slot when the email never left (connection/auth failure).
create or replace function public.release_send_slot(p_org_id uuid, p_send_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_send public.sends;
begin
  select * into v_send from public.sends where org_id = p_org_id and id = p_send_id for update;
  if not found or v_send.claimed_at is null then return; end if;
  update public.sending_accounts a
     set sent_today = greatest(a.sent_today - 1, 0)
    from public.organizations o
   where a.id = v_send.sending_account_id and o.id = a.org_id
     and a.sent_today_date = (v_send.claimed_at at time zone coalesce(a.timezone, o.default_timezone, 'UTC'))::date;
  update public.sends set claimed_at = null where id = p_send_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- complete_send: mark a send delivered to the mail server and advance the
-- enrollment atomically. p_next_send_at null = that was the last step.
-- -----------------------------------------------------------------------------
create or replace function public.complete_send(
  p_org_id       uuid,
  p_send_id      uuid,
  p_next_send_at timestamptz default null,
  p_error        text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_send public.sends;
  v_step_order integer;
begin
  update public.sends
     set status = 'sent', sent_at = now(), error = p_error
   where org_id = p_org_id and id = p_send_id and status = 'sending'
  returning * into v_send;
  if not found then return; end if;

  select step_order into v_step_order from public.sequence_steps where id = v_send.step_id;

  update public.campaign_leads
     set current_step_order = greatest(current_step_order, coalesce(v_step_order, current_step_order)),
         last_sent_at = now(),
         last_message_id = v_send.message_id,
         thread_message_id = coalesce(thread_message_id, v_send.message_id),
         thread_subject = coalesce(thread_subject, v_send.subject),
         attempt_count = 0,
         status = case when p_next_send_at is null then 'completed' else 'active' end,
         next_send_at = p_next_send_at
   where id = v_send.campaign_lead_id and status in ('queued', 'active');

  update public.leads set status = 'in_sequence' where id = v_send.lead_id and status = 'new';
end;
$$;

-- -----------------------------------------------------------------------------
-- stop_lead_sequences: stop every live enrollment of a lead (reply, bounce,
-- manual) and cancel anything not yet handed to the mail server.
-- -----------------------------------------------------------------------------
create or replace function public.stop_lead_sequences(
  p_org_id  uuid,
  p_lead_id uuid,
  p_status  text,    -- 'replied' | 'bounced' | 'unsubscribed' | 'stopped'
  p_reason  text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_status not in ('replied', 'bounced', 'unsubscribed', 'stopped') then
    raise exception 'invalid status %', p_status;
  end if;
  update public.campaign_leads
     set status = p_status, stopped_reason = p_reason, next_send_at = null
   where org_id = p_org_id and lead_id = p_lead_id and status in ('queued', 'active', 'paused');
  get diagnostics v_count = row_count;

  update public.sends
     set status = 'cancelled', error = p_reason
   where org_id = p_org_id and lead_id = p_lead_id and status in ('pending_approval', 'scheduled');
  return v_count;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.reserve_send_slot(uuid, uuid, integer, integer)',
    'public.release_send_slot(uuid, uuid)',
    'public.complete_send(uuid, uuid, timestamptz, text)',
    'public.stop_lead_sequences(uuid, uuid, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- Campaigns are created as drafts; status/started_at/last_error are server-controlled.
revoke insert on public.campaigns from authenticated;
grant insert (org_id, name, timezone, send_window_start, send_window_end, send_days, daily_limit, daily_limit_per_inbox,
              approval_mode, track_opens, track_clicks, auto_promote_winner, include_risky, created_by)
  on public.campaigns to authenticated;
