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

-- Phase 4: verification -------------------------------------------------------
insert into public.leads (org_id, email) values
  (current_setting('test.org_a')::uuid, 'v1@acme.example'),
  (current_setting('test.org_a')::uuid, 'v2@acme.example'),
  (current_setting('test.org_a')::uuid, 'v3@acme.example');
insert into public.verification_runs (org_id, source) values (current_setting('test.org_a')::uuid, 'manual');
select set_config('test.run', (select id::text from public.verification_runs limit 1), true);

select pg_temp.expect_eq(public.claim_leads_for_verification(
  current_setting('test.org_a')::uuid, current_setting('test.run')::uuid,
  p_lead_ids => (select array_agg(id) from public.leads where email like 'v_@acme.example')), 3, 'verify: claims 3 leads');
insert into public.verification_runs (org_id, source) values (current_setting('test.org_a')::uuid, 'manual');
select pg_temp.expect_eq(public.claim_leads_for_verification(
  current_setting('test.org_a')::uuid, (select id from public.verification_runs where total = 0 order by created_at desc limit 1),
  p_all_unverified => true), (select count(*)::int from public.leads where org_id = current_setting('test.org_a')::uuid and verification_status = 'unverified'),
  'verify: second run skips leads already claimed');
select pg_temp.expect_error(
  format('select public.claim_leads_for_verification(%L, %L)', current_setting('test.org_a'), current_setting('test.run')),
  'P0001', 'verify: claim requires exactly one selector');

-- v3 is enrolled + scheduled; turning out invalid must stop it.
insert into public.campaign_leads (org_id, campaign_id, lead_id, status)
select l.org_id, c.id, l.id, 'active' from public.leads l, public.campaigns c
 where l.email = 'v3@acme.example' and c.name = 'A campaign';
insert into public.sends (org_id, campaign_id, campaign_lead_id, lead_id, status)
select cl.org_id, cl.campaign_id, cl.id, cl.lead_id, 'scheduled' from public.campaign_leads cl
  join public.leads l on l.id = cl.lead_id where l.email = 'v3@acme.example';

select set_config('test.results', (select jsonb_agg(jsonb_build_object(
  'id', id,
  'status', case email when 'v1@acme.example' then 'valid' when 'v2@acme.example' then 'risky' else 'invalid' end,
  'detail', jsonb_build_object('level', 'mx'))) from public.leads where email like 'v_@acme.example')::text, true);
select pg_temp.expect_eq(public.apply_verification_results(
  current_setting('test.org_a')::uuid, current_setting('test.run')::uuid, current_setting('test.results')::jsonb), 3,
  'verify: applies 3 results');
select pg_temp.expect_eq(public.apply_verification_results(
  current_setting('test.org_a')::uuid, current_setting('test.run')::uuid, current_setting('test.results')::jsonb), 0,
  'verify: re-applying (retry) is a no-op');
select pg_temp.expect_eq(
  (select valid_count * 100 + risky_count * 10 + invalid_count from public.verification_runs where id = current_setting('test.run')::uuid), 111,
  'verify: run counters');
select pg_temp.expect_eq(
  (select count(*) from public.leads where email like 'v_@acme.example' and verification_run_id is null and verified_at is not null), 3,
  'verify: leads released from run');
select pg_temp.expect_eq(
  (select count(*) from public.campaign_leads cl join public.leads l on l.id = cl.lead_id
    where l.email = 'v3@acme.example' and cl.status = 'stopped' and cl.stopped_reason = 'invalid_email'), 1,
  'verify: invalid lead enrollment stopped');
select pg_temp.expect_eq(
  (select count(*) from public.sends s join public.leads l on l.id = s.lead_id
    where l.email = 'v3@acme.example' and s.status = 'cancelled'), 1, 'verify: invalid lead scheduled send cancelled');

-- Email change resets verification.
update public.leads set email = 'v1-new@acme.example' where email = 'v1@acme.example';
select pg_temp.expect_eq(
  (select count(*) from public.leads where email = 'v1-new@acme.example' and verification_status = 'unverified' and verified_at is null), 1,
  'verify: changing email resets verification');

-- Clients can't touch job bookkeeping or the cache.
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a');
select pg_temp.expect_error(
  format('update public.leads set verification_run_id = %L', current_setting('test.run')), '42501', 'verify: clients cannot set verification_run_id');
select pg_temp.expect_error('select * from public.domain_checks', '42501', 'verify: domain cache not client-readable');
select pg_temp.expect_error(
  format('select public.apply_verification_results(%L, %L, ''[]'')', current_setting('test.org_a'), current_setting('test.run')),
  '42501', 'verify: apply_verification_results not client-callable');
select pg_temp.expect_eq((select count(*) from public.verification_runs), 2, 'verify: members can read their runs');
update public.leads set verification_status = 'valid' where email = 'v2@acme.example';
select pg_temp.expect_eq((select count(*) from public.leads where email = 'v2@acme.example' and verification_status = 'valid'), 1,
  'verify: manual verification override allowed');
reset role;

-- Phase 5: enrollment, send slots, completion, stop --------------------------
insert into public.campaigns (org_id, name, daily_limit, daily_limit_per_inbox, timezone)
values (current_setting('test.org_a')::uuid, 'Sched campaign', 3, 2, 'UTC');
select set_config('test.camp', (select id::text from public.campaigns where name = 'Sched campaign'), true);
insert into public.sequences (org_id, campaign_id) values (current_setting('test.org_a')::uuid, current_setting('test.camp')::uuid);
insert into public.sequence_steps (org_id, sequence_id, step_order, delay_days)
select org_id, id, 1, 0 from public.sequences where campaign_id = current_setting('test.camp')::uuid;
insert into public.sequence_steps (org_id, sequence_id, step_order, delay_days)
select org_id, id, 2, 2 from public.sequences where campaign_id = current_setting('test.camp')::uuid;

