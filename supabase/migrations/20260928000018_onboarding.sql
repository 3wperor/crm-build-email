-- =============================================================================
-- 0018 Onboarding: welcome answers, the getting-started checklist, and
-- reminder emails (trial ending / ended / payment failed) sent once each.
-- =============================================================================

alter table public.organizations
  add column onboarding_offer        text check (char_length(onboarding_offer) <= 2000),
  add column onboarding_audience     text check (char_length(onboarding_audience) <= 500),
  add column onboarding_provider     text check (onboarding_provider in ('gmail', 'outlook', 'other')),
  add column onboarding_has_list     boolean,
  add column onboarding_answered_at  timestamptz,
  add column checklist_dismissed_at  timestamptz;

-- Members fill in the welcome questions and can hide the checklist.
grant update (onboarding_offer, onboarding_audience, onboarding_provider, onboarding_has_list,
              onboarding_answered_at, checklist_dismissed_at) on public.organizations to authenticated;

-- -----------------------------------------------------------------------------
-- org_notices: one row per reminder email, so each is sent at most once.
-- key identifies the occurrence (e.g. the trial end date, the period end).
-- Server-only.
-- -----------------------------------------------------------------------------
create table public.org_notices (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  kind        text not null check (kind in ('trial_ending', 'trial_ended', 'trial_limit', 'payment_failed', 'plan_ended')),
  key         text not null,
  recipients  text[] not null default '{}',
  status      text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  error       text,
  created_at  timestamptz not null default now(),
  unique (org_id, kind, key)
);
alter table public.org_notices enable row level security;
revoke all on public.org_notices from anon, authenticated;

-- Existing workspaces have already been set up: don't greet them with the welcome flow.
update public.organizations set onboarding_answered_at = now() where onboarding_answered_at is null;

notify pgrst, 'reload schema';
