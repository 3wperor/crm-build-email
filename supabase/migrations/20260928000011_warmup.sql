-- =============================================================================
-- 0011 Warmup pool (beta): the workspace's own inboxes email each other on a
-- ramp, and the receiving side opens, stars, rescues from spam and replies.
-- Warmup mail shares pacing, the daily cap and the kill switch with cold mail.
-- =============================================================================

alter table public.sending_accounts
  add column warmup_started_at    timestamptz,
  add column warmup_stopped_at    timestamptz,
  add column warmup_ramp_step     integer not null default 2 check (warmup_ramp_step between 1 and 5),
  add column warmup_reply_rate    integer not null default 30 check (warmup_reply_rate between 0 and 60),
  add column warmup_paused_reason text;

update public.sending_accounts set warmup_daily_target = 20 where warmup_daily_target = 0;
alter table public.sending_accounts
  alter column warmup_daily_target set default 20,
  add constraint sending_accounts_warmup_target_check check (warmup_daily_target between 2 and 50);

grant update (warmup_daily_target, warmup_ramp_step, warmup_reply_rate) on public.sending_accounts to authenticated;

-- Turning warmup on clears an auto-pause and (re)starts the ramp when it's new
-- or has been off for more than 3 days; turning it off remembers when.
create or replace function private.warmup_toggle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Setting it on again while auto-paused counts as a restart.
  if new.warmup_enabled and (tg_op = 'INSERT' or not old.warmup_enabled or old.warmup_paused_reason is not null) then
    if new.warmup_started_at is null or new.warmup_paused_reason is not null
       or coalesce(new.warmup_stopped_at, now()) < now() - interval '3 days' then
      new.warmup_started_at := now();
    end if;
    new.warmup_paused_reason := null;
    new.warmup_stopped_at := null;
  elsif not new.warmup_enabled and tg_op = 'UPDATE' and old.warmup_enabled then
    new.warmup_stopped_at := now();
  end if;
  return new;
end;
$$;

create trigger sending_accounts_warmup_toggle before insert or update of warmup_enabled on public.sending_accounts
  for each row execute function private.warmup_toggle();

-- -----------------------------------------------------------------------------
-- warmup_messages: queue + engagement state for every warmup email.
-- -----------------------------------------------------------------------------
create table public.warmup_messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  from_account_id  uuid not null,
  to_account_id    uuid not null,
  thread_root_id   uuid references public.warmup_messages (id) on delete cascade,
  thread_length    integer not null default 1 check (thread_length between 1 and 10),
  is_reply         boolean not null default false,
  message_id       text not null unique,
  in_reply_to      text,
  "references"     text[] not null default '{}',
  subject          text not null,
  body_text        text not null,
  status           text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_at     timestamptz not null default now(),
  claimed_at       timestamptz,
  sent_at          timestamptz,
  bounced          boolean not null default false,
  error            text,
  received_at      timestamptz,
  landed_in        text check (landed_in in ('inbox', 'spam')),
  replied          boolean not null default false,
  created_at       timestamptz not null default now(),
  check (from_account_id <> to_account_id),
  foreign key (org_id, from_account_id) references public.sending_accounts (org_id, id) on delete cascade,
  foreign key (org_id, to_account_id) references public.sending_accounts (org_id, id) on delete cascade
);

create index warmup_messages_from_created_idx on public.warmup_messages (from_account_id, created_at desc);
create index warmup_messages_to_received_idx on public.warmup_messages (to_account_id, received_at desc);
create index warmup_messages_due_idx on public.warmup_messages (scheduled_at) where status = 'scheduled';

alter table public.warmup_messages enable row level security;
create policy warmup_messages_select on public.warmup_messages for select to authenticated
  using (org_id in (select private.user_org_ids()));
revoke insert, update, delete, truncate on public.warmup_messages from authenticated;

