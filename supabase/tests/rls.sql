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

-- Bob (owner B) cannot see A's audit log or campaigns.
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000b');
select pg_temp.expect_eq((select count(*) from public.agent_audit_log), 0, 'other org cannot read audit log');
select pg_temp.expect_eq((select count(*) from public.campaigns), 0, 'other org cannot read campaigns');
reset role;

rollback;