insert into public.leads (org_id, email, verification_status, status) values
  (current_setting('test.org_a')::uuid, 'ok1@sched.example', 'valid', 'new'),
  (current_setting('test.org_a')::uuid, 'ok2@sched.example', 'unverified', 'new'),
  (current_setting('test.org_a')::uuid, 'risky@sched.example', 'risky', 'new'),
  (current_setting('test.org_a')::uuid, 'invalid@sched.example', 'invalid', 'new'),
  (current_setting('test.org_a')::uuid, 'replied@sched.example', 'valid', 'replied'),
  (current_setting('test.org_a')::uuid, 'supp@sched.example', 'valid', 'new'),
  (current_setting('test.org_a')::uuid, 'busy@sched.example', 'valid', 'new');
insert into public.suppression_list (org_id, email, reason) values (current_setting('test.org_a')::uuid, 'supp@sched.example', 'manual');
-- busy@ is live in another campaign
insert into public.campaign_leads (org_id, campaign_id, lead_id, status)
select l.org_id, c.id, l.id, 'active' from public.leads l, public.campaigns c where l.email = 'busy@sched.example' and c.name = 'A campaign';
insert into public.lead_lists (org_id, name) values (current_setting('test.org_a')::uuid, 'Sched list');
insert into public.lead_list_members (org_id, list_id, lead_id)
select l.org_id, ll.id, l.id from public.leads l, public.lead_lists ll where l.email like '%@sched.example' and ll.name = 'Sched list';

-- Viewer cannot enroll; sender can (RLS applies inside the function).
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000c');
select pg_temp.expect_error(
  format('select public.enroll_leads(%L, p_list_id => (select id from public.lead_lists where name = ''Sched list''))', current_setting('test.camp')),
  '42501', 'enroll: viewer cannot enroll');
select pg_temp.login('10000000-0000-4000-8000-00000000000d');
select set_config('test.enroll', public.enroll_leads(current_setting('test.camp')::uuid,
  p_list_id => (select id from public.lead_lists where name = 'Sched list'))::text, true);
reset role;
select pg_temp.expect_eq((current_setting('test.enroll')::jsonb ->> 'enrolled')::int, 2, 'enroll: only ok1 + ok2 eligible');
select pg_temp.expect_eq((current_setting('test.enroll')::jsonb ->> 'skipped')::int, 5,
  'enroll: risky, invalid, replied, suppressed, busy-elsewhere skipped');
update public.campaigns set include_risky = true where id = current_setting('test.camp')::uuid;
select pg_temp.expect_eq((public.enroll_leads(current_setting('test.camp')::uuid,
  p_lead_ids => array(select id from public.leads where email = 'risky@sched.example')) ->> 'enrolled')::int, 1,
  'enroll: risky allowed when campaign opts in');
select pg_temp.expect_eq((public.enroll_leads(current_setting('test.camp')::uuid,
  p_list_id => (select id from public.lead_lists where name = 'Sched list')) ->> 'enrolled')::int, 0, 'enroll: idempotent');

-- Send slots: inbox daily_cap 2, campaign per-inbox 2, campaign daily 3
insert into public.sending_accounts (org_id, email, provider, smtp_host, smtp_port, imap_host, imap_port, username, daily_cap)
values (current_setting('test.org_a')::uuid, 'sender@sched.example', 'smtp', 'h', 465, 'h', 993, 'u', 2);
select set_config('test.acct', (select id::text from public.sending_accounts where email = 'sender@sched.example'), true);
insert into public.sends (id, org_id, campaign_id, campaign_lead_id, lead_id, step_id, sending_account_id, status, message_id, subject)
select gen_random_uuid(), cl.org_id, cl.campaign_id, cl.id, cl.lead_id,
       (select st.id from public.sequence_steps st join public.sequences sq on sq.id = st.sequence_id where sq.campaign_id = cl.campaign_id and st.step_order = 1),
       current_setting('test.acct')::uuid, 'scheduled', '<' || l.email || '@msg>', 'Hello ' || l.email
  from public.campaign_leads cl join public.leads l on l.id = cl.lead_id
 where cl.campaign_id = current_setting('test.camp')::uuid;

select pg_temp.expect_eq((select count(*) from public.sends where campaign_id = current_setting('test.camp')::uuid), 3, 'slots: 3 scheduled sends');
select set_config('test.s1', (select s.id::text from public.sends s join public.leads l on l.id = s.lead_id where l.email = 'ok1@sched.example'), true);
select set_config('test.s2', (select s.id::text from public.sends s join public.leads l on l.id = s.lead_id where l.email = 'ok2@sched.example'), true);
select set_config('test.s3', (select s.id::text from public.sends s join public.leads l on l.id = s.lead_id where l.email = 'risky@sched.example'), true);

select pg_temp.expect_eq(((public.reserve_send_slot(current_setting('test.org_a')::uuid, current_setting('test.s1')::uuid)) ->> 'ok')::boolean::int, 1, 'slots: first reservation ok');
select pg_temp.expect_eq((select (status = 'sending' and claimed_at is not null)::int from public.sends where id = current_setting('test.s1')::uuid), 1, 'slots: send marked sending');
select pg_temp.expect_eq(((public.reserve_send_slot(current_setting('test.org_a')::uuid, current_setting('test.s1')::uuid)) ->> 'reason' = 'not_scheduled')::int, 1, 'slots: cannot reserve twice');
select pg_temp.expect_eq(((public.reserve_send_slot(current_setting('test.org_a')::uuid, current_setting('test.s2')::uuid)) ->> 'reason' = 'pacing')::int, 1, 'slots: pacing gap enforced');
select pg_temp.expect_eq((select (next_available_at between now() + interval '179 seconds' and now() + interval '421 seconds')::int from public.sending_accounts where id = current_setting('test.acct')::uuid), 1, 'slots: gap is 3-7 minutes');
update public.sending_accounts set next_available_at = null where id = current_setting('test.acct')::uuid;
select pg_temp.expect_eq(((public.reserve_send_slot(current_setting('test.org_a')::uuid, current_setting('test.s2')::uuid, 0, 0)) ->> 'ok')::boolean::int, 1, 'slots: second reservation ok');
update public.sending_accounts set next_available_at = null where id = current_setting('test.acct')::uuid;
select pg_temp.expect_eq(((public.reserve_send_slot(current_setting('test.org_a')::uuid, current_setting('test.s3')::uuid, 0, 0)) ->> 'reason' = 'inbox_daily_cap')::int, 1, 'slots: inbox daily cap enforced');
update public.sending_accounts set daily_cap = 10 where id = current_setting('test.acct')::uuid;
select pg_temp.expect_eq(((public.reserve_send_slot(current_setting('test.org_a')::uuid, current_setting('test.s3')::uuid, 0, 0)) ->> 'reason' = 'campaign_inbox_cap')::int, 1, 'slots: campaign per-inbox cap enforced');

