-- =============================================================================
-- 0012 Agent control plane: approval queue for agent actions that would send
-- email while the workspace/campaign is in draft (approval) mode.
-- =============================================================================

create table public.agent_approvals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  api_key_id   uuid references public.api_keys (id) on delete set null,
  tool         text not null,
  args         jsonb not null default '{}'::jsonb,
  campaign_id  uuid,
  summary      text not null,
  reason       text,
  status       text not null default 'pending' check (status in ('pending', 'rejected', 'executed', 'failed')),
  result       jsonb,
  error        text,
  decided_by   uuid references public.users (id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete cascade
);

create index agent_approvals_org_status_idx on public.agent_approvals (org_id, status, created_at desc);

alter table public.agent_approvals enable row level security;
create policy agent_approvals_select on public.agent_approvals for select to authenticated
  using (org_id in (select private.user_org_ids()));
-- Decisions go through the server (it re-checks the role and executes the tool).
revoke insert, update, delete, truncate on public.agent_approvals from authenticated;

-- Agent actions are attributable where they land.
alter table public.replies drop constraint replies_classification_source_check,
  add constraint replies_classification_source_check check (classification_source in ('heuristic', 'ai', 'manual', 'agent'));
alter table public.opportunities drop constraint opportunities_source_check,
  add constraint opportunities_source_check check (source in ('reply', 'manual', 'agent'));
