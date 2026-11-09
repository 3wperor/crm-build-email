-- =============================================================================
-- 0017 AI: included AI with a hidden monthly spend cap, the customer's own key,
-- AI reply drafts, and replies sent from YCAReach.
--
-- * ai_usage records every AI call (tokens + cost). Customers never see it:
--   no client grants at all. The cap is checked and reserved atomically by
--   reserve_ai_budget (service role only).
-- * ai_credentials holds the customer's own API key, encrypted by the app
--   (AES-GCM, org id as AAD). Service role only.
-- * reply_messages are replies a user sent from YCAReach, shown in the thread.
-- =============================================================================

alter table public.organizations
  add column ai_provider     text not null default 'included'
                             check (ai_provider in ('included', 'anthropic', 'openai_compatible')),
  add column ai_model        text check (char_length(ai_model) <= 100),
  add column ai_base_url     text check (char_length(ai_base_url) <= 300),
  add column ai_drafts_enabled boolean not null default true;

-- Reply sorting with AI is now part of Pro: on for every workspace by default.
alter table public.organizations alter column ai_classification_enabled set default true;
update public.organizations set ai_classification_enabled = true;

-- Members may flip the two feature toggles; provider/key changes go through the server.
grant update (ai_drafts_enabled) on public.organizations to authenticated;

-- -----------------------------------------------------------------------------
-- ai_credentials: the customer's own key (encrypted). Never readable by clients.
-- -----------------------------------------------------------------------------
create table public.ai_credentials (
  org_id       uuid primary key references public.organizations (id) on delete cascade,
  ciphertext   text not null,
  key_version  integer not null,
  key_hint     text,                       -- last 4 characters, for "sk-…abcd"
  updated_at   timestamptz not null default now()
);
alter table public.ai_credentials enable row level security;
revoke all on public.ai_credentials from anon, authenticated;

-- -----------------------------------------------------------------------------
-- ai_usage: one row per AI call. cost_usd_micros starts as the reserved
-- estimate and is replaced by the real cost when the call finishes.
-- -----------------------------------------------------------------------------
create table public.ai_usage (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  kind             text not null check (kind in ('write_sequence', 'draft_reply', 'classify_reply', 'rewrite', 'test')),
  provider         text not null,
  model            text not null,
  own_key          boolean not null default false,
  status           text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  input_tokens     integer not null default 0,
  output_tokens    integer not null default 0,
  cost_usd_micros  bigint not null default 0 check (cost_usd_micros >= 0),
  created_at       timestamptz not null default now()
);
create index ai_usage_org_created_idx on public.ai_usage (org_id, created_at);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- Spend on included AI this calendar month (UTC), in USD micros.
create or replace function private.ai_month_spend(p_org_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost_usd_micros), 0)::bigint
    from public.ai_usage
   where org_id = p_org_id
     and not own_key
     and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

-- -----------------------------------------------------------------------------
-- reserve_ai_budget: reserve p_estimate against the monthly cap and return the
-- usage row id, or null when the call would go over the cap. Serialized per
-- org so parallel calls can't overshoot. Own-key calls skip the cap.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_ai_budget(
  p_org_id         uuid,
  p_kind           text,
  p_provider       text,
  p_model          text,
  p_own_key        boolean,
  p_estimate_micros bigint,
  p_cap_micros     bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not p_own_key then
    perform pg_advisory_xact_lock(hashtextextended('ai_budget:' || p_org_id::text, 0));
    if private.ai_month_spend(p_org_id) + greatest(p_estimate_micros, 0) > greatest(p_cap_micros, 0) then
      return null;
    end if;
  end if;
  insert into public.ai_usage (org_id, kind, provider, model, own_key, cost_usd_micros)
  values (p_org_id, p_kind, p_provider, p_model, p_own_key, case when p_own_key then 0 else greatest(p_estimate_micros, 0) end)
  returning id into v_id;
  return v_id;
end;
$$;

-- finish_ai_usage: record the real tokens and cost (0 cost for own-key calls).
create or replace function public.finish_ai_usage(
  p_id             uuid,
  p_status         text,
  p_input_tokens   integer,
  p_output_tokens  integer,
  p_cost_micros    bigint
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_usage
     set status = p_status,
         input_tokens = greatest(p_input_tokens, 0),
         output_tokens = greatest(p_output_tokens, 0),
         cost_usd_micros = case when own_key then 0 else greatest(p_cost_micros, 0) end
   where id = p_id;
$$;

revoke execute on function private.ai_month_spend(uuid) from public, anon, authenticated;
revoke execute on function public.reserve_ai_budget(uuid, text, text, text, boolean, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.finish_ai_usage(uuid, text, integer, integer, bigint) from public, anon, authenticated;
grant execute on function private.ai_month_spend(uuid) to service_role;
grant execute on function public.reserve_ai_budget(uuid, text, text, text, boolean, bigint, bigint) to service_role;
grant execute on function public.finish_ai_usage(uuid, text, integer, integer, bigint) to service_role;

-- -----------------------------------------------------------------------------
-- replies: AI draft + "handled" (answered or dismissed).
-- -----------------------------------------------------------------------------
alter table public.replies
  add column draft_status       text check (draft_status in ('pending', 'ready', 'failed', 'skipped')),
  add column draft_body         text check (char_length(draft_body) <= 20000),
  add column draft_generated_at timestamptz,
  add column handled_at         timestamptz;

-- Replies that still need an answer: the sidebar counter and the "Needs reply" filter.
create index replies_needs_reply_idx on public.replies (org_id, received_at desc)
  where handled_at is null and classification in ('positive', 'neutral');

grant update (handled_at, draft_body) on public.replies to authenticated;

-- Replies from before this feature were dealt with outside YCAReach: start the counter at zero.
update public.replies set handled_at = received_at where handled_at is null;

-- -----------------------------------------------------------------------------
-- reply_messages: answers sent from YCAReach, in the same thread as the reply.
-- -----------------------------------------------------------------------------
create table public.reply_messages (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  reply_id            uuid not null,
  lead_id             uuid,
  sending_account_id  uuid,
  message_id          text not null,
  in_reply_to         text,
  "references"        text[] not null default '{}',
  to_email            text not null,
  subject             text not null,
  body_text           text not null check (char_length(body_text) <= 20000),
  status              text not null check (status in ('sent', 'failed')),
  error               text,
  ai_drafted          boolean not null default false,
  sent_by             uuid references public.users (id) on delete set null,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, reply_id) references public.replies (org_id, id) on delete cascade,
  foreign key (org_id, lead_id) references public.leads (org_id, id) on delete set null (lead_id),
  foreign key (org_id, sending_account_id) references public.sending_accounts (org_id, id)
    on delete set null (sending_account_id)
);
create unique index reply_messages_message_id_idx on public.reply_messages (message_id);
create index reply_messages_lead_idx on public.reply_messages (lead_id, created_at);
create index reply_messages_reply_idx on public.reply_messages (reply_id);

alter table public.reply_messages enable row level security;
create policy reply_messages_select on public.reply_messages for select to authenticated
  using (org_id in (select private.user_org_ids()));
revoke insert, update, delete, truncate on public.reply_messages from authenticated;

notify pgrst, 'reload schema';