select public.release_send_slot(current_setting('test.org_a')::uuid, current_setting('test.s2')::uuid);
select pg_temp.expect_eq((select sent_today from public.sending_accounts where id = current_setting('test.acct')::uuid), 1, 'slots: release gives the slot back');

-- complete_send advances the enrollment and threading
select public.complete_send(current_setting('test.org_a')::uuid, current_setting('test.s1')::uuid, now() + interval '2 days');
select pg_temp.expect_eq((select (cl.status = 'active' and cl.current_step_order = 1 and cl.thread_message_id = '<ok1@sched.example@msg>'
    and cl.thread_subject = 'Hello ok1@sched.example' and cl.next_send_at > now() + interval '1 day')::int
  from public.campaign_leads cl join public.leads l on l.id = cl.lead_id
  where l.email = 'ok1@sched.example' and cl.campaign_id = current_setting('test.camp')::uuid), 1, 'complete: enrollment advanced with thread ids');
select pg_temp.expect_eq((select (status = 'in_sequence')::int from public.leads where email = 'ok1@sched.example'), 1, 'complete: lead marked in_sequence');
select public.complete_send(current_setting('test.org_a')::uuid, current_setting('test.s1')::uuid, null);
select pg_temp.expect_eq((select (cl.status = 'active')::int from public.campaign_leads cl join public.leads l on l.id = cl.lead_id
  where l.email = 'ok1@sched.example' and cl.campaign_id = current_setting('test.camp')::uuid), 1, 'complete: idempotent (second call no-op)');

-- stop_lead_sequences (reply hook)
update public.sends set status = 'scheduled', claimed_at = null where id = current_setting('test.s3')::uuid;
select pg_temp.expect_eq(public.stop_lead_sequences(current_setting('test.org_a')::uuid,
  (select id from public.leads where email = 'risky@sched.example'), 'replied', 'reply:test'), 1, 'stop: enrollment stopped');
select pg_temp.expect_eq((select (status = 'cancelled')::int from public.sends where id = current_setting('test.s3')::uuid), 1, 'stop: scheduled send cancelled');

-- Clients cannot call the slot functions or flip campaign status directly
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a');
select pg_temp.expect_error(format('select public.reserve_send_slot(%L, %L)', current_setting('test.org_a'), current_setting('test.s2')), '42501', 'slots: not client-callable');
select pg_temp.expect_error(format('update public.campaigns set status = ''active'' where id = %L', current_setting('test.camp')), '42501', 'campaign status not client-writable');
update public.campaigns set daily_limit = 10 where id = current_setting('test.camp')::uuid;
select pg_temp.expect_eq((select daily_limit from public.campaigns where id = current_setting('test.camp')::uuid), 10, 'campaign settings client-writable');
reset role;

-- Phase 6: test email log is server-written only
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a');
select pg_temp.expect_error(
  format($q$insert into public.test_sends (org_id, actor, to_email, subject, status) values (%L, 'user:x', 'a@b.io', 's', 'sent')$q$, current_setting('test.org_a')),
  '42501', 'test_sends not client-writable');
reset role;

-- Phase 7: reply outcomes ------------------------------------------------------
insert into public.leads (org_id, email, status) values
  (current_setting('test.org_a')::uuid, 'r-pos@reply.example', 'in_sequence'),
  (current_setting('test.org_a')::uuid, 'r-neg@reply.example', 'in_sequence'),
  (current_setting('test.org_a')::uuid, 'r-uns@reply.example', 'in_sequence'),
  (current_setting('test.org_a')::uuid, 'r-ooo@reply.example', 'in_sequence');
insert into public.campaign_leads (org_id, campaign_id, lead_id, status, next_send_at)
select l.org_id, current_setting('test.camp')::uuid, l.id, 'active', now() + interval '1 day' from public.leads l where l.email like 'r-%@reply.example';
insert into public.sends (org_id, campaign_id, campaign_lead_id, lead_id, status, message_id, sending_account_id)
select cl.org_id, cl.campaign_id, cl.id, cl.lead_id, 'scheduled', '<' || l.email || '>', current_setting('test.acct')::uuid
  from public.campaign_leads cl join public.leads l on l.id = cl.lead_id where l.email like 'r-%@reply.example';
insert into public.replies (org_id, lead_id, send_id, message_id, from_email, received_at, classification)
select s.org_id, s.lead_id, s.id, '<re-' || l.email || '>', l.email, now(),
       case split_part(split_part(l.email, '@', 1), '-', 2) when 'pos' then 'positive' when 'neg' then 'negative' when 'uns' then 'unsubscribe' else 'out_of_office' end
  from public.sends s join public.leads l on l.id = s.lead_id where l.email like 'r-%@reply.example';

create function pg_temp.reply_id(p_email text) returns uuid language sql as $$
  select r.id from public.replies r join public.leads l on l.id = r.lead_id where l.email = p_email;
$$;
create function pg_temp.enroll_status(p_email text) returns text language sql as $$
  select cl.status from public.campaign_leads cl join public.leads l on l.id = cl.lead_id where l.email = p_email;
