-- =============================================================================
-- Local development seed. Loaded by `supabase db reset`.
-- Login: dev@example.com / password123
-- =============================================================================

-- Fixed IDs so links and tests are stable.
do $$
declare
  v_user uuid := '00000000-0000-4000-8000-000000000001';
  v_org  uuid := '00000000-0000-4000-8000-0000000000a1';
  v_campaign uuid := '00000000-0000-4000-8000-0000000000c1';
  v_sequence uuid;
  v_step1 uuid;
  v_step2 uuid;
begin
  -- Auth user (+ identity, required by GoTrue for email/password sign-in).
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'dev@example.com', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Dev User"}', now(), now(),
    '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    v_user, v_user, v_user::text,
    jsonb_build_object('sub', v_user::text, 'email', 'dev@example.com', 'email_verified', true),
    'email', now(), now(), now()
  ) on conflict do nothing;

  -- Organization + owner membership + default pipeline.
  insert into public.organizations (id, name, physical_address, default_timezone)
  values (v_org, 'Acme Outreach', '123 Example St, Springfield, USA', 'America/New_York')
  on conflict (id) do nothing;

  insert into public.memberships (org_id, user_id, role)
  values (v_org, v_user, 'owner')
  on conflict (org_id, user_id) do nothing;

  perform private.seed_org_defaults(v_org);

  -- Leads
  insert into public.leads (org_id, email, first_name, last_name, company, title, verification_status, custom_json) values
    (v_org, 'ada@analytical.example',   'Ada',    'Lovelace', 'Analytical Engines', 'CTO',            'valid',      '{"city":"London"}'),
    (v_org, 'grace@cobol.example',      'Grace',  'Hopper',   'COBOL Corp',         'VP Engineering', 'valid',      '{}'),
    (v_org, 'alan@enigma.example',      'Alan',   'Turing',   'Bletchley Labs',     'Head of R&D',    'risky',      '{}'),
    (v_org, 'linus@kernel.example',     'Linus',  'Torvalds', 'Kernel Co',          'Founder',        'unverified', '{}'),
    (v_org, 'bounced@nowhere.example',  'Bo',     'Unce',     'Nowhere Inc',        'CEO',            'invalid',    '{}')
  on conflict (org_id, email) do nothing;

  insert into public.suppression_list (org_id, email, reason, source)
  values (v_org, 'optout@example.com', 'unsubscribe', 'seed')
  on conflict (org_id, email) do nothing;

  -- Draft campaign with a 2-step sequence and an A/B test on step 1.
  insert into public.campaigns (id, org_id, name, timezone, created_by)
  values (v_campaign, v_org, 'Q4 CTO outreach', 'America/New_York', v_user)
  on conflict (id) do nothing;

  insert into public.sequences (org_id, campaign_id) values (v_org, v_campaign)
  on conflict (campaign_id) do nothing;
  select id into v_sequence from public.sequences where campaign_id = v_campaign;

  if not exists (select 1 from public.sequence_steps where sequence_id = v_sequence) then
    insert into public.sequence_steps (org_id, sequence_id, step_order, delay_days)
    values (v_org, v_sequence, 1, 0) returning id into v_step1;
    insert into public.sequence_steps (org_id, sequence_id, step_order, delay_days)
    values (v_org, v_sequence, 2, 3) returning id into v_step2;

    insert into public.email_variants (org_id, step_id, ab_group, subject, body, weight) values
      (v_org, v_step1, 'A', 'Quick question, {{first_name}}',
       E'Hi {{first_name}},\n\nNoticed {{company}} is hiring engineers. Worth a chat?\n\n{{sender_name}}', 50),
      (v_org, v_step1, 'B', '{{company}} + us?',
       E'Hey {{first_name}} — short one: would a 15-min call next week make sense?\n\n{{sender_name}}', 50),
      (v_org, v_step2, 'A', 'Re: Quick question, {{first_name}}',
       E'Bumping this in case it got buried. Any interest?\n\n{{sender_name}}', 100);
  end if;
end;
$$;
