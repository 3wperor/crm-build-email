-- =============================================================================
-- 0003 Row-Level Security.
--
-- Role model (memberships.role):
--   viewer : read everything in the org
--   sender : + manage leads, lists, imports, campaigns, sequences, pipeline cards,
--              suppression inserts, reply classification
--   admin  : + sending accounts, domains, pipeline stages, API keys, org settings,
--              removing suppression entries
--   owner  : + members, delete org
--
-- Tables written only by background jobs / the server (service role bypasses RLS):
--   sending_account_credentials, sends, events, warmup_events, agent_audit_log
-- =============================================================================

-- Enable RLS everywhere in public.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Standard org-scoped tables: SELECT for members, writes for a role set.
-- -----------------------------------------------------------------------------
do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      -- table                        write roles
      ('domains',                     array['owner','admin']),
      ('sending_accounts',            array['owner','admin']),
      ('lead_lists',                  array['owner','admin','sender']),
      ('imports',                     array['owner','admin','sender']),
      ('leads',                       array['owner','admin','sender']),
      ('lead_list_members',           array['owner','admin','sender']),
      ('campaigns',                   array['owner','admin','sender']),
      ('campaign_sending_accounts',   array['owner','admin','sender']),
      ('sequences',                   array['owner','admin','sender']),
      ('sequence_steps',              array['owner','admin','sender']),
      ('email_variants',              array['owner','admin','sender']),
      ('campaign_leads',              array['owner','admin','sender']),
      ('pipeline_stages',             array['owner','admin']),
      ('opportunities',               array['owner','admin','sender'])
    ) as v(tbl, roles)
  loop
    execute format($f$
      create policy %1$I on public.%2$I for select to authenticated
        using (org_id in (select private.user_org_ids()));
      create policy %3$I on public.%2$I for insert to authenticated
        with check (org_id in (select private.user_org_ids_with_role(%6$L)));
      create policy %4$I on public.%2$I for update to authenticated
        using (org_id in (select private.user_org_ids_with_role(%6$L)))
        with check (org_id in (select private.user_org_ids_with_role(%6$L)));
      create policy %5$I on public.%2$I for delete to authenticated
        using (org_id in (select private.user_org_ids_with_role(%6$L)));
    $f$,
      rec.tbl || '_select', rec.tbl, rec.tbl || '_insert', rec.tbl || '_update',
      rec.tbl || '_delete', rec.roles::text);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Read-only (for clients) org-scoped tables.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sends', 'events', 'warmup_events', 'agent_audit_log']
  loop
    execute format($f$
      create policy %1$I on public.%2$I for select to authenticated
        using (org_id in (select private.user_org_ids()));
      revoke insert, update, delete, truncate on public.%2$I from authenticated;
    $f$, t || '_select', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- replies: members read; sender+ may reclassify (update only).
-- -----------------------------------------------------------------------------
create policy replies_select on public.replies for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy replies_update on public.replies for update to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner','admin','sender'])))
  with check (org_id in (select private.user_org_ids_with_role(array['owner','admin','sender'])));

revoke insert, update, delete, truncate on public.replies from authenticated;
grant update (classification, classification_source) on public.replies to authenticated;

-- -----------------------------------------------------------------------------
-- suppression_list: sender+ add; admin+ remove; nobody edits in place.
-- -----------------------------------------------------------------------------
create policy suppression_select on public.suppression_list for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy suppression_insert on public.suppression_list for insert to authenticated
  with check (org_id in (select private.user_org_ids_with_role(array['owner','admin','sender'])));
create policy suppression_delete on public.suppression_list for delete to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner','admin'])));

-- -----------------------------------------------------------------------------
-- sending_account_credentials: service role ONLY. RLS on + no policies, and
-- privileges revoked so even a policy mistake cannot expose ciphertext.
-- -----------------------------------------------------------------------------
revoke all on public.sending_account_credentials from anon, authenticated;

-- sending_accounts: clients may not touch counters, cursors or health directly.
revoke insert, update on public.sending_accounts from authenticated;
grant insert (org_id, domain_id, email, display_name, provider, smtp_host, smtp_port, smtp_secure,
              imap_host, imap_port, imap_secure, username, timezone, daily_cap, warmup_enabled)
  on public.sending_accounts to authenticated;
grant update (domain_id, display_name, timezone, daily_cap, warmup_enabled, status)
  on public.sending_accounts to authenticated;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------
create policy organizations_select on public.organizations for select to authenticated
  using (id in (select private.user_org_ids()));
create policy organizations_update on public.organizations for update to authenticated
  using (id in (select private.user_org_ids_with_role(array['owner','admin'])))
  with check (id in (select private.user_org_ids_with_role(array['owner','admin'])));
create policy organizations_delete on public.organizations for delete to authenticated
  using (id in (select private.user_org_ids_with_role(array['owner'])));

-- Orgs are created via create_organization(); the kill switch only via
-- set_sending_paused() so every pause/resume is audited.
revoke insert, update on public.organizations from authenticated;
grant update (name, physical_address, default_timezone, approval_mode)
  on public.organizations to authenticated;

-- -----------------------------------------------------------------------------
-- memberships
-- -----------------------------------------------------------------------------
create policy memberships_select on public.memberships for select to authenticated
  using (org_id in (select private.user_org_ids()));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (org_id in (select private.user_org_ids_with_role(array['owner'])));
create policy memberships_update on public.memberships for update to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner'])))
  with check (org_id in (select private.user_org_ids_with_role(array['owner'])));
create policy memberships_delete on public.memberships for delete to authenticated
  using (
    org_id in (select private.user_org_ids_with_role(array['owner']))
    or user_id = (select auth.uid())   -- anyone may leave an org
  );

revoke update on public.memberships from authenticated;
grant update (role) on public.memberships to authenticated;

-- -----------------------------------------------------------------------------
-- users: see yourself and people who share an org with you; edit only yourself.
-- -----------------------------------------------------------------------------
create policy users_select on public.users for select to authenticated
  using (
    id = (select auth.uid())
    or id in (
      select m.user_id from public.memberships m
      where m.org_id in (select private.user_org_ids())
    )
  );
create policy users_update on public.users for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke insert, update on public.users from authenticated;
grant update (full_name) on public.users to authenticated;

-- -----------------------------------------------------------------------------
-- api_keys: admin+ only (hashes are not secrets, but key metadata is sensitive).
-- -----------------------------------------------------------------------------
create policy api_keys_select on public.api_keys for select to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner','admin'])));
create policy api_keys_insert on public.api_keys for insert to authenticated
  with check (org_id in (select private.user_org_ids_with_role(array['owner','admin'])));
create policy api_keys_update on public.api_keys for update to authenticated
  using (org_id in (select private.user_org_ids_with_role(array['owner','admin'])))
  with check (org_id in (select private.user_org_ids_with_role(array['owner','admin'])));

revoke update on public.api_keys from authenticated;
grant update (name, revoked_at) on public.api_keys to authenticated;

-- -----------------------------------------------------------------------------
-- Anonymous users get nothing, anywhere.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
