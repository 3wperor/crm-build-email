-- =============================================================================
-- 0007 Test emails: log + rate limiting. Written by the server only.
-- =============================================================================
create table public.test_sends (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  user_id             uuid references public.users (id) on delete set null,
  actor               text not null,                 -- 'user:<id>' | 'agent:<key id>'
  sending_account_id  uuid,
  variant_id          uuid,
  to_email            text not null,
  subject             text not null,
  status              text not null check (status in ('sent', 'failed', 'blocked')),
  error               text,
  created_at          timestamptz not null default now(),
  foreign key (org_id, sending_account_id) references public.sending_accounts (org_id, id) on delete set null (sending_account_id),
  foreign key (org_id, variant_id) references public.email_variants (org_id, id) on delete set null (variant_id)
);

create index test_sends_actor_created_idx on public.test_sends (org_id, actor, created_at desc);

alter table public.test_sends enable row level security;
create policy test_sends_select on public.test_sends for select to authenticated
  using (org_id in (select private.user_org_ids()));
revoke insert, update, delete, truncate on public.test_sends from anon, authenticated;
