-- =============================================================================
-- 0008 Reply sync: IMAP cursors, classification settings, reply outcomes.
-- =============================================================================

-- Per-mailbox UID cursors: { "INBOX": {"uidValidity": 1, "lastUid": 42}, "[Gmail]/Spam": {...} }
alter table public.sending_accounts
  add column imap_cursors jsonb not null default '{}'::jsonb,
  add column imap_last_error text;

-- Optional AI classification for replies the rules can't settle (off by default).
alter table public.organizations add column ai_classification_enabled boolean not null default false;
grant update (ai_classification_enabled) on public.organizations to authenticated;

alter table public.replies
  add column mailbox text,
  add column ooo_until timestamptz,
  add column classification_reason text,
  add column outcome text;   -- what the system did: replied | suppressed | ooo_delayed | unmatched

create index replies_org_classification_idx on public.replies (org_id, classification, received_at desc);

-- -----------------------------------------------------------------------------
-- apply_reply_outcome: act on a (re)classified reply. Idempotent; safe to call
-- again after a manual reclassification.
--   out_of_office → keep the sequence, but push the lead's next send to the
--                   return date (or +3 days) and pull back anything scheduled
--   unsubscribe   → suppress + stop every sequence (no pipeline card)
--   anything else → stop every sequence (stop_on_reply), mark lead replied,
--                   add to the pipeline: negative → the org's "lost" stage,
--                   otherwise the entry stage ("Replied")
-- -----------------------------------------------------------------------------
create or replace function public.apply_reply_outcome(
  p_org_id    uuid,
  p_reply_id  uuid,
  p_ooo_until timestamptz default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reply public.replies;
  v_email text;
  v_campaign uuid;
  v_stop boolean;
  v_stage uuid;
  v_outcome text;
begin
  select * into v_reply from public.replies where org_id = p_org_id and id = p_reply_id;
  if not found then raise exception 'reply not found'; end if;
  if v_reply.lead_id is null then
    update public.replies set outcome = 'unmatched' where id = p_reply_id;
    return 'unmatched';
  end if;

  select email into v_email from public.leads where id = v_reply.lead_id;
  select s.campaign_id, coalesce(sq.stop_on_reply, true)
    into v_campaign, v_stop
    from public.sends s left join public.sequences sq on sq.campaign_id = s.campaign_id
   where s.id = v_reply.send_id;
  v_stop := coalesce(v_stop, true);

  if v_reply.classification = 'out_of_office' then
    update public.sends
       set status = 'cancelled', error = 'out_of_office'
     where org_id = p_org_id and lead_id = v_reply.lead_id and status in ('pending_approval', 'scheduled');
    update public.campaign_leads
       set next_send_at = greatest(coalesce(next_send_at, now()), coalesce(p_ooo_until, now() + interval '3 days'))
     where org_id = p_org_id and lead_id = v_reply.lead_id and status in ('queued', 'active');
    v_outcome := 'ooo_delayed';

  elsif v_reply.classification = 'unsubscribe' then
    insert into public.suppression_list (org_id, email, reason, source)
    values (p_org_id, v_email, 'unsubscribe', 'reply:' || p_reply_id)
    on conflict (org_id, email) do nothing;
    perform public.stop_lead_sequences(p_org_id, v_reply.lead_id, 'unsubscribed', 'reply_unsubscribe');
    v_outcome := 'suppressed';

  else
    if v_stop then
      perform public.stop_lead_sequences(p_org_id, v_reply.lead_id, 'replied', 'reply');
    end if;
    update public.leads set status = 'replied'
     where id = v_reply.lead_id and status not in ('unsubscribed', 'bounced', 'do_not_contact');

    select id into v_stage from public.pipeline_stages
     where org_id = p_org_id
       and (case when v_reply.classification = 'negative' then kind = 'lost' else is_entry end)
     order by position limit 1;
    if v_stage is null then
      select id into v_stage from public.pipeline_stages where org_id = p_org_id order by position limit 1;
    end if;

    if v_stage is not null then
      insert into public.opportunities (org_id, lead_id, stage_id, campaign_id, source)
      values (p_org_id, v_reply.lead_id, v_stage, v_campaign, 'reply')
      on conflict (org_id, lead_id) do nothing;
      -- A negative reclassification moves a card that is still sitting in the entry stage.
      if v_reply.classification = 'negative' then
        update public.opportunities o
           set stage_id = v_stage, moved_at = now()
          from public.pipeline_stages ps
         where o.org_id = p_org_id and o.lead_id = v_reply.lead_id
           and ps.id = o.stage_id and ps.is_entry;
      end if;
    end if;
    v_outcome := 'replied';
  end if;

  update public.replies set outcome = v_outcome, ooo_until = coalesce(p_ooo_until, ooo_until) where id = p_reply_id;
  return v_outcome;
end;
$$;

revoke execute on function public.apply_reply_outcome(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_reply_outcome(uuid, uuid, timestamptz) to service_role;