-- -----------------------------------------------------------------------------
-- reserve_warmup_slot: same pacing gap and inbox daily cap as cold sends.
-- Replies go out even when the replier's own warmup is off, but never when
-- the org is paused (kill switch) or the inbox is not active.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_warmup_slot(
  p_message_id uuid,
  p_min_gap_s  integer default 180,
  p_max_gap_s  integer default 420
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_msg public.warmup_messages;
  v_account public.sending_accounts;
  v_org public.organizations;
  v_today date;
  v_sent_today integer;
  v_gap interval;
begin
  select * into v_msg from public.warmup_messages where id = p_message_id for update;
  if not found or v_msg.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'not_scheduled');
  end if;
  select * into v_org from public.organizations where id = v_msg.org_id;
  if v_org.sending_paused then
    return jsonb_build_object('ok', false, 'reason', 'kill_switch');
  end if;
  select * into v_account from public.sending_accounts where id = v_msg.from_account_id for update;
  if v_account.status <> 'active' or v_account.health = 'failing'
     or (not v_msg.is_reply and (not v_account.warmup_enabled or v_account.warmup_paused_reason is not null)) then
    return jsonb_build_object('ok', false, 'reason', 'warmup_off');
  end if;
  if v_account.next_available_at is not null and v_account.next_available_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'pacing', 'retry_at', v_account.next_available_at);
  end if;

  v_today := (now() at time zone coalesce(v_account.timezone, v_org.default_timezone, 'UTC'))::date;
  v_sent_today := case when v_account.sent_today_date = v_today then v_account.sent_today else 0 end;
  if v_sent_today >= v_account.daily_cap then
    return jsonb_build_object('ok', false, 'reason', 'inbox_daily_cap');
  end if;

  v_gap := make_interval(secs => p_min_gap_s + floor(random() * (greatest(p_max_gap_s, p_min_gap_s) - p_min_gap_s + 1)));
  update public.sending_accounts
     set sent_today = v_sent_today + 1, sent_today_date = v_today, next_available_at = now() + v_gap
   where id = v_account.id;
  update public.warmup_messages set status = 'sending', claimed_at = now() where id = p_message_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- finish_warmup_send: 'sent' | 'bounced' (slot used) | 'failed' (slot given back) | 'cancelled'.
