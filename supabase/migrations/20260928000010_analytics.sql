-- =============================================================================
-- 0010 Analytics: open/click tracking events, reporting queries, A/B winners.
-- =============================================================================

create index events_org_type_created_idx on public.events (org_id, type, created_at);
create index sends_org_sent_idx on public.sends (org_id, sent_at) where status in ('sent', 'bounced');
create index replies_send_idx on public.replies (send_id) where send_id is not null;

-- SMTP-rejected sends were never stamped; give them a send time so they count as sent.
update public.sends set sent_at = coalesce(claimed_at, updated_at) where status = 'bounced' and sent_at is null;

-- -----------------------------------------------------------------------------
-- record_tracking_event: open pixel / click redirect. Service-role only (the
-- public /t/ routes verify a signed token first). Hits within 60 s of sending
-- or flagged by the caller as scanners are stored with meta.bot = true and
-- ignored by reporting. At most 20 events per send and type, so a leaked
-- token can't flood the table.
-- -----------------------------------------------------------------------------
create or replace function public.record_tracking_event(
  p_send_id  uuid,
  p_type     text,
  p_meta     jsonb default '{}'::jsonb,
  p_scanner  boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_send public.sends;
  v_bot boolean;
begin
  if p_type not in ('open', 'click') then raise exception 'unsupported tracking event %', p_type; end if;
  select * into v_send from public.sends where id = p_send_id;
  if not found or v_send.status <> 'sent' or v_send.sent_at is null then return false; end if;
  if (select count(*) from public.events where send_id = p_send_id and type = p_type) >= 20 then return false; end if;

  v_bot := p_scanner or now() - v_send.sent_at < interval '60 seconds';
  insert into public.events (org_id, send_id, type, meta)
  values (v_send.org_id, p_send_id, p_type, coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('bot', v_bot));
  return true;
end;
$$;

revoke execute on function public.record_tracking_event(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_tracking_event(uuid, text, jsonb, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- analytics_breakdown: cohort metrics for sends sent in the range, grouped by
-- total | campaign | inbox | variant. Every numerator counts distinct sends
-- from that cohort, whenever the open/click/reply happened, so rates are
-- always ≤ 100%. p_days null = all time. An open is any non-bot open or click
-- (a click proves the email was opened even when images were blocked).
-- Security invoker: RLS limits it to the caller's orgs.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_breakdown(
  p_org_id      uuid,
  p_group       text,
  p_tz          text default 'UTC',
  p_days        integer default 30,
  p_campaign_id uuid default null,
  p_account_id  uuid default null
)
returns table (
  key          uuid,
  label        text,
  sub          text,
  step_id      uuid,
  step_order   integer,
  is_active    boolean,
  is_winner    boolean,
  sent         bigint,
  bounced      bigint,
  opened       bigint,
  clicked      bigint,
  replied      bigint,
  positive     bigint,
  unsubscribed bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_from timestamptz;
begin
  if p_group not in ('total', 'campaign', 'inbox', 'variant') then raise exception 'unknown group %', p_group; end if;
  if p_days is not null then
    v_from := (((now() at time zone p_tz)::date - (p_days - 1))::timestamp) at time zone p_tz;
  end if;

  return query
  with cohort as (
    select s.id, s.campaign_id, s.sending_account_id, s.variant_id, s.status
      from public.sends s
     where s.org_id = p_org_id
       and s.status in ('sent', 'bounced')
       and (v_from is null or s.sent_at >= v_from)
       and (p_campaign_id is null or s.campaign_id = p_campaign_id)
       and (p_account_id is null or s.sending_account_id = p_account_id)
  ),
  ev as (
    select e.send_id,
           bool_or(e.type = 'bounce') as bounced,
           bool_or(e.type in ('open', 'click') and not coalesce((e.meta ->> 'bot')::boolean, false)) as opened,
           bool_or(e.type = 'click' and not coalesce((e.meta ->> 'bot')::boolean, false)) as clicked,
           bool_or(e.type = 'reply') as replied,
           bool_or(e.type = 'unsubscribe') as unsubscribed
      from public.events e
      join cohort c on c.id = e.send_id
     group by e.send_id
  ),
  pos as (
    select distinct r.send_id
      from public.replies r
      join cohort c on c.id = r.send_id
     where r.classification = 'positive'
  ),
  flags as (
    select case p_group
             when 'campaign' then c.campaign_id
             when 'inbox' then c.sending_account_id
             when 'variant' then c.variant_id
           end as k,
           (c.status = 'bounced' or coalesce(ev.bounced, false)) as b,
           coalesce(ev.opened, false) as o,
           coalesce(ev.clicked, false) as cl,
           coalesce(ev.replied, false) as r,
           pos.send_id is not null as p,
           coalesce(ev.unsubscribed, false) as u
      from cohort c
      left join ev on ev.send_id = c.id
      left join pos on pos.send_id = c.id
  ),
  agg as (
    select k,
           count(*) as sent,
           count(*) filter (where b) as bounced,
           count(*) filter (where o) as opened,
           count(*) filter (where cl) as clicked,
           count(*) filter (where r) as replied,
           count(*) filter (where p) as positive,
           count(*) filter (where u) as unsubscribed
      from flags
     group by k
  )
  select agg.k,
         case p_group
           when 'total' then 'All sends'
           when 'campaign' then coalesce(cp.name, 'Deleted campaign')
           when 'inbox' then coalesce(sa.email, 'Deleted inbox')
           when 'variant' then coalesce('Step ' || st.step_order || ' · ' || v.ab_group, 'Deleted variant')
         end,
         case when p_group = 'variant' then vc.name end,
         v.step_id,
         st.step_order,
         v.is_active,
         v.is_winner,
         agg.sent, agg.bounced, agg.opened, agg.clicked, agg.replied, agg.positive, agg.unsubscribed
    from agg
    left join public.campaigns cp on p_group = 'campaign' and cp.id = agg.k
    left join public.sending_accounts sa on p_group = 'inbox' and sa.id = agg.k
    left join public.email_variants v on p_group = 'variant' and v.id = agg.k
    left join public.sequence_steps st on st.id = v.step_id
    left join public.sequences sq on sq.id = st.sequence_id
    left join public.campaigns vc on vc.id = sq.campaign_id
   order by agg.sent desc, 2;
end;
$$;

-- -----------------------------------------------------------------------------
-- analytics_daily: activity per calendar day in p_tz. Sends by send day;
-- bounces/opens/clicks/replies/unsubscribes by the day they happened
-- (distinct sends per day, bot hits excluded).
-- -----------------------------------------------------------------------------
create or replace function public.analytics_daily(
  p_org_id      uuid,
  p_tz          text default 'UTC',
  p_days        integer default 30,
  p_campaign_id uuid default null,
  p_account_id  uuid default null
)
returns table (
  day          date,
  sent         bigint,
  bounced      bigint,
  opened       bigint,
  clicked      bigint,
  replied      bigint,
  unsubscribed bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone p_tz)::date;
  v_from timestamptz := (((now() at time zone p_tz)::date - (p_days - 1))::timestamp) at time zone p_tz;
begin
  return query
  with scope as (
    select s.id, s.sent_at
      from public.sends s
     where s.org_id = p_org_id
       and (p_campaign_id is null or s.campaign_id = p_campaign_id)
       and (p_account_id is null or s.sending_account_id = p_account_id)
  ),
  days as (
    select generate_series(v_today - (p_days - 1), v_today, interval '1 day')::date as d
  ),
  sent_d as (
    select (sc.sent_at at time zone p_tz)::date as d, count(*) as n
      from public.sends s join scope sc on sc.id = s.id
     where s.status in ('sent', 'bounced') and s.sent_at >= v_from
     group by 1
  ),
  ev_d as (
    select (e.created_at at time zone p_tz)::date as d,
           count(distinct e.send_id) filter (where e.type = 'bounce') as bounced,
           count(distinct e.send_id) filter (where e.type in ('open', 'click') and not coalesce((e.meta ->> 'bot')::boolean, false)) as opened,
           count(distinct e.send_id) filter (where e.type = 'click' and not coalesce((e.meta ->> 'bot')::boolean, false)) as clicked,
           count(distinct e.send_id) filter (where e.type = 'reply') as replied,
           count(distinct e.send_id) filter (where e.type = 'unsubscribe') as unsubscribed
      from public.events e join scope sc on sc.id = e.send_id
     where e.org_id = p_org_id and e.created_at >= v_from
     group by 1
  )
  select days.d,
         coalesce(sent_d.n, 0),
         coalesce(ev_d.bounced, 0),
         coalesce(ev_d.opened, 0),
         coalesce(ev_d.clicked, 0),
         coalesce(ev_d.replied, 0),
         coalesce(ev_d.unsubscribed, 0)
    from days
    left join sent_d on sent_d.d = days.d
    left join ev_d on ev_d.d = days.d
   order by days.d;
end;
$$;

revoke execute on function public.analytics_breakdown(uuid, text, text, integer, uuid, uuid) from public, anon;
grant execute on function public.analytics_breakdown(uuid, text, text, integer, uuid, uuid) to authenticated, service_role;
revoke execute on function public.analytics_daily(uuid, text, integer, uuid, uuid) from public, anon;
grant execute on function public.analytics_daily(uuid, text, integer, uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- set_variant_winner: promote one variant of a step (it then receives 100% of
-- new sends) or clear the winner (p_variant_id null). Audited.
-- Users need owner/admin/sender; the service role acts as 'system'.
-- -----------------------------------------------------------------------------
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
  elsif current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
        or current_user in ('postgres', 'service_role') then
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
    update public.email_variants set is_winner = true where id = p_variant_id and not is_winner;
  end if;

  insert into public.agent_audit_log (org_id, actor, actor_type, action, target, payload)
  values (
    p_org_id, v_actor, v_actor_type,
    case when p_variant_id is null then 'ab.clear_winner' else 'ab.promote_winner' end,
    'campaign:' || v_campaign::text,
    jsonb_build_object('step_id', p_step_id, 'variant_id', p_variant_id, 'variant', v_label, 'reason', p_reason)
  );
end;
$$;

revoke execute on function public.set_variant_winner(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.set_variant_winner(uuid, uuid, uuid, text, text) to authenticated, service_role;

-- is_winner changes go through set_variant_winner (audited); clients keep editing copy/weights.
revoke update on public.email_variants from authenticated;
grant update (subject, body, weight, is_active) on public.email_variants to authenticated;
