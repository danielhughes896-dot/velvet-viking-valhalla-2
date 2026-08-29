-- ===========================================================================
-- COMMERCIAL CUTOVER
--
-- ONE OPERATION, because the parts are only safe in one order. Opening public
-- signup before the beta cohort is grandfathered would leave real athletes
-- locked out of a product they were invited to; grandfathering without opening
-- signup would leave the commercial journey with no entrance. Both happen here,
-- inside one transaction, or neither does.
--
-- WHAT THIS REPLACES. supabase-open-public-signup.sql, which did only the door
-- half. It is deleted rather than kept beside this file: two migrations that
-- must be run in a particular order are a production incident waiting for
-- somebody to be in a hurry.
--
-- THE POLICY THIS IMPLEMENTS.
--
--   OWNER            untouched, permanently access-bearing. Not read, not
--                    written, not counted by anything below.
--   BETA COHORT      the athletes who were legitimately in the private beta at
--                    this instant keep their access, as an explicit
--                    GRANDFATHERED COMPLIMENTARY grant per account.
--   BETA PROGRAMME   retired. Not paused, not narrowed: after this runs, a
--                    beta grant grants nothing and no new one can be written.
--   PUBLIC SIGNUP    open. A new address does not need to be on any list.
--   NEW ACCOUNTS     commercial only. Nobody gets complimentary access for
--                    existing, for signing up, or for being on a list.
--
-- WHY COMPLIMENTARY RATHER THAN "KEEP HONOURING BETA". A rule that says "beta
-- still works for the people who had it" is a rule that has to keep deciding,
-- forever, who had it -- and the data it would decide from is a list that can
-- be added to. Converting the cohort into explicit per-account grants freezes
-- it: after this runs, the beta allowlist is a historical record with no
-- bearing on access, and adding a row to it does nothing at all.
--
-- HISTORY IS PRESERVED. No beta grant is deleted or revoked, no allowlist row
-- is removed, and each new grant records where it came from. What changes is
-- which rows are honoured, not which rows exist.
--
-- SAFE TO RE-RUN. Grandfathering is keyed on a marker in the note, so a second
-- run grants nobody a second time; every other step is idempotent by
-- construction.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- STEP 0 -- REFUSE TO RUN INTO A SCHEMA THAT COULD NOT CATCH THE TRAFFIC
--
-- Opening signup while the commercial tables are absent would admit accounts
-- into a product with nothing to resolve their entitlement against. The
-- environment flag that arms the gate (VVV_COMMERCIAL_REQUIRED) lives in
-- Vercel and cannot be seen from here; it is named in the deployment note.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.entitlements') is null
     or to_regclass('public.account_commercial') is null
     or to_regclass('public.subscriptions') is null
     or to_regclass('public.entitlement_grants') is null then
    raise exception 'refusing to cut over: the commercial tables are not all present';
  end if;

  -- The OTHER trigger on auth.users. Without it a new athlete has no
  -- account_commercial row and cannot be sold anything, so opening signup
  -- while it is missing would create accounts that can never buy.
  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'users'
       and t.tgname = 'seed_account_commercial_on_signup'
       and not t.tgisinternal
  ) then
    raise exception
      'refusing to cut over: seed_account_commercial_on_signup is missing, so new accounts would have no commercial row';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 1 -- IDENTIFY THE COHORT, AND SAY EXACTLY WHAT COUNTS
--
-- Three independent pieces of evidence that an account was in the beta, ORed
-- because the programme wrote them at different times and no single one covers
-- everybody:
--
--   an active admin_beta GRANT          the canonical commercial-core record
--   an entitlements override of 'beta'  written by the old signup trigger
--   an unrevoked ALLOWLIST entry        the only evidence for the athletes who
--                                       were invited and admitted before either
--                                       of the above existed. Signup itself was
--                                       gated on this list, so an account whose
--                                       address is on it was, by construction,
--                                       let in as a beta athlete.
--
-- WHAT IS DELIBERATELY EXCLUDED, and each exclusion is the point of a test:
--   revoked allowlist entries    somebody whose invitation was withdrawn
--   revoked or expired grants    access that had already ended
--   expired beta overrides       the same, by timestamp
--   the owner                    keeps owner access and needs nothing here
--   addresses with no account    there is nobody to grant anything to; if they
--                                sign up later they are an ordinary customer,
--                                which is the correct answer once the beta is
--                                over
-- ---------------------------------------------------------------------------
create temporary table cutover_cohort on commit drop as
select u.id as account_id, u.email
  from auth.users u
 where
   -- not the owner: owner access is a separate, permanent thing
   not exists (select 1 from public.entitlements e
                where e.user_id = u.id and e.override = 'owner')
   and (
     exists (select 1 from public.entitlement_grants g
              where g.account_id = u.id
                and g.source = 'admin_beta'
                and g.revoked_at is null
                and (g.expires_at is null or g.expires_at > now()))
     or exists (select 1 from public.entitlements e
                 where e.user_id = u.id
                   and e.override = 'beta'
                   and (e.override_expires_at is null or e.override_expires_at > now()))
     or exists (select 1 from public.beta_allowlist b
                 where b.email = lower(trim(u.email))
                   and b.revoked_at is null)
   );

-- ---------------------------------------------------------------------------
-- STEP 2 -- GRANDFATHER THEM, ONCE
--
-- admin_comp is the existing complimentary grant source. It resolves through
-- the same fold as every other source, projects onto the entitlements row as
-- override 'promo', and is honoured by resolveAccess(). Nothing new is
-- invented and no parallel access system is created.
--
-- The note carries the marker this migration keys re-runs on AND the
-- provenance, so a support conversation in a year can still answer "why does
-- this athlete not pay".
-- ---------------------------------------------------------------------------
insert into public.entitlement_grants (account_id, source, product_code, expires_at, note)
select c.account_id, 'admin_comp', 'VALHALLA_STANDARD', null,
       'grandfathered-beta: complimentary access preserved at commercial cutover'
  from cutover_cohort c
 where not exists (
   select 1 from public.entitlement_grants g
    where g.account_id = c.account_id
      and g.source = 'admin_comp'
      and g.note like 'grandfathered-beta:%'
 );

