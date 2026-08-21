-- ===========================================================================
-- THE OPERATIONAL VIEW FOLLOWS THE TRIAL ONTO THE PROVIDER
--
-- WHAT WAS WRONG. account_operational_state derived trial_ends_at and
-- trial_active from an entitlement_grants row with source = 'trial'. That was
-- right while the trial was card-free: there was no provider behind it, so a
-- grant was the only place the trial could live. supabase-trial-via-provider.sql
-- retired that source after HQ moved the trial onto a real subscription taking
-- a payment method upfront, and the view was left reading a source that can no
-- longer exist.
--
-- WHY IT MATTERS MORE THAN A STALE LABEL. The view is the metrics surface. Left
-- alone it does not fail -- it answers "no trials are running" with total
-- confidence, on the board that decides whether the product is working, on the
-- day the first real trial starts. A number that is confidently wrong is worse
-- than a query that errors.
--
-- WHAT IT NOW READS. subscriptions.condition = 'trialing', bounded by
-- trial_end and falling back to current_period_end -- the same coalesce
-- api/_entitlement.js applies, so the board and the access decision cannot
-- disagree about who is in a trial.
--
-- WHAT IS UNCHANGED. Every column name and type, so nothing that reads this
-- view needs to change. Admin grants still come from entitlement_grants; paid
-- state is still provider-subscription derived; the allowance columns
-- (trial_consumed_at, trial_blocked_at) are still account_commercial's.
--
-- NO DATA IS TOUCHED. This replaces one derived view. It creates nothing,
-- drops nothing, and writes to no table.
--
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 -- REPLACE THE DEFINITION
--
-- CREATE OR REPLACE rather than DROP and recreate: the column list is
-- identical, so a replace is legal, it keeps the grants below intact, and it
-- leaves no instant in which the view does not exist for a reader. If a
-- database has drifted to a different column shape this fails loudly instead
-- of silently producing a view of the wrong shape.
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

-- Restated because a replace is not a guarantee about privileges, and this
-- view must never become readable by anon or authenticated by accident.
revoke all on public.account_operational_state from public, anon, authenticated;
grant select on public.account_operational_state to postgres, service_role;


-- ---------------------------------------------------------------------------
-- STEP 2 -- PROVE THE APPLY TOOK
--
-- Reads the stored definition back out of the catalogue. A migration that
-- reports success because it reached the end proves nothing; this fails if the
-- database is still holding the grant-derived definition.
-- ---------------------------------------------------------------------------
do $$
declare def text;
begin
  select pg_get_viewdef('public.account_operational_state'::regclass, true) into def;

  if def ~ 'source\s*=\s*''trial''' then
    raise exception using
      errcode = 'raise_exception',
      message = 'ABORTED: account_operational_state still derives a trial from a grant source',
      hint    = 'The replace did not take. Nothing else in this file has changed data.';
  end if;

  if def !~ '''trialing''' then
    raise exception using
      errcode = 'raise_exception',
      message = 'ABORTED: account_operational_state does not read the provider trial condition',
      hint    = 'The view must derive trial_active from subscriptions.condition.';
  end if;

  raise notice 'account_operational_state now derives the trial from the provider subscription.';
end $$;


-- ---------------------------------------------------------------------------
-- VERIFY. Read-only.
--
-- trials_active counts real provider trials. trials_consumed counts athletes
-- who have ever spent their one allowance. They answer different questions and
-- are expected to differ once the first trial converts.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.account_operational_state)                          as accounts,
  (select count(*) from public.account_operational_state where trial_active)       as trials_active,
  (select count(*) from public.account_operational_state
    where trial_ends_at is not null)                                               as trials_ever,
  (select count(*) from public.account_commercial
    where trial_consumed_at is not null)                                           as trials_consumed,
  (select count(*) from public.account_operational_state where admin_grant_active) as admin_grants,
  (select count(*) from public.account_operational_state
    where subscription_condition = 'active')                                       as paid_active,
  (select count(*) from public.entitlement_grants where source = 'trial')          as legacy_trial_grants;
