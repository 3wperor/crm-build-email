-- =============================================================================
-- RLS / tenancy isolation tests. Run against a migrated database:
--   pnpm db:test            (uses local Supabase on :54322 by default)
-- Everything runs inside a transaction that is rolled back. Any failed
-- assertion raises and psql exits non-zero (ON_ERROR_STOP).
-- =============================================================================
\set QUIET on
\pset tuples_only on
\pset format unaligned
begin;

-- Helpers ---------------------------------------------------------------------
create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Runs p_sql and fails unless it raises an error whose SQLSTATE starts with p_state.
create function pg_temp.expect_error(p_sql text, p_state text, p_label text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL [%]: expected error % but statement succeeded', p_label, p_state;
exception
  when others then
    if sqlstate like 'P0001' and sqlerrm like 'FAIL [%' then raise; end if;
    if sqlstate not like p_state || '%' then
      raise exception 'FAIL [%]: expected SQLSTATE %, got % (%)', p_label, p_state, sqlstate, sqlerrm;
    end if;
    raise notice 'ok  - %', p_label;
end;
$$;

create function pg_temp.expect_eq(p_actual bigint, p_expected bigint, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL [%]: expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok  - %', p_label;
end;
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- Fixtures (as superuser) -----------------------------------------------------
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-00000000000a', 'alice@test.example'),
  ('10000000-0000-4000-8000-00000000000b', 'bob@test.example'),
  ('10000000-0000-4000-8000-00000000000c', 'vera@test.example'),
  ('10000000-0000-4000-8000-00000000000d', 'sam@test.example');

-- Alice creates org A through the RPC (as an authenticated user).
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a');
select set_config('test.org_a', public.create_organization('Org A')::text, true);
reset role;

set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000b');
select set_config('test.org_b', public.create_organization('Org B')::text, true);
reset role;

-- Vera = viewer in A, Sam = sender in A.
insert into public.memberships (org_id, user_id, role) values
  (current_setting('test.org_a')::uuid, '10000000-0000-4000-8000-00000000000c', 'viewer'),
  (current_setting('test.org_a')::uuid, '10000000-0000-4000-8000-00000000000d', 'sender');

insert into public.leads (org_id, email) values
  (current_setting('test.org_a')::uuid, 'Lead1@A.example '),
  (current_setting('test.org_b')::uuid, 'lead1@b.example');

select set_config('test.lead_b', (select id::text from public.leads where email = 'lead1@b.example'), true);

insert into public.sending_accounts (org_id, email, provider, smtp_host, smtp_port, imap_host, imap_port, username)
values (current_setting('test.org_a')::uuid, 'me@a.example', 'google', 'smtp.gmail.com', 465, 'imap.gmail.com', 993, 'me@a.example');
insert into public.sending_account_credentials (account_id, org_id, ciphertext)
select id, org_id, 'v1:secret' from public.sending_accounts where email = 'me@a.example';

insert into public.campaigns (org_id, name) values (current_setting('test.org_a')::uuid, 'A campaign');

-- Tests -----------------------------------------------------------------------
select pg_temp.expect_eq(
  (select count(*) from public.leads where email = 'lead1@a.example'), 1, 'email normalized to lowercase/trimmed');

select pg_temp.expect_eq(
  (select count(*) from public.pipeline_stages where org_id = current_setting('test.org_a')::uuid), 5,
  'create_organization seeds 5 default pipeline stages');

-- Alice (owner A)
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a');

select pg_temp.expect_eq((select count(*) from public.organizations), 1, 'owner sees only own org');
select pg_temp.expect_eq((select count(*) from public.leads), 1, 'owner sees only own org leads');
select pg_temp.expect_eq(
  (select count(*) from public.leads where org_id = current_setting('test.org_b')::uuid), 0,
  'cannot read other org leads by filtering on org_id');

select pg_temp.expect_error(
  format('insert into public.leads (org_id, email) values (%L, %L)', current_setting('test.org_b'), 'x@y.example'),
  '42501', 'cannot insert lead into another org');

select pg_temp.expect_error(
  format($q$insert into public.campaign_leads (org_id, campaign_id, lead_id)
            select %L, c.id, %L from public.campaigns c limit 1$q$,
         current_setting('test.org_a'), current_setting('test.lead_b')),
  '23503', 'composite FK blocks linking own campaign to another org''s lead');

select pg_temp.expect_error(
  'select ciphertext from public.sending_account_credentials',
  '42501', 'credentials table is not readable by authenticated users');

select pg_temp.expect_error(
  'update public.sending_accounts set sent_today = 0',
  '42501', 'cannot write sending counters directly');

select pg_temp.expect_error(
  'update public.organizations set sending_paused = true',
  '42501', 'kill switch column cannot be updated directly');

select public.set_sending_paused(current_setting('test.org_a')::uuid, true, 'test pause');
select pg_temp.expect_eq(
  (select count(*) from public.organizations where sending_paused), 1, 'owner can pause via RPC');
select pg_temp.expect_eq(
  (select count(*) from public.agent_audit_log where action = 'pause_all_sending'), 1, 'pause is audited');

select pg_temp.expect_error(
  format('select public.set_sending_paused(%L, true)', current_setting('test.org_b')),
  '42501', 'cannot pause another org');

select pg_temp.expect_error(
  'update public.agent_audit_log set action = ''x''',
  '42501', 'audit log is not writable by clients');

select pg_temp.expect_error(
  format('delete from public.memberships where org_id = %L and user_id = %L',
         current_setting('test.org_a'), '10000000-0000-4000-8000-00000000000a'),
  '23514', 'last owner cannot leave/be removed');
reset role;

-- Sam (sender A)
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000d');
insert into public.leads (org_id, email) values (current_setting('test.org_a')::uuid, 'sender-added@a.example');
select pg_temp.expect_eq((select count(*) from public.leads), 2, 'sender can add leads');
select pg_temp.expect_error(
  format($q$insert into public.sending_accounts (org_id, email, provider, smtp_host, smtp_port, imap_host, imap_port, username)
            values (%L, 'x@a.example', 'smtp', 'h', 465, 'h', 993, 'x')$q$, current_setting('test.org_a')),
  '42501', 'sender cannot add sending accounts');
select pg_temp.expect_error(
  format('select public.set_sending_paused(%L, false)', current_setting('test.org_a')),
  '42501', 'sender cannot resume sending');
reset role;

-- Vera (viewer A)
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000c');
select pg_temp.expect_eq((select count(*) from public.leads), 2, 'viewer can read leads');
select pg_temp.expect_error(
  format('insert into public.leads (org_id, email) values (%L, %L)', current_setting('test.org_a'), 'v@a.example'),
  '42501', 'viewer cannot insert leads');
select pg_temp.expect_error(
  format('select public.set_sending_paused(%L, true)', current_setting('test.org_a')),
  '42501', 'viewer cannot pause sending');
select pg_temp.expect_eq((select count(*) from public.api_keys), 0, 'viewer cannot see api keys');
reset role;

-- Anonymous
set local role anon;
select pg_temp.expect_error('select * from public.leads', '42501', 'anon has no table access');
reset role;

-- Phase 2: sending accounts (Alice = owner A)
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a');
insert into public.sending_accounts (org_id, email, provider, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure, username, daily_cap, display_name)
values (current_setting('test.org_a')::uuid, 'Owner@A.example', 'smtp', 'smtp.a.example', 587, false, 'imap.a.example', 993, true, 'owner', 40, 'Owner');
select pg_temp.expect_eq(
  (select count(*) from public.sending_accounts where email = 'owner@a.example'), 1, 'admin+ can add a sending account (email normalized)');
select pg_temp.expect_error(
  format($q$insert into public.sending_accounts (org_id, email, provider, smtp_host, smtp_port, imap_host, imap_port, username, health)
            values (%L, 'h@a.example', 'smtp', 'h', 465, 'h', 993, 'h', 'healthy')$q$, current_setting('test.org_a')),
  '42501', 'clients cannot set health on insert');
select pg_temp.expect_error(
  $q$update public.sending_accounts set health = 'healthy'$q$, '42501', 'clients cannot set health on update');
update public.sending_accounts set daily_cap = 45, status = 'paused' where email = 'owner@a.example';
select pg_temp.expect_eq(
  (select daily_cap from public.sending_accounts where email = 'owner@a.example'), 45, 'admin+ can update cap/status');
select pg_temp.expect_error(
  $q$insert into public.sending_account_credentials (account_id, org_id, ciphertext)
     select id, org_id, 'x' from public.sending_accounts where email = 'owner@a.example'$q$,
  '42501', 'clients cannot write credentials');
reset role;

insert into public.sending_account_credentials (account_id, org_id, ciphertext)
select id, org_id, 'v1:x:y:z' from public.sending_accounts where email = 'owner@a.example';

set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a');
delete from public.sending_accounts where email = 'owner@a.example';
reset role;
select pg_temp.expect_eq(
  (select count(*) from public.sending_account_credentials c
   where not exists (select 1 from public.sending_accounts a where a.id = c.account_id)), 0,
  'deleting an account cascades its credential');
select pg_temp.expect_eq(
  (select count(*) from public.sending_account_credentials), 1, 'other credentials untouched');

insert into public.sending_accounts (org_id, email, provider, smtp_host, smtp_port, imap_host, imap_port, username)
values (current_setting('test.org_a')::uuid, 'nocred@a.example', 'smtp', 'h', 465, 'h', 993, 'u');
select pg_temp.expect_error(
  format($q$insert into public.sending_account_credentials (account_id, org_id, ciphertext)
            select id, %L, 'x' from public.sending_accounts where email = 'nocred@a.example'$q$, current_setting('test.org_b')),
  '23503', 'credential org must match its account org (composite FK)');

-- Phase 3: import_leads_chunk + suppression triggers ----------------------------
insert into public.leads (org_id, email, first_name, company) values
  (current_setting('test.org_a')::uuid, 'existing@a.example', 'Old', null);
insert into public.suppression_list (org_id, email, reason) values
  (current_setting('test.org_a')::uuid, 'blocked@a.example', 'unsubscribe');
insert into public.lead_lists (org_id, name) values (current_setting('test.org_a')::uuid, 'Imported list');
insert into public.imports (org_id, filename) values (current_setting('test.org_a')::uuid, 'test.csv');
select set_config('test.import', (select id::text from public.imports where filename = 'test.csv'), true);
select set_config('test.list', (select id::text from public.lead_lists where name = 'Imported list'), true);

select set_config('test.chunk', $j$[
  {"row": 2, "email": "New1@A.example", "first_name": "N1", "custom": {"plan": "pro"}},
  {"row": 3, "email": "existing@a.example", "first_name": "Ignored", "company": "FillMe", "custom": {"plan": "x"}},
  {"row": 4, "email": "blocked@a.example", "first_name": "B"}
]$j$, true);

select set_config('test.result', public.import_leads_chunk(
  current_setting('test.org_a')::uuid, current_setting('test.import')::uuid,
  'skip', current_setting('test.chunk')::jsonb, current_setting('test.list')::uuid)::text, true);
select pg_temp.expect_eq(
  (select count(*) from jsonb_array_elements(current_setting('test.result')::jsonb -> 'imported_rows')), 1, 'import: 1 new lead');
select pg_temp.expect_eq(
  ((current_setting('test.result')::jsonb -> 'existing_rows' ->> 0)::int), 3, 'import: existing row reported');
select pg_temp.expect_eq(
  ((current_setting('test.result')::jsonb -> 'suppressed_rows' ->> 0)::int), 4, 'import: suppressed row reported');
select pg_temp.expect_eq(
  (select count(*) from public.leads where email = 'blocked@a.example'), 0, 'import: suppressed address not inserted');
select pg_temp.expect_eq(
  (select count(*) from public.leads where email = 'existing@a.example' and first_name = 'Old' and company is null), 1,
  'import skip mode: existing lead untouched');
select pg_temp.expect_eq(
  (select count(*) from public.leads where email = 'new1@a.example' and custom_json ->> 'plan' = 'pro'), 1,
  'import: email normalized, custom fields stored');
select pg_temp.expect_eq(
  (select count(*) from public.lead_list_members where list_id = current_setting('test.list')::uuid), 2,
  'import: new + existing leads added to list, suppressed not');

-- Retry of the same chunk is idempotent.
select pg_temp.expect_eq(
  (select count(*) from jsonb_array_elements(public.import_leads_chunk(
     current_setting('test.org_a')::uuid, current_setting('test.import')::uuid,
     'skip', current_setting('test.chunk')::jsonb, current_setting('test.list')::uuid) -> 'imported_rows')), 1, 'import: retry is idempotent');

-- Fill mode fills blanks only.
insert into public.imports (org_id, filename) values (current_setting('test.org_a')::uuid, 'fill.csv');
select public.import_leads_chunk(
  current_setting('test.org_a')::uuid, (select id from public.imports where filename = 'fill.csv'),
  'fill', current_setting('test.chunk')::jsonb);
select pg_temp.expect_eq(
  (select count(*) from public.leads where email = 'existing@a.example' and first_name = 'Old' and company = 'FillMe'
     and custom_json ->> 'plan' = 'x'), 1, 'import fill mode: blanks filled, existing values kept');

-- Only the service role may call it.
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a');
select pg_temp.expect_error(
  format('select public.import_leads_chunk(%L, %L, ''skip'', ''[]'')', current_setting('test.org_a'), current_setting('test.import')),
  '42501', 'import_leads_chunk is not callable by clients');
select pg_temp.expect_error(
  format('update public.imports set imported_count = 5 where id = %L', current_setting('test.import')),
  '42501', 'clients cannot write import counters');
reset role;

-- Suppression triggers: mark lead + stop enrollments + cancel scheduled sends.
insert into public.campaign_leads (org_id, campaign_id, lead_id, status)
select l.org_id, c.id, l.id, 'active'
  from public.leads l, public.campaigns c
 where l.email = 'new1@a.example' and c.name = 'A campaign';
insert into public.sends (org_id, campaign_id, campaign_lead_id, lead_id, status)
select cl.org_id, cl.campaign_id, cl.id, cl.lead_id, 'scheduled' from public.campaign_leads cl
  join public.leads l on l.id = cl.lead_id where l.email = 'new1@a.example';

set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000d');   -- Sam (sender) suppresses
insert into public.suppression_list (org_id, email, reason) values (current_setting('test.org_a')::uuid, 'NEW1@a.example', 'manual');
reset role;
select pg_temp.expect_eq(
  (select count(*) from public.leads where email = 'new1@a.example' and status = 'do_not_contact'), 1,
  'suppression marks lead do_not_contact');
select pg_temp.expect_eq(
  (select count(*) from public.campaign_leads cl join public.leads l on l.id = cl.lead_id
    where l.email = 'new1@a.example' and cl.status = 'stopped' and cl.next_send_at is null), 1,
  'suppression stops active enrollments');
select pg_temp.expect_eq(
  (select count(*) from public.sends s join public.leads l on l.id = s.lead_id
    where l.email = 'new1@a.example' and s.status = 'cancelled'), 1,
  'suppression cancels scheduled sends');

set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000d');
delete from public.suppression_list where email = 'new1@a.example';
select pg_temp.expect_eq(
  (select count(*) from public.suppression_list where email = 'new1@a.example'), 1, 'sender cannot remove suppression entries');
select pg_temp.login('10000000-0000-4000-8000-00000000000a');
delete from public.suppression_list where email = 'new1@a.example';
reset role;
select pg_temp.expect_eq(
  (select count(*) from public.leads where email = 'new1@a.example' and status = 'new'), 1,
  'admin removing suppression makes lead contactable again');

-- Bob (owner B) cannot see A's audit log or campaigns.
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000b');
select pg_temp.expect_eq((select count(*) from public.agent_audit_log), 0, 'other org cannot read audit log');
select pg_temp.expect_eq((select count(*) from public.campaigns), 0, 'other org cannot read campaigns');
reset role;

rollback;
