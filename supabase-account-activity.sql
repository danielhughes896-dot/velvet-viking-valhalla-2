-- ===========================================================================
-- LAST ACTIVE -- the one operational signal the model was missing.
--
-- WHY IT IS NEEDED. Everything else a metrics board wants already exists:
-- account creation, trial consumption, grant expiry, subscription condition,
-- billing events. What could not be answered was "is this athlete still using
-- it", which is the difference between a subscriber and a churn risk.
--
-- WHY IT IS A COLUMN AND NOT A TABLE. An events table would be an analytics
-- product: rows per open, retention policy, growth to reason about, and
-- personal movement data we have no business keeping. One nullable timestamp
-- per account answers the operational question and forgets everything else.
-- That is data minimisation as a schema decision rather than a policy note.
--
-- WHY IT LIVES ON account_commercial. It is operational state about an
-- account, alongside the trial allowance, and it inherits the same ownership,
-- the same RLS and the same cascade on delete. A separate table would need all
-- three restated and could fall out of step with them.
--
-- WHAT IT IS NOT. Not a login log, not a session history, not a location, not
-- a device record. It is overwritten, so it cannot become one by accretion.
--
-- Safe to re-run.
-- ===========================================================================

alter table public.account_commercial
  add column if not exists last_active_at timestamptz;

comment on column public.account_commercial.last_active_at is
  'Coarse operational signal: when this account last opened Valhalla. '
  'Overwritten, never appended, so it cannot accumulate into a movement log.';

-- Partial: the interesting query is always "who has been active", and a null
-- has nothing to sort by.
create index if not exists account_commercial_last_active_idx
  on public.account_commercial (last_active_at)
  where last_active_at is not null;


-- ---------------------------------------------------------------------------
-- THE TOUCH
--
-- Called by the server when it mints a delivery lease -- the moment an athlete
-- actually opens the product, which is the event worth recording.
--
-- COARSE ON PURPOSE. It refuses to write again inside the same hour. The
-- operational question is "this week or last month", so per-open precision buys
-- nothing and costs a write on every request. It also means the column cannot
-- be used to reconstruct a session-by-session timeline, which is the failure
-- mode of recording activity too precisely.
-- ---------------------------------------------------------------------------
create or replace function public.touch_last_active(p_account_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_now timestamptz := now(); v_out timestamptz;
begin
  if p_account_id is null then return null; end if;

  update public.account_commercial
     set last_active_at = v_now
   where account_id = p_account_id
     and (last_active_at is null or last_active_at < v_now - interval '1 hour')
  returning last_active_at into v_out;

  if v_out is null then
    select last_active_at into v_out
      from public.account_commercial where account_id = p_account_id;
  end if;
  return v_out;
end;
$$;

revoke all on function public.touch_last_active(uuid) from public, anon, authenticated;
grant execute on function public.touch_last_active(uuid) to postgres, service_role;


-- ---------------------------------------------------------------------------
-- THE OPERATIONAL VIEW
--
-- One place that answers what a metrics board asks, derived rather than stored,
-- so it cannot disagree with the tables it reads. No email, no name, no
-- training data -- an account reference and its commercial state.
--
-- WHERE THE TRIAL COMES FROM. The subscriptions table, not entitlement_grants.
-- This view once read a grant with source = 'trial', which was correct while
-- the trial was card-free and had no provider behind it. HQ replaced that with
-- a trial that takes a payment method upfront and converts automatically, so
-- the trial IS a provider subscription in condition 'trialing' and the
-- standalone grant source is gone. A view still looking for the grant would
-- report every genuine trial as inactive -- not a stale label but a wrong
-- number, on the one board that decides whether the product is working.
--
-- IT MIRRORS THE RESOLVER, DELIBERATELY. api/_entitlement.js grants a trialing
-- subscription until trial_end, falling back to current_period_end for
-- providers that express a trial as the first period. The same coalesce is
-- written here so the board and the access decision cannot disagree. The two
-- checks the resolver also makes -- a known provider, and product_code being
-- the standard product -- are CHECK constraints on the table, so repeating
-- them here would test the database against itself.
--
-- ADMIN GRANTS STAY WHERE THEY ARE. admin_beta and admin_comp are still
-- entitlement_grants: they are the two remaining sources, they have no
-- provider, and nothing about the trial change touches them.
--
-- SECURITY INVOKER (the default for a view): it is read with the service key by
-- the server and is not exposed to anon or authenticated.
-- ---------------------------------------------------------------------------
create or replace view public.account_operational_state as
select
  ac.account_id,
  ac.created_at                                            as account_created_at,
  ac.last_active_at,
  ac.trial_consumed_at,
  ac.trial_blocked_at,
  /* When the introductory period ends, or ended. max() ignores nulls, so a
     converted subscription still reports the day its trial finished -- which is
     the day it started earning -- and an account that never trialled reports
     nothing rather than a zero date. Revoked rows are excluded because the
     resolver says revocation outranks every timestamp on the row: a refunded
     purchase whose trial_end is next week has no trial ending next week, and
     reporting one would put a phantom renewal on the board. */
  (select max(coalesce(s.trial_end,
                       case when s.condition = 'trialing'
                            then s.current_period_end end))
     from public.subscriptions s
    where s.account_id = ac.account_id
      and s.condition <> 'revoked')                        as trial_ends_at,
  /* EXISTS across every subscription, because the resolver grants if ANY
     source grants. 'trialing' is a single value, so a revoked or expired row
     cannot satisfy this however its dates read. */
  exists (select 1 from public.subscriptions s
           where s.account_id = ac.account_id
             and s.condition = 'trialing'
             and coalesce(s.trial_end, s.current_period_end) > now())  as trial_active,
  exists (select 1 from public.entitlement_grants g
           where g.account_id = ac.account_id and g.source in ('admin_beta','admin_comp')
             and g.revoked_at is null
             and (g.expires_at is null or g.expires_at > now()))  as admin_grant_active,
  (select s.condition from public.subscriptions s
    where s.account_id = ac.account_id
    order by s.provider_updated_at desc nulls last limit 1)       as subscription_condition,
  (select s.provider from public.subscriptions s
    where s.account_id = ac.account_id
    order by s.provider_updated_at desc nulls last limit 1)       as subscription_provider,
  (select s.current_period_end from public.subscriptions s
    where s.account_id = ac.account_id
    order by s.provider_updated_at desc nulls last limit 1)       as paid_through
from public.account_commercial ac;

revoke all on public.account_operational_state from public, anon, authenticated;
grant select on public.account_operational_state to postgres, service_role;


-- ---------------------------------------------------------------------------
-- VERIFY. Read-only.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.account_commercial)                        as accounts,
  (select count(*) from public.account_commercial
    where last_active_at > now() - interval '30 days')                    as active_30d,
  (select count(*) from public.account_commercial
    where trial_consumed_at is not null)                                  as trials_started,
  (select count(*) from public.account_operational_state where trial_active)      as trials_active,
  (select count(*) from public.account_operational_state where admin_grant_active) as admin_grants,
  (select count(*) from public.account_operational_state
    where subscription_condition = 'active')                              as paid_active,
  has_function_privilege('authenticated','public.touch_last_active(uuid)','EXECUTE') as touch_client_callable;