$$;
create function pg_temp.stage_of(p_email text) returns text language sql as $$
  select ps.name from public.opportunities o join public.pipeline_stages ps on ps.id = o.stage_id join public.leads l on l.id = o.lead_id where l.email = p_email;
$$;

select pg_temp.expect_eq((public.apply_reply_outcome(current_setting('test.org_a')::uuid, pg_temp.reply_id('r-pos@reply.example')) = 'replied')::int, 1, 'reply: positive → replied');
select pg_temp.expect_eq((pg_temp.enroll_status('r-pos@reply.example') = 'replied'
  and (select status from public.leads where email = 'r-pos@reply.example') = 'replied'
  and (select s.status from public.sends s join public.leads l on l.id = s.lead_id where l.email = 'r-pos@reply.example') = 'cancelled')::int, 1,
  'reply: sequence stopped, lead replied, scheduled send cancelled');
select pg_temp.expect_eq((pg_temp.stage_of('r-pos@reply.example') = 'Replied')::int, 1, 'reply: positive enters pipeline at Replied');

select public.apply_reply_outcome(current_setting('test.org_a')::uuid, pg_temp.reply_id('r-neg@reply.example'));
select pg_temp.expect_eq((pg_temp.stage_of('r-neg@reply.example') = 'Closed Lost' and pg_temp.enroll_status('r-neg@reply.example') = 'replied')::int, 1,
  'reply: negative → stopped + Closed Lost');

select public.apply_reply_outcome(current_setting('test.org_a')::uuid, pg_temp.reply_id('r-uns@reply.example'));
select pg_temp.expect_eq(((select reason from public.suppression_list where email = 'r-uns@reply.example') = 'unsubscribe'
  and pg_temp.enroll_status('r-uns@reply.example') = 'unsubscribed' and pg_temp.stage_of('r-uns@reply.example') is null)::int, 1,
  'reply: unsubscribe → suppressed, stopped, no pipeline card');

select public.apply_reply_outcome(current_setting('test.org_a')::uuid, pg_temp.reply_id('r-ooo@reply.example'), now() + interval '10 days');
select pg_temp.expect_eq((pg_temp.enroll_status('r-ooo@reply.example') = 'active'
  and (select cl.next_send_at > now() + interval '9 days' from public.campaign_leads cl join public.leads l on l.id = cl.lead_id where l.email = 'r-ooo@reply.example')
  and (select s.status from public.sends s join public.leads l on l.id = s.lead_id where l.email = 'r-ooo@reply.example') = 'cancelled'
  and pg_temp.stage_of('r-ooo@reply.example') is null)::int, 1,
  'reply: out-of-office keeps sequence, pushed to return date, scheduled send pulled back');

-- Manual reclassification positive → negative moves the card out of the entry stage.
update public.replies set classification = 'negative' where id = pg_temp.reply_id('r-pos@reply.example');
select public.apply_reply_outcome(current_setting('test.org_a')::uuid, pg_temp.reply_id('r-pos@reply.example'));
select pg_temp.expect_eq((pg_temp.stage_of('r-pos@reply.example') = 'Closed Lost')::int, 1, 'reply: reclassified negative moves card to Closed Lost');
-- and OOO → positive (e.g. they wrote back for real later) stops the sequence
update public.replies set classification = 'positive' where id = pg_temp.reply_id('r-ooo@reply.example');
select public.apply_reply_outcome(current_setting('test.org_a')::uuid, pg_temp.reply_id('r-ooo@reply.example'));
select pg_temp.expect_eq((pg_temp.enroll_status('r-ooo@reply.example') = 'replied' and pg_temp.stage_of('r-ooo@reply.example') = 'Replied')::int, 1,
  'reply: reclassified OOO → positive stops and enters pipeline');

set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a');
select pg_temp.expect_error(format('select public.apply_reply_outcome(%L, %L)', current_setting('test.org_a'), pg_temp.reply_id('r-neg@reply.example')),
  '42501', 'reply: apply_reply_outcome not client-callable');
reset role;

-- Phase 8: pipeline management + notes ------------------------------------------
select set_config('test.stages', (select string_agg(id::text, ',' order by position desc) from public.pipeline_stages where org_id = current_setting('test.org_a')::uuid), true);
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a'); -- owner
select public.reorder_pipeline_stages(current_setting('test.org_a')::uuid, string_to_array(current_setting('test.stages'), ',')::uuid[]);
select pg_temp.expect_eq((select (name = 'Closed Lost')::int from public.pipeline_stages where org_id = current_setting('test.org_a')::uuid and position = 1), 1,
  'pipeline: owner reorders stages atomically');
select pg_temp.expect_error(format('select public.reorder_pipeline_stages(%L, %L::uuid[])', current_setting('test.org_a'), '{}'), 'P0001',
  'pipeline: reorder must include every stage');
select public.set_entry_stage(current_setting('test.org_a')::uuid, (select id from public.pipeline_stages where org_id = current_setting('test.org_a')::uuid and name = 'Interested'));
select pg_temp.expect_eq((select count(*) from public.pipeline_stages where org_id = current_setting('test.org_a')::uuid and is_entry and name = 'Interested'), 1,
  'pipeline: entry stage moved, still exactly one');
select pg_temp.expect_error(format('select public.set_entry_stage(%L, %L)', current_setting('test.org_a'),
  (select id from public.pipeline_stages where org_id = current_setting('test.org_a')::uuid and name = 'Closed Won')), 'P0001', 'pipeline: won/lost stage cannot be the entry');
select pg_temp.expect_error(format('delete from public.pipeline_stages where org_id = %L and is_entry', current_setting('test.org_a')), '23514',
  'pipeline: entry stage cannot be deleted');
select pg_temp.expect_error(format($q$delete from public.pipeline_stages where org_id = %L and name = 'Closed Lost'$q$, current_setting('test.org_a')), '23503',
  'pipeline: stage with cards cannot be deleted');
