-- =============================================================================
-- Demo data for looking at the app with realistic content (local development
-- only). Adds inboxes, replies of every type and pipeline cards to the seeded
-- workspace, on top of `supabase db reset`.
--
--   pnpm db:reset && pnpm db:demo
--
-- Login: dev@example.com / password123. Safe to run twice: it clears its own rows first.
-- =============================================================================
do $$
declare
  o uuid := '00000000-0000-4000-8000-0000000000a1';
  s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  r record;
begin
  delete from public.replies where org_id = o and message_id like '<demo-%';
  delete from public.opportunities where org_id = o and lead_id in (select id from public.leads where org_id = o and email like '%@demo.example');
  delete from public.leads where org_id = o and email like '%@demo.example';
  delete from public.sending_accounts where org_id = o and email like '%@acme-outreach.example';

  insert into public.sending_accounts (org_id, email, display_name, provider, smtp_host, smtp_port, imap_host, imap_port, username, daily_cap, sent_today, sent_today_date, health, health_detail, last_checked_at)
  values
    (o, 'hello@acme-outreach.example', 'Jo at Acme', 'google', 'smtp.gmail.com', 465, 'imap.gmail.com', 993, 'hello@acme-outreach.example', 50, 18, current_date, 'healthy', null, now() - interval '12 minutes'),
    (o, 'jo@acme-outreach.example', 'Jo Smith', 'smtp', 'mail.example.com', 465, 'mail.example.com', 993, 'jo@acme-outreach.example', 30, 30, current_date, 'degraded', 'Couldn''t sign in to receive replies. Check the app password.', now() - interval '3 hours');

  select id into s1 from public.pipeline_stages where org_id = o and position = 1;
  select id into s2 from public.pipeline_stages where org_id = o and position = 2;
  select id into s3 from public.pipeline_stages where org_id = o and position = 3;
  select id into s4 from public.pipeline_stages where org_id = o and kind = 'won' order by position limit 1;

  for r in
    select * from (values
      ('priya.shah@demo.example',   'Priya',  'Shah',     'Northwind Dental',   'Practice Manager', 'positive',      'ai',        interval '25 minutes', 'ready', false, 'Hi Jo, this is timely. We are redoing our website this quarter. Could you send pricing and a couple of examples?', 2),
      ('tom.baker@demo.example',    'Tom',    'Baker',    'Baker & Sons Roofing','Owner',           'neutral',       'heuristic', interval '4 hours',    null,    false, 'Who else in our trade have you worked with? Happy to chat if it is relevant.', 1),
      ('mei.lin@demo.example',      'Mei',    'Lin',      'Harbour Physio',     'Director',         'positive',      'ai',        interval '1 day',      null,    true,  'Yes, interested. I have booked a slot with you for Thursday.', 3),
      ('sam.okafor@demo.example',   'Sam',    'Okafor',   'Okafor Accounting',  'Partner',          'negative',      'heuristic', interval '2 days',     null,    true,  'Not for us right now, thanks.', 0),
      ('lena.novak@demo.example',   'Lena',   'Novak',    'Novak Interiors',    'Founder',          'out_of_office', 'heuristic', interval '3 days',     null,    false, 'I am out of the office until Monday with limited access to email.', 0),
      ('raj.patel@demo.example',    'Raj',    'Patel',    'Patel Motors',       'General Manager',  'unsubscribe',   'heuristic', interval '5 days',     null,    true,  'Please remove me from your list.', 0),
      ('ella.jones@demo.example',   'Ella',   'Jones',    'Jones Veterinary',   'Practice Owner',   'positive',      'manual',    interval '9 days',     null,    true,  'We went ahead with you last week and are very happy. Thank you!', 4),
      ('omar.haddad@demo.example',  'Omar',   'Haddad',   'Haddad Legal',       'Solicitor',        'neutral',       'ai',        interval '11 days',    null,    true,  'Can you resend this in the new year? Budgets reset in January.', 1)
    ) as t(email, first_name, last_name, company, title, cls, src, ago, draft, handled, body, stage)
  loop
    with l as (
      insert into public.leads (org_id, email, first_name, last_name, company, title, status, verification_status)
      values (o, r.email, r.first_name, r.last_name, r.company, r.title, 'replied', 'valid')
      returning id
    ), rep as (
      insert into public.replies (org_id, message_id, from_email, received_at, subject, body_text, classification, classification_source, lead_id, draft_status, handled_at)
      select o, '<demo-' || r.email || '>', r.email, now() - r.ago, 'Re: Quick question, ' || r.first_name, r.body, r.cls, r.src, l.id,
             r.draft,
             case when r.handled then now() - r.ago + interval '30 minutes' end
      from l
    )
    insert into public.opportunities (org_id, lead_id, stage_id, source, moved_at)
    select o, l.id, case r.stage when 1 then s1 when 2 then s2 when 3 then s3 else s4 end, 'reply', now() - r.ago
    from l where r.stage > 0;
  end loop;
end $$;
