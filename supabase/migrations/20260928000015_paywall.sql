-- =============================================================================
-- 0015 Paywall: a paid flag per user. Only the service role (admin script)
-- can change it; users can read their own row but never write this column.
-- =============================================================================

alter table public.users add column is_paid boolean not null default false;

-- Clients may still only update full_name (column grant from 0003); is_paid is not writable.