insert into public.lead_notes (org_id, lead_id, user_id, body)
select org_id, id, '10000000-0000-4000-8000-00000000000a', 'Called, wants a demo' from public.leads where email = 'r-pos@reply.example';
select pg_temp.expect_eq((select count(*) from public.lead_notes), 1, 'notes: owner adds a note');
select pg_temp.expect_error(format($q$insert into public.lead_notes (org_id, lead_id, user_id, body) select org_id, id, %L, 'x' from public.leads where email = 'r-pos@reply.example'$q$,
  '10000000-0000-4000-8000-00000000000d'), '42501', 'notes: cannot write a note as someone else');
reset role;

set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000d'); -- sender
select pg_temp.expect_error(format('select public.reorder_pipeline_stages(%L, %L::uuid[])', current_setting('test.org_a'), '{' || current_setting('test.stages') || '}'), '42501',
  'pipeline: sender cannot reorder stages');
update public.opportunities set stage_id = (select id from public.pipeline_stages where org_id = current_setting('test.org_a')::uuid and name = 'Meeting Booked'), moved_at = now()
 where lead_id = (select id from public.leads where email = 'r-pos@reply.example');
select pg_temp.expect_eq((select count(*) from public.opportunities o join public.pipeline_stages ps on ps.id = o.stage_id where ps.name = 'Meeting Booked'), 1,
  'pipeline: sender moves a card');
select pg_temp.expect_error(format($q$insert into public.opportunities (org_id, lead_id, stage_id, source) select org_id, id, (select id from public.pipeline_stages where org_id = %L limit 1), 'manual' from public.leads where email = 'r-pos@reply.example'$q$,
  current_setting('test.org_a')), '23505', 'pipeline: one card per lead');
reset role;

set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000b'); -- other org
select pg_temp.expect_eq((select count(*) from public.lead_notes), 0, 'notes: other org cannot read');
reset role;

-- Phase 9: tracking events, analytics, A/B winners ------------------------------
insert into public.campaigns (org_id, name, timezone) values (current_setting('test.org_a')::uuid, 'AB campaign', 'UTC');
select set_config('test.ab', (select id::text from public.campaigns where name = 'AB campaign'), true);
insert into public.sequences (org_id, campaign_id) values (current_setting('test.org_a')::uuid, current_setting('test.ab')::uuid);
insert into public.sequence_steps (org_id, sequence_id, step_order, delay_days)
select org_id, id, 1, 0 from public.sequences where campaign_id = current_setting('test.ab')::uuid;
select set_config('test.ab_step', (select st.id::text from public.sequence_steps st join public.sequences sq on sq.id = st.sequence_id where sq.campaign_id = current_setting('test.ab')::uuid), true);
insert into public.email_variants (org_id, step_id, ab_group, subject, body) values
  (current_setting('test.org_a')::uuid, current_setting('test.ab_step')::uuid, 'A', 'A', 'a'),
  (current_setting('test.org_a')::uuid, current_setting('test.ab_step')::uuid, 'B', 'B', 'b'),
  (current_setting('test.org_a')::uuid, current_setting('test.ab_step')::uuid, 'C', 'C', 'c');
update public.email_variants set is_active = false where step_id = current_setting('test.ab_step')::uuid and ab_group = 'C';
insert into public.leads (org_id, email, status)
select current_setting('test.org_a')::uuid, 'ab' || i || '@ab.example', 'in_sequence' from generate_series(1, 7) i;
insert into public.campaign_leads (org_id, campaign_id, lead_id, status)
select l.org_id, current_setting('test.ab')::uuid, l.id, 'active' from public.leads l where l.email like 'ab%@ab.example';
-- ab1-3 + ab7 got variant A, ab4-6 variant B; ab6 bounced at SMTP; ab7 was sent just now.
insert into public.sends (org_id, campaign_id, campaign_lead_id, lead_id, step_id, variant_id, sending_account_id, status, sent_at, message_id)
select cl.org_id, cl.campaign_id, cl.id, cl.lead_id, current_setting('test.ab_step')::uuid,
       (select id from public.email_variants where step_id = current_setting('test.ab_step')::uuid
         and ab_group = case when l.email in ('ab4@ab.example', 'ab5@ab.example', 'ab6@ab.example') then 'B' else 'A' end),
       current_setting('test.acct')::uuid,
       case when l.email = 'ab6@ab.example' then 'bounced' else 'sent' end,
       case when l.email = 'ab7@ab.example' then now() else now() - interval '1 hour' end,
       '<' || l.email || '>'
  from public.campaign_leads cl join public.leads l on l.id = cl.lead_id where l.email like 'ab%@ab.example';
create function pg_temp.ab_send(p_email text) returns uuid language sql as $$
  select s.id from public.sends s join public.leads l on l.id = s.lead_id where l.email = p_email;
$$;

select pg_temp.expect_eq(public.record_tracking_event(pg_temp.ab_send('ab1@ab.example'), 'open', '{"ua":"Mozilla"}')::int, 1, 'tracking: open recorded');
select pg_temp.expect_eq(public.record_tracking_event(pg_temp.ab_send('ab1@ab.example'), 'click', '{"url":"https://x.io"}')::int, 1, 'tracking: click recorded');
select public.record_tracking_event(pg_temp.ab_send('ab2@ab.example'), 'open', '{}', p_scanner => true);
select public.record_tracking_event(pg_temp.ab_send('ab7@ab.example'), 'open', '{}');
select pg_temp.expect_eq((select count(*) from public.events where send_id = pg_temp.ab_send('ab7@ab.example') and (meta ->> 'bot')::boolean), 1,
  'tracking: open within 60 s of sending is flagged as a bot');