-- ---------------------------------------------------------------------------
-- STEP 3 -- FREEZE THE BETA PROGRAMME, STRUCTURALLY
--
-- The application already refuses to honour a beta grant (RETIRED_GRANT_SOURCES
-- in api/_entitlement.js) and refuses a stored 'beta' override at the gate
-- (ACCESS_OVERRIDES in api/_access.js). This is the database saying the same
-- thing, so that "beta is retired" does not depend on which code is deployed.
--
-- EXISTING ROWS ARE UNTOUCHED AND STILL READABLE. Only NEW ones are refused --
-- history stays, and the programme cannot quietly restart.
-- ---------------------------------------------------------------------------
create or replace function public.refuse_new_beta_grants()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'admin_beta' then
    raise exception
      'the private beta closed at commercial cutover: use admin_comp for complimentary access'
      using errcode = '23514';   -- check_violation
  end if;
  return new;
end;
$$;

drop trigger if exists no_new_beta_grants on public.entitlement_grants;
create trigger no_new_beta_grants
  before insert on public.entitlement_grants
  for each row execute function public.refuse_new_beta_grants();

-- ---------------------------------------------------------------------------
-- STEP 4 -- OPEN PUBLIC SIGNUP
--
-- beta_allowlist_gate raised 'velvet_viking_private_beta: address not
-- authorised' for every address not on the list. It was the whole of access
-- control while nothing was for sale; it is not access control now, because
-- resolveAccess() refuses an account with no subscription and no grant whether
-- or not that account exists. Dropping it converts "you may not have an
-- account" into "you may have an account and must subscribe to use it".
--
-- enforce_beta_allowlist() itself is left in place: it is referenced by nothing
-- once the trigger is gone, and keeping it means re-closing signup in an
-- emergency is one CREATE TRIGGER rather than a function reconstructed from git.
-- ---------------------------------------------------------------------------
drop trigger if exists beta_allowlist_gate on auth.users;

comment on table public.beta_allowlist is
  'HISTORY, NOT ENTITLEMENT, AND NOT A SIGNUP GATE. Records who was invited to '
  'the private beta and when. Since the commercial cutover it controls nothing: '
  'signup is open, access is decided by the entitlements row, and the cohort '
  'that held beta access was converted to explicit admin_comp grants. Adding a '
  'row here grants nobody anything.';

-- ---------------------------------------------------------------------------
-- STEP 5 -- PROVE IT, BEFORE COMMITTING
-- ---------------------------------------------------------------------------
do $$
declare
  n_cohort       int;
  n_grandfathered int;
  n_owner        int;
  n_ungranted    int;
begin
  select count(*) into n_cohort from cutover_cohort;

  select count(*) into n_grandfathered
    from cutover_cohort c
    join public.entitlement_grants g
      on g.account_id = c.account_id
     and g.source = 'admin_comp'
     and g.revoked_at is null
     and g.note like 'grandfathered-beta:%';

  -- G: every previously active legitimate beta athlete still has access
  if n_grandfathered <> n_cohort then
    raise exception 'grandfathering incomplete: % of % beta athletes have a grant',
      n_grandfathered, n_cohort;
  end if;

  -- G: owner access untouched
  select count(*) into n_owner from public.entitlements where override = 'owner';
  if n_owner < 1 then
    raise exception 'the owner override is gone';
  end if;
  if exists (select 1 from cutover_cohort c
              join public.entitlements e on e.user_id = c.account_id
             where e.override = 'owner') then
    raise exception 'the owner was swept into the grandfathered cohort';
  end if;

  -- G: beta_allowlist no longer controls signup
  if exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'users'
       and t.tgname = 'beta_allowlist_gate' and not t.tgisinternal
  ) then
    raise exception 'the signup gate is still attached to auth.users';
  end if;

  -- G: seed_account_commercial_on_signup preserved
  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and c.relname = 'users'
       and t.tgname = 'seed_account_commercial_on_signup' and not t.tgisinternal
  ) then
    raise exception 'the commercial seeding trigger was removed';
  end if;

  -- G: beta cannot be granted to future accounts
  begin
    insert into public.entitlement_grants (account_id, source, product_code)
    select account_id, 'admin_beta', 'VALHALLA_STANDARD' from cutover_cohort limit 1;
    raise exception 'a new beta grant was accepted after cutover';
  exception when check_violation then
    null;   -- refused, which is the whole point
  end;

  -- Nobody in the cohort is left without access. Reported rather than assumed.
  select count(*) into n_ungranted
    from cutover_cohort c
   where not exists (select 1 from public.entitlement_grants g
                      where g.account_id = c.account_id and g.source = 'admin_comp'
                        and g.revoked_at is null);
  if n_ungranted <> 0 then
    raise exception '% beta athletes have no complimentary grant', n_ungranted;
  end if;

  raise notice 'commercial cutover: % beta athletes grandfathered, owner untouched, public signup open',
    n_cohort;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- AFTER COMMITTING, the entitlements projection catches up per account the
-- next time anything happens to it. That is the existing design -- grants are
-- the source of truth and entitlements is their projection -- and it is why
-- api/_access.js refuses a stored 'beta' override directly rather than waiting
-- for a re-projection that may never come.
-- ---------------------------------------------------------------------------
