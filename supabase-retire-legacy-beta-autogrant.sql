-- ===========================================================================
-- RETIRE THE LEGACY BETA AUTO-GRANT
--
-- WHAT THIS REMOVES. A trigger on auth.users that gave EVERY new account
-- entitlements.override = 'beta'. Its own comment named the assumption it was
-- built on -- "while private beta is the only route in" -- and commercial entry
-- is precisely the change that ends that.
--
-- WHY IT MUST GO. resolveAccess() checks the override BEFORE any commercial
-- rule, so while this trigger lives, every athlete who creates an account is
-- granted permanent free access and never meets a trial, a preview gate or a
-- paywall. The front door cannot be opened while it exists.
--
-- WHY IT IS SAFE. The canonical model already carries the beta cohort:
-- entitlement_grants rows with source = 'admin_beta', created by
-- supabase-commercial-core.sql STEP 7 from the same beta_allowlist. This
-- trigger is now duplicate access authority, not the authority.
--
-- WHAT THIS DOES NOT DO. It does not revoke anybody. Existing entitlements
-- rows are left exactly as they are, existing grants are untouched, no trial is
-- consumed and no subscription is created. It stops FUTURE automatic grants and
-- nothing else.
--
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 -- REFUSE TO RUN IF THE CANONICAL COHORT IS NOT ALREADY IN PLACE
--
-- The whole safety argument is that entitlement_grants already carries anyone
-- who relies on the legacy override. If that is not true in this database, then
-- removing the trigger really would remove somebody's access, and the right
-- answer is to stop rather than to find out afterwards.
--
-- The check: every athlete currently holding override='beta' must ALSO hold a
-- live admin_beta grant. Anyone who does not is access that exists only in the
-- legacy column, and this file will not proceed while one exists.
-- ---------------------------------------------------------------------------
do $$
declare orphan_count integer; orphans text;
begin
  select count(*), coalesce(string_agg(left(user_id::text, 8) || '…', ', '), '')
    into orphan_count, orphans
    from public.entitlements e
   where e.override = 'beta'
     and (e.override_expires_at is null or e.override_expires_at > now())
     and not exists (
       select 1 from public.entitlement_grants g
        where g.account_id = e.user_id
          and g.source = 'admin_beta'
          and g.revoked_at is null
          and (g.expires_at is null or g.expires_at > now())
     );

  if orphan_count > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = 'ABORTED: ' || orphan_count || ' athlete(s) hold beta access ONLY through the legacy override',
      detail  = 'accounts: ' || orphans,
      hint    = 'Create canonical admin_beta grants for them first (supabase-commercial-core.sql STEP 7 '
                'does this from beta_allowlist), then run this file again. Nothing has been changed.';
  end if;

  raise notice 'Legacy override holders all have canonical admin_beta grants. Safe to retire.';
end $$;


-- ---------------------------------------------------------------------------
-- STEP 2 -- STOP FUTURE AUTOMATIC GRANTS
--
-- The trigger goes first, then the function. Dropping in that order means there
-- is never a moment where the trigger exists pointing at a missing function.
--
-- account_commercial seeding is NOT touched: seed_account_commercial_on_signup
-- is the Phase 1 trigger and it is correct -- it creates the row an allowance
-- will one day be recorded against, with no trial and no entitlement.
-- ---------------------------------------------------------------------------
drop trigger if exists seed_entitlement_on_signup on auth.users;
drop function if exists public.seed_entitlement_for_new_user();


-- ---------------------------------------------------------------------------
-- STEP 3 -- VERIFY
--
-- Read-only. Run it after, and expect:
--   legacy_trigger_gone    = true
--   legacy_function_gone   = true
--   commercial_seed_intact = true   (Phase 1 seeding still fires)
--   live_admin_beta_grants = the beta cohort, unchanged
--   trials_consumed        = unchanged, and never increased by this file
-- ---------------------------------------------------------------------------
select
  not exists (select 1 from pg_trigger t
               join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'auth' and c.relname = 'users'
                and t.tgname = 'seed_entitlement_on_signup')            as legacy_trigger_gone,
  not exists (select 1 from pg_proc p
               join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname = 'seed_entitlement_for_new_user')        as legacy_function_gone,
  exists     (select 1 from pg_trigger t
               join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'auth' and c.relname = 'users'
                and t.tgname = 'seed_account_commercial_on_signup')     as commercial_seed_intact,
  (select count(*) from public.entitlement_grants
    where source = 'admin_beta' and revoked_at is null)                 as live_admin_beta_grants,
  (select count(*) from public.account_commercial
    where trial_consumed_at is not null)                                as trials_consumed;