select pg_temp.expect_eq(public.record_tracking_event(pg_temp.ab_send('ab6@ab.example'), 'open', '{}')::int, 0, 'tracking: bounced send ignored');
select public.record_tracking_event(pg_temp.ab_send('ab3@ab.example'), 'click', '{}') from generate_series(1, 25);
select pg_temp.expect_eq((select count(*) from public.events where send_id = pg_temp.ab_send('ab3@ab.example')), 20, 'tracking: capped at 20 events per send and type');
select pg_temp.expect_error(format('select public.record_tracking_event(%L, %L)', pg_temp.ab_send('ab1@ab.example'), 'reply'), 'P0001', 'tracking: only open/click');
delete from public.events where send_id = pg_temp.ab_send('ab3@ab.example');
insert into public.events (org_id, send_id, type) values
  (current_setting('test.org_a')::uuid, pg_temp.ab_send('ab3@ab.example'), 'unsubscribe'),
  (current_setting('test.org_a')::uuid, pg_temp.ab_send('ab4@ab.example'), 'reply'),
  (current_setting('test.org_a')::uuid, pg_temp.ab_send('ab5@ab.example'), 'reply'),
  (current_setting('test.org_a')::uuid, pg_temp.ab_send('ab6@ab.example'), 'bounce');
insert into public.replies (org_id, lead_id, send_id, message_id, from_email, received_at, classification)
select s.org_id, s.lead_id, s.id, '<re-' || l.email || '>', l.email, now(), case when l.email = 'ab4@ab.example' then 'positive' else 'negative' end
  from public.sends s join public.leads l on l.id = s.lead_id where l.email in ('ab4@ab.example', 'ab5@ab.example');

set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000c'); -- viewer can read analytics
select pg_temp.expect_eq((select sent * 1000000 + bounced * 100000 + opened * 10000 + clicked * 1000 + replied * 100 + positive * 10 + unsubscribed
    from public.analytics_breakdown(current_setting('test.org_a')::uuid, 'total', 'UTC', 7, current_setting('test.ab')::uuid)),
  7111211, 'analytics: totals (7 sent, 1 bounced, 1 opened, 1 clicked, 2 replied, 1 positive, 1 unsubscribed)');
select pg_temp.expect_eq((select sent * 100 + opened * 10 + replied from public.analytics_breakdown(current_setting('test.org_a')::uuid, 'variant', 'UTC', null, current_setting('test.ab')::uuid) where label = 'Step 1 · A'),
  410, 'analytics: variant A 4 sent, 1 opened, 0 replied');
select pg_temp.expect_eq((select sent * 1000 + bounced * 100 + replied * 10 + positive from public.analytics_breakdown(current_setting('test.org_a')::uuid, 'variant', 'UTC', null, current_setting('test.ab')::uuid) where label = 'Step 1 · B'),
  3121, 'analytics: variant B 3 sent, 1 bounced, 2 replied, 1 positive');
select pg_temp.expect_eq((select count(*) from public.analytics_breakdown(current_setting('test.org_a')::uuid, 'inbox', 'UTC', 7, current_setting('test.ab')::uuid) where label = 'sender@sched.example'),
  1, 'analytics: grouped by inbox');
select pg_temp.expect_eq((select (count(*) * 1000 + sum(sent) * 10 + sum(replied))::bigint from public.analytics_daily(current_setting('test.org_a')::uuid, 'Europe/Berlin', 7, current_setting('test.ab')::uuid)),
  7072, 'analytics: daily series has 7 days, 7 sent, 2 replied');
select pg_temp.expect_error(format('select public.record_tracking_event(%L, %L)', pg_temp.ab_send('ab1@ab.example'), 'open'), '42501', 'tracking: not client-callable');
select pg_temp.expect_error(format('select public.set_variant_winner(%L, %L, %L)', current_setting('test.org_a'), current_setting('test.ab_step'),
  (select id from public.email_variants where step_id = current_setting('test.ab_step')::uuid and ab_group = 'B')), '42501', 'ab: viewer cannot promote a winner');
select pg_temp.login('10000000-0000-4000-8000-00000000000b'); -- other org
select pg_temp.expect_eq((select count(*) from public.analytics_breakdown(current_setting('test.org_a')::uuid, 'total', 'UTC', null)), 0, 'analytics: other org sees nothing');
select pg_temp.expect_eq((select count(*) from public.analytics_daily(current_setting('test.org_a')::uuid, 'UTC', 7) where sent > 0), 0, 'analytics: other org daily is empty');
select pg_temp.expect_error(format('select public.set_variant_winner(%L, %L, null)', current_setting('test.org_a'), current_setting('test.ab_step')), '42501', 'ab: other org cannot change winners');
select pg_temp.login('10000000-0000-4000-8000-00000000000d'); -- sender
select public.set_variant_winner(current_setting('test.org_a')::uuid, current_setting('test.ab_step')::uuid,
  (select id from public.email_variants where step_id = current_setting('test.ab_step')::uuid and ab_group = 'B'), 'B 66.7% vs A 0.0%');
select public.set_variant_winner(current_setting('test.org_a')::uuid, current_setting('test.ab_step')::uuid,
  (select id from public.email_variants where step_id = current_setting('test.ab_step')::uuid and ab_group = 'A'));
select pg_temp.expect_eq((select count(*) from public.email_variants where step_id = current_setting('test.ab_step')::uuid and is_winner and ab_group = 'A'), 1,
  'ab: sender promotes a winner; only one per step');
select pg_temp.expect_error(format('select public.set_variant_winner(%L, %L, %L)', current_setting('test.org_a'), current_setting('test.ab_step'),
  (select id from public.email_variants where step_id = current_setting('test.ab_step')::uuid and ab_group = 'C')), 'P0002', 'ab: inactive variant cannot win');
select pg_temp.expect_error(format('update public.email_variants set is_winner = true where step_id = %L', current_setting('test.ab_step')), '42501',
  'ab: is_winner only changes through the audited RPC');