create or replace function public.finish_warmup_send(p_message_id uuid, p_outcome text, p_error text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_msg public.warmup_messages;
begin
  if p_outcome not in ('sent', 'bounced', 'failed', 'cancelled') then raise exception 'unknown outcome %', p_outcome; end if;
  select * into v_msg from public.warmup_messages where id = p_message_id for update;
  if not found or v_msg.status in ('sent', 'failed', 'cancelled') then return; end if;

  update public.warmup_messages
     set status = case p_outcome when 'sent' then 'sent' when 'cancelled' then 'cancelled' else 'failed' end,
         sent_at = case when p_outcome = 'sent' then now() end,
         bounced = p_outcome = 'bounced',
         error = p_error
   where id = p_message_id;

  if p_outcome = 'failed' and v_msg.claimed_at is not null then
    update public.sending_accounts set sent_today = greatest(sent_today - 1, 0) where id = v_msg.from_account_id;
  end if;
  if p_outcome in ('sent', 'bounced') then
    insert into public.warmup_events (org_id, account_id, peer_account_id, type, message_id)
    values (v_msg.org_id, v_msg.from_account_id, v_msg.to_account_id, p_outcome, v_msg.message_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- record_warmup_received: the receiving inbox saw a warmup email. Idempotent
-- (moving it out of spam makes it show up again in INBOX). Returns null when
-- it isn't ours, else the message plus whether this is the first sighting.
-- -----------------------------------------------------------------------------
create or replace function public.record_warmup_received(p_account_id uuid, p_message_id text, p_in_spam boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_msg public.warmup_messages;
begin
  select * into v_msg from public.warmup_messages where message_id = p_message_id and to_account_id = p_account_id for update;
  if not found then return null; end if;
  if v_msg.received_at is not null then
    return jsonb_build_object('first', false, 'id', v_msg.id);
  end if;
  update public.warmup_messages set received_at = now(), landed_in = case when p_in_spam then 'spam' else 'inbox' end where id = v_msg.id;
  insert into public.warmup_events (org_id, account_id, peer_account_id, type, message_id)
  values (v_msg.org_id, p_account_id, v_msg.from_account_id, 'received', v_msg.message_id);
  if p_in_spam then
    insert into public.warmup_events (org_id, account_id, peer_account_id, type, message_id)
    values (v_msg.org_id, p_account_id, v_msg.from_account_id, 'rescued_from_spam', v_msg.message_id);
  end if;
  return jsonb_build_object(
    'first', true, 'id', v_msg.id, 'org_id', v_msg.org_id, 'from_account_id', v_msg.from_account_id,
    'thread_root_id', coalesce(v_msg.thread_root_id, v_msg.id), 'thread_length', v_msg.thread_length,
    'subject', v_msg.subject, 'message_id', v_msg.message_id, 'references', to_jsonb(v_msg."references")
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- warmup_stats: per inbox, the last p_days of warmup mail it sent as seen by
-- its peers (health), plus today's counts (progress). Security invoker: RLS.
-- -----------------------------------------------------------------------------
create or replace function public.warmup_stats(p_org_id uuid, p_days integer default 7)
returns table (
  account_id     uuid,
  sent           bigint,
  received       bigint,
  spam           bigint,
  bounced        bigint,
  replies_sent   bigint,
  created_today  bigint,
  sent_today     bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id,
         count(m.id) filter (where m.status = 'sent' and m.sent_at >= now() - make_interval(days => p_days)),
         count(m.id) filter (where m.received_at >= now() - make_interval(days => p_days)),
         count(m.id) filter (where m.landed_in = 'spam' and m.received_at >= now() - make_interval(days => p_days)),
         count(m.id) filter (where m.bounced and m.created_at >= now() - make_interval(days => p_days)),
         count(m.id) filter (where m.is_reply and m.status = 'sent' and m.sent_at >= now() - make_interval(days => p_days)),
         count(m.id) filter (where not m.is_reply and m.created_at >= private.local_day_start(coalesce(a.timezone, o.default_timezone, 'UTC'))),
         count(m.id) filter (where m.status = 'sent' and m.sent_at >= private.local_day_start(coalesce(a.timezone, o.default_timezone, 'UTC')))
    from public.sending_accounts a
    join public.organizations o on o.id = a.org_id
    left join public.warmup_messages m on m.from_account_id = a.id
   where a.org_id = p_org_id
   group by a.id;
$$;

-- warmup_daily: pool-wide placement per day (for the chart).
create or replace function public.warmup_daily(p_org_id uuid, p_tz text default 'UTC', p_days integer default 14)
returns table (day date, inbox bigint, spam bigint, sent bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with days as (
    select generate_series((now() at time zone p_tz)::date - (p_days - 1), (now() at time zone p_tz)::date, interval '1 day')::date as d
  )
  select days.d,
         count(m.id) filter (where m.landed_in = 'inbox' and (m.received_at at time zone p_tz)::date = days.d),
         count(m.id) filter (where m.landed_in = 'spam' and (m.received_at at time zone p_tz)::date = days.d),
         count(m.id) filter (where m.status = 'sent' and (m.sent_at at time zone p_tz)::date = days.d)
    from days
    left join public.warmup_messages m
      on m.org_id = p_org_id
     and ((m.received_at at time zone p_tz)::date = days.d or (m.sent_at at time zone p_tz)::date = days.d)
   group by days.d
   order by days.d;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.reserve_warmup_slot(uuid, integer, integer)',
    'public.finish_warmup_send(uuid, text, text)',
    'public.record_warmup_received(uuid, text, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

revoke execute on function public.warmup_stats(uuid, integer) from public, anon;
grant execute on function public.warmup_stats(uuid, integer) to authenticated, service_role;
revoke execute on function public.warmup_daily(uuid, text, integer) from public, anon;
grant execute on function public.warmup_daily(uuid, text, integer) to authenticated, service_role;
