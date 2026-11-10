-- =============================================================================
-- 0019 Welcome flow v2: what a customer is worth, the monthly goal, and how
-- the business finds customers today. Feeds the "Your plan" screen and the
-- Dashboard goal tracker.
-- =============================================================================

alter table public.organizations
  add column goal_customer_value      integer check (goal_customer_value between 1 and 10000000),
  add column goal_customers_per_month integer check (goal_customers_per_month between 1 and 1000),
  add column acquisition_channels     text[] not null default '{}'
    check (acquisition_channels <@ array['referrals', 'manual_email', 'ads', 'social', 'cold_calling', 'not_much']::text[]);

grant update (goal_customer_value, goal_customers_per_month, acquisition_channels) on public.organizations to authenticated;

notify pgrst, 'reload schema';
