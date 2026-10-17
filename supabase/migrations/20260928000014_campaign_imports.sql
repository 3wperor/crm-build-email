-- =============================================================================
-- 0014 Import straight into a campaign, and explain enrollment skips.
-- =============================================================================

-- An import can target a campaign: its leads are enrolled once verification
-- finishes (or right away when auto-verify is off). The outcome is kept for the UI.
alter table public.imports
  add column campaign_id uuid,
  add column campaign_result jsonb,
  add constraint imports_campaign_fk foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete set null (campaign_id);
grant insert (campaign_id) on public.imports to authenticated;

-- -----------------------------------------------------------------------------
-- enroll_leads: same rules as before, now also returns why leads were skipped:
-- { candidates, enrolled, skipped, reasons: { already_in_campaign, suppressed,
--   lead_status, invalid, verifying, risky, in_other_campaign } }
-- -----------------------------------------------------------------------------
create or replace function public.enroll_leads(
  p_campaign_id  uuid,
  p_lead_ids     uuid[] default null,
  p_list_id      uuid default null,
  p_all_eligible boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_candidates integer;
  v_enrolled integer;
  v_reasons jsonb;
begin
  select * into v_campaign from public.campaigns where id = p_campaign_id;
  if not found then raise exception 'campaign not found' using errcode = 'no_data_found'; end if;
  if v_campaign.status in ('completed', 'archived') then raise exception 'campaign is %', v_campaign.status; end if;
  if (p_lead_ids is not null)::int + (p_list_id is not null)::int + p_all_eligible::int <> 1 then
    raise exception 'specify exactly one of p_lead_ids, p_list_id, p_all_eligible';
  end if;

  with classified as (
    select l.id,
           case
             when exists (select 1 from public.campaign_leads cl where cl.campaign_id = p_campaign_id and cl.lead_id = l.id) then 'already_in_campaign'
             when exists (select 1 from public.suppression_list s where s.org_id = v_campaign.org_id and s.email = l.email) then 'suppressed'
             when l.status not in ('new', 'in_sequence') then 'lead_status'
             when l.verification_status = 'invalid' then 'invalid'
             when l.verification_status = 'pending' then 'verifying'
             when not v_campaign.include_risky and l.verification_status = 'risky' then 'risky'
             when exists (
               select 1 from public.campaign_leads other
                where other.lead_id = l.id and other.campaign_id <> p_campaign_id and other.status in ('queued', 'active', 'paused')
             ) then 'in_other_campaign'
           end as reason
      from public.leads l
     where l.org_id = v_campaign.org_id
       and (
         (p_lead_ids is not null and l.id = any (p_lead_ids))
         or (p_list_id is not null and exists (select 1 from public.lead_list_members m where m.list_id = p_list_id and m.lead_id = l.id))
         or p_all_eligible
       )
  ),
  ins as (
    insert into public.campaign_leads (org_id, campaign_id, lead_id, status, next_send_at)
    select v_campaign.org_id, p_campaign_id, c.id, 'queued', case when v_campaign.status = 'active' then now() else null end
      from classified c
     where c.reason is null
    on conflict (campaign_id, lead_id) do nothing
    returning 1
  )
  select (select count(*) from classified),
         (select count(*) from ins),
         (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb)
            from (select reason, count(*) as n from classified where reason is not null group by reason) r)
    into v_candidates, v_enrolled, v_reasons;

  return jsonb_build_object('candidates', v_candidates, 'enrolled', v_enrolled, 'skipped', v_candidates - v_enrolled, 'reasons', v_reasons);
end;
$$;
