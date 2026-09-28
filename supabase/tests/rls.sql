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

-- Bob (owner B) cannot see A's audit log or campaigns.
set local role authenticated;
select pg_temp.login('10000000-0000-4000-8000-00000000000b');
select pg_temp.expect_eq((select count(*) from public.agent_audit_log), 0, 'other org cannot read audit log');
select pg_temp.expect_eq((select count(*) from public.campaigns), 0, 'other org cannot read campaigns');
reset role;

rollback;