update public.email_variants set subject = 'A2' where step_id = current_setting('test.ab_step')::uuid and ab_group = 'A';
select pg_temp.expect_eq((select count(*) from public.email_variants where subject = 'A2'), 1, 'ab: variant copy still editable');
select public.set_variant_winner(current_setting('test.org_a')::uuid, current_setting('test.ab_step')::uuid, null);
select pg_temp.expect_eq((select count(*) from public.email_variants where step_id = current_setting('test.ab_step')::uuid and is_winner), 0, 'ab: winner cleared');
reset role;
select pg_temp.expect_eq((select count(*) from public.agent_audit_log where action like 'ab.%' and target = 'campaign:' || current_setting('test.ab')
    and actor = 'user:10000000-0000-4000-8000-00000000000d'), 3, 'ab: every winner change is audited');

-- Phase 10: warmup pool -------------------------------------------------------------
update public.organizations set sending_paused = false where id = current_setting('test.org_a')::uuid;
insert into public.sending_accounts (org_id, email, provider, smtp_host, smtp_port, imap_host, imap_port, username, daily_cap) values
  (current_setting('test.org_a')::uuid, 'w1@warm.example', 'smtp', 'h', 465, 'h', 993, 'u', 3),
  (current_setting('test.org_a')::uuid, 'w2@warm.example', 'smtp', 'h', 465, 'h', 993, 'u', 30);
select set_config('test.w1', (select id::text from public.sending_accounts where email = 'w1@warm.example'), true);
select set_config('test.w2', (select id::text from public.sending_accounts where email = 'w2@warm.example'), true);

set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000a'); -- owner
update public.sending_accounts set warmup_enabled = true, warmup_daily_target = 30, warmup_reply_rate = 40 where email in ('w1@warm.example', 'w2@warm.example');
select pg_temp.expect_eq((select count(*) from public.sending_accounts where email like 'w_@warm.example' and warmup_enabled and warmup_started_at is not null
  and warmup_daily_target = 30), 2, 'warmup: owner turns warmup on; the ramp starts');
select pg_temp.expect_error($q$update public.sending_accounts set warmup_daily_target = 51 where email = 'w1@warm.example'$q$, '23514', 'warmup: target capped at 50');
select pg_temp.expect_error($q$update public.sending_accounts set warmup_paused_reason = null where email = 'w1@warm.example'$q$, '42501', 'warmup: pause reason is server-controlled');
select pg_temp.expect_error(format($q$insert into public.warmup_messages (org_id, from_account_id, to_account_id, message_id, subject, body_text) values (%L, %L, %L, '<x@w>', 's', 'b')$q$,
  current_setting('test.org_a'), current_setting('test.w1'), current_setting('test.w2')), '42501', 'warmup: clients cannot queue warmup mail');
select pg_temp.expect_error(format('select public.reserve_warmup_slot(%L)', gen_random_uuid()), '42501', 'warmup: slot functions are server-only');
select pg_temp.login('10000000-0000-4000-8000-00000000000c'); -- viewer
update public.sending_accounts set warmup_enabled = false where email = 'w1@warm.example';
select pg_temp.expect_eq((select count(*) from public.sending_accounts where email = 'w1@warm.example' and warmup_enabled), 1, 'warmup: viewer cannot toggle warmup');
reset role;

insert into public.warmup_messages (org_id, from_account_id, to_account_id, message_id, subject, body_text)
select current_setting('test.org_a')::uuid, current_setting('test.w1')::uuid, current_setting('test.w2')::uuid, '<warm-' || i || '@warm.example>', 'Checking in', 'Hi'
  from generate_series(1, 5) i;
create function pg_temp.wm(p_i int) returns uuid language sql as $$ select id from public.warmup_messages where message_id = '<warm-' || p_i || '@warm.example>' $$;

select pg_temp.expect_eq((public.reserve_warmup_slot(pg_temp.wm(1)) ->> 'ok')::boolean::int, 1, 'warmup slot: reserved');
select pg_temp.expect_eq((select sent_today from public.sending_accounts where id = current_setting('test.w1')::uuid), 1, 'warmup slot: counts toward the daily cap');
select pg_temp.expect_eq((public.reserve_warmup_slot(pg_temp.wm(2)) ->> 'reason' = 'pacing')::int, 1, 'warmup slot: shares the pacing gap');
update public.sending_accounts set next_available_at = null where id = current_setting('test.w1')::uuid;
update public.organizations set sending_paused = true where id = current_setting('test.org_a')::uuid;
select pg_temp.expect_eq((public.reserve_warmup_slot(pg_temp.wm(2), 0, 0) ->> 'reason' = 'kill_switch')::int, 1, 'warmup slot: kill switch stops warmup too');
update public.organizations set sending_paused = false where id = current_setting('test.org_a')::uuid;
update public.sending_accounts set warmup_paused_reason = 'spam' where id = current_setting('test.w1')::uuid;
select pg_temp.expect_eq((public.reserve_warmup_slot(pg_temp.wm(2), 0, 0) ->> 'reason' = 'warmup_off')::int, 1, 'warmup slot: auto-paused inbox sends nothing new');
update public.warmup_messages set is_reply = true where id = pg_temp.wm(2);
select pg_temp.expect_eq((public.reserve_warmup_slot(pg_temp.wm(2), 0, 0) ->> 'ok')::boolean::int, 1, 'warmup slot: replies still go out');
update public.sending_accounts set warmup_paused_reason = null, next_available_at = null where id = current_setting('test.w1')::uuid;
select pg_temp.expect_eq((public.reserve_warmup_slot(pg_temp.wm(3), 0, 0) ->> 'ok')::boolean::int, 1, 'warmup slot: third of three');
update public.sending_accounts set next_available_at = null where id = current_setting('test.w1')::uuid;
select pg_temp.expect_eq((public.reserve_warmup_slot(pg_temp.wm(4), 0, 0) ->> 'reason' = 'inbox_daily_cap')::int, 1, 'warmup slot: daily cap enforced');

