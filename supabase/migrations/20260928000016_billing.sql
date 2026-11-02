-- =============================================================================
-- 0016 Billing: plans per workspace, a 7-day / 200-email trial, Stripe state.
-- Replaces the per-user is_paid flag from 0015. Only the server (service role)
-- can change any billing column: clients' update grants don't include them.
-- =============================================================================

alter table public.users drop column if exists is_paid;

alter table public.organizations
  add column plan                   text not null default 'trial' check (plan in ('trial', 'standard', 'pro', 'expired')),
  add column trial_ends_at          timestamptz not null default (now() + interval '7 days'),
  add column trial_email_limit      integer not null default 200 check (trial_email_limit >= 0),
  add column billing_interval       text check (billing_interval in ('month', 'year')),
  add column stripe_customer_id     text unique,
  add column stripe_subscription_id text,
  add column subscription_status    text,
  add column current_period_end     timestamptz,
  add column cancel_at_period_end   boolean not null default false;

create index sends_org_claimed_idx on public.sends (org_id) where claimed_at is not null;

-- Campaign emails counted against the trial: every reserved send slot.
create or replace function private.trial_emails_used(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.sends where org_id = p_org_id and claimed_at is not null;
$$;

-- -----------------------------------------------------------------------------
-- send_block_reason: null = may send; otherwise why not:
--   plan_expired | trial_ended | trial_limit
-- p_lock serializes trial senders on the org row (used by reserve_send_slot).
-- -----------------------------------------------------------------------------
create or replace function private.send_block_reason(p_org_id uuid, p_lock boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
begin
  if p_lock then
    select * into v_org from public.organizations where id = p_org_id for update;
  else
    select * into v_org from public.organizations where id = p_org_id;
  end if;
  if not found then return 'plan_expired'; end if;
  if v_org.plan in ('standard', 'pro') then return null; end if;
  if v_org.plan = 'expired' then return 'plan_expired'; end if;
  if now() >= v_org.trial_ends_at then return 'trial_ended'; end if;
  if private.trial_emails_used(p_org_id) >= v_org.trial_email_limit then return 'trial_limit'; end if;
  return null;
end;
$$;
revoke execute on function private.send_block_reason(uuid, boolean) from public, anon, authenticated;
revoke execute on function private.trial_emails_used(uuid) from public, anon, authenticated;
grant execute on function private.send_block_reason(uuid, boolean) to service_role;
grant execute on function private.trial_emails_used(uuid) to service_role;

-- Members (and the server) can ask; the UI uses this to show the trial meter and paywall.
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
  if auth.uid() is not null and p_org_id not in (select private.user_org_ids()) then
    raise exception 'not a member' using errcode = 'insufficient_privilege';
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
-- apply_stripe_subscription: called by the Stripe webhook with the subscription's
-- current state (fetched fresh from Stripe, so event order doesn't matter).
-- active / trialing → the paid plan; anything else → expired (sending pauses,
-- data stays). Events for an older, replaced subscription are ignored.
-- -----------------------------------------------------------------------------
create or replace function public.apply_stripe_subscription(
  p_org_id          uuid,
  p_customer_id     text,
  p_subscription_id text,
  p_status          text,
  p_plan            text,
  p_interval        text,
  p_period_end      timestamptz,
  p_cancel_at_end   boolean
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_new_plan text;
begin
  if p_plan not in ('standard', 'pro') then raise exception 'unknown plan %', p_plan; end if;
  select * into v_org from public.organizations where id = p_org_id for update;
  if not found then raise exception 'organization not found' using errcode = 'no_data_found'; end if;

  if v_org.stripe_subscription_id is not null and v_org.stripe_subscription_id <> p_subscription_id
     and p_status not in ('active', 'trialing') then
    return 'ignored_old_subscription';
  end if;

  v_new_plan := case when p_status in ('active', 'trialing') then p_plan else 'expired' end;
  update public.organizations
     set plan = v_new_plan,
         stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
         stripe_subscription_id = p_subscription_id,
         subscription_status = p_status,
         billing_interval = p_interval,
         current_period_end = p_period_end,
         cancel_at_period_end = coalesce(p_cancel_at_end, false)
   where id = p_org_id;

  if v_new_plan is distinct from v_org.plan or p_status is distinct from v_org.subscription_status then
    insert into public.agent_audit_log (org_id, actor, actor_type, action, target, payload)
    values (p_org_id, 'system:stripe', 'system', 'billing.subscription', 'subscription:' || p_subscription_id,
            jsonb_build_object('plan', v_new_plan, 'status', p_status, 'interval', p_interval, 'previous_plan', v_org.plan));
  end if;
  return v_new_plan;
end;
$$;
revoke execute on function public.apply_stripe_subscription(uuid, text, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription(uuid, text, text, text, text, text, timestamptz, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- Sending slots now check the plan too (same functions as 0006 / 0011 plus the check).
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
  v_block text;
begin
  select * into v_send from public.sends where org_id = p_org_id and id = p_send_id for update;
  if not found or v_send.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'not_scheduled');
  end if;

  -- Billing: no plan (or trial over) → no sending. Locks the org row while on
  -- trial so concurrent senders can't overshoot the trial allowance.
  v_block := private.send_block_reason(p_org_id, true);
  if v_block is not null then
    return jsonb_build_object('ok', false, 'reason', 'plan', 'detail', v_block);
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
  if private.send_block_reason(v_msg.org_id, false) is not null then
    return jsonb_build_object('ok', false, 'reason', 'plan');
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