select public.finish_warmup_send(pg_temp.wm(1), 'sent');
select public.finish_warmup_send(pg_temp.wm(3), 'failed', 'network');
select pg_temp.expect_eq((select (status = 'sent' and sent_at is not null)::int from public.warmup_messages where id = pg_temp.wm(1))
  + (select count(*) from public.warmup_events where type = 'sent' and account_id = current_setting('test.w1')::uuid), 2, 'warmup: sent recorded once');
select pg_temp.expect_eq((select sent_today from public.sending_accounts where id = current_setting('test.w1')::uuid), 2, 'warmup: failed send gives its slot back');
select public.finish_warmup_send(pg_temp.wm(1), 'failed');
select pg_temp.expect_eq((select (status = 'sent')::int from public.warmup_messages where id = pg_temp.wm(1)), 1, 'warmup: finish is idempotent');

select pg_temp.expect_eq(((public.record_warmup_received(current_setting('test.w2')::uuid, '<warm-1@warm.example>', true)) ->> 'first')::boolean::int, 1, 'received: first sighting');
select pg_temp.expect_eq(((public.record_warmup_received(current_setting('test.w2')::uuid, '<warm-1@warm.example>', false)) ->> 'first')::boolean::int, 0, 'received: idempotent after the move to INBOX');
select pg_temp.expect_eq((public.record_warmup_received(current_setting('test.w1')::uuid, '<warm-1@warm.example>', false) is null)::int, 1, 'received: only for the addressed inbox');
select pg_temp.expect_eq((select count(*) from public.warmup_events where account_id = current_setting('test.w2')::uuid and type in ('received', 'rescued_from_spam')), 2,
  'received: received + rescued_from_spam events');

set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000c'); -- viewer reads stats
select pg_temp.expect_eq((select sent * 100 + received * 10 + spam from public.warmup_stats(current_setting('test.org_a')::uuid) where account_id = current_setting('test.w1')::uuid),
  111, 'stats: w1 sent 1, received 1, in spam 1');
select pg_temp.expect_eq((select count(*) from public.warmup_messages), 5, 'warmup: members read warmup mail');
select pg_temp.expect_eq((select sum(spam)::bigint from public.warmup_daily(current_setting('test.org_a')::uuid, 'UTC', 14)), 1, 'daily: spam placement per day');
select pg_temp.login('10000000-0000-4000-8000-00000000000b'); -- other org
select pg_temp.expect_eq((select count(*) from public.warmup_stats(current_setting('test.org_a')::uuid)), 0, 'stats: other org sees nothing');
select pg_temp.expect_eq((select count(*) from public.warmup_messages), 0, 'warmup: other org cannot read warmup mail');
reset role;

-- Re-enabling after an auto-pause clears it and restarts the ramp.
update public.sending_accounts set warmup_paused_reason = '25% spam', warmup_started_at = now() - interval '10 days' where id = current_setting('test.w1')::uuid;
update public.sending_accounts set warmup_enabled = true where id = current_setting('test.w1')::uuid;
select pg_temp.expect_eq((select (warmup_paused_reason is null and warmup_started_at > now() - interval '1 minute')::int from public.sending_accounts where id = current_setting('test.w1')::uuid), 1,
  'toggle: re-enabling after an auto-pause restarts the ramp');
update public.sending_accounts set warmup_started_at = now() - interval '10 days' where id = current_setting('test.w1')::uuid;
update public.sending_accounts set warmup_enabled = false where id = current_setting('test.w1')::uuid;
update public.sending_accounts set warmup_enabled = true where id = current_setting('test.w1')::uuid;
select pg_temp.expect_eq((select (warmup_started_at < now() - interval '9 days')::int from public.sending_accounts where id = current_setting('test.w1')::uuid), 1,
  'toggle: a short off/on keeps the ramp');

-- Phase 12: CRM connections ---------------------------------------------------------
insert into public.crm_connections (org_id, provider, account_label) values (current_setting('test.org_a')::uuid, 'hubspot', 'portal 123');
insert into public.crm_credentials (connection_id, org_id, ciphertext)
select id, org_id, 'v1:secret' from public.crm_connections where org_id = current_setting('test.org_a')::uuid;
insert into public.crm_links (org_id, connection_id, object, local_id, external_id)
select org_id, id, 'contact', gen_random_uuid(), '901' from public.crm_connections where org_id = current_setting('test.org_a')::uuid;
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000c'); -- viewer in A
select pg_temp.expect_eq((select count(*) from public.crm_connections), 1, 'crm: members see the connection');
select pg_temp.expect_eq((select count(*) from public.crm_links), 1, 'crm: members see links');
select pg_temp.expect_error('select * from public.crm_credentials', '42501', 'crm: tokens are service-role only');
select pg_temp.login('10000000-0000-4000-8000-00000000000a'); -- owner
select pg_temp.expect_error('select * from public.crm_credentials', '42501', 'crm: even owners cannot read tokens');
select pg_temp.expect_error($q$update public.crm_connections set stage_map = '{}'$q$, '42501', 'crm: connection changes go through the server');
select pg_temp.expect_error(format($q$insert into public.crm_connections (org_id, provider) values (%L, 'hubspot')$q$, current_setting('test.org_a')), '42501', 'crm: clients cannot create connections');
select pg_temp.login('10000000-0000-4000-8000-00000000000b'); -- other org
select pg_temp.expect_eq((select count(*) from public.crm_connections) + (select count(*) from public.crm_links), 0, 'crm: other org sees nothing');
reset role;
select pg_temp.expect_eq((select count(*) from public.opportunities where updated_at is null), 0, 'crm: opportunities carry updated_at');

-- Bob (owner B) cannot see A's audit log or campaigns.
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000b');
select pg_temp.expect_eq((select count(*) from public.agent_audit_log), 0, 'other org cannot read audit log');
select pg_temp.expect_eq((select count(*) from public.campaigns), 0, 'other org cannot read campaigns');
reset role;

rollback;
