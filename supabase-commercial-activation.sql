-- ===========================================================================
-- VELVET VIKING -- PHASE 5: WHAT MUST CHANGE IN THE DATABASE BEFORE ANYONE
-- CAN BE CHARGED
--
-- THIS SCRIPT HAS NOT BEEN RUN. It is the audited answer to a question the
-- Phase 5 release audit asked and did not like the answer to: if HQ switched
-- VVV_COMMERCIAL_REQUIRED on tomorrow, what would actually happen?
--
-- Three things, and they are all in the schema rather than in the application:
--
--   1. EVERY ACCOUNT IS FREE, FOREVER.
--      seed_entitlement_for_new_user() (supabase-entitlement.sql STEP 6) writes
--      override='beta' with no expiry onto every row inserted into auth.users.
--      resolveAccess() checks the override BEFORE any commercial rule, so such
--      a row is admitted whatever VVV_COMMERCIAL_REQUIRED says. Verified
--      against the real decision function:
--          override='beta', state='expired', commercialRequired=true
--            -> { allow: true, reason: 'override_beta' }
--      The migration that installed it says so itself: "This becomes the wrong
--      default the moment ordinary paying customers can sign up, so 3A2 must
--      replace it -- noted here rather than in a ticket because the consequence
--      of forgetting is free access." 3A2 shipped. It was not replaced.
--
--   2. NO PAYING CUSTOMER COULD USE CLOUD SYNC.
--      supabase-beta-gate.sql STEP 4b rewrote the ownership policies on
--      public.plans and public.strava_activities to
--          auth.uid() = user_id AND public.is_beta_approved()
--      is_beta_approved() reads beta_allowlist. A customer who paid and is not
--      on the allowlist is refused SELECT and INSERT on their own plan row, so
--      the app would fall back to local-only and report an error the athlete
--      cannot act on. The isolation half -- auth.uid() = user_id -- is the part
--      that matters and is untouched below; only the beta predicate moves.
--
--   3. NO PAYING CUSTOMER COULD CREATE AN ACCOUNT AT ALL.
--      beta_allowlist_gate (STEP 4a) is a BEFORE INSERT trigger on auth.users
--      that raises 42501 for any address not on the allowlist.
--
-- These three are consistent with each other and correct for a private beta.
-- They are the private beta. Commercial launch is the act of lifting all three
-- together, which is why they are in one file with one switch.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS SCRIPT WILL NOT DO
--
--   * It does not remove or downgrade any override that already exists. Every
--     current tester keeps exactly the access they have. Retroactively
--     stripping override='beta' would lock out real testers, and deciding who
--     among today's accounts is a tester and who is an early customer is a
--     commercial judgement, not a migration.
--   * It does not turn any flag on. VVV_ACCOUNT_REQUIRED and
--     VVV_COMMERCIAL_REQUIRED live in Vercel and are HQ's to switch.
--   * It does not configure, mention or assume a payment provider.
--   * It does not run unless STEP 0 is edited, for the same reason the other
--     two migrations refuse: a file pasted unread must change nothing.
--
-- SAFE TO RUN TWICE. Every statement is idempotent.
-- REVERSIBLE. STEP 5 is the exact inverse and restores the private beta.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 0 -- THE SWITCH
--
-- Change 'no' to 'yes' to state that Velvet Viking is opening to customers who
-- are not on the beta allowlist. Nothing below this runs while it says 'no'.
-- ---------------------------------------------------------------------------
create or replace function public._vvv_commercial_launch_authorised()
returns text language sql immutable as $$
  select 'no'::text;
$$;

do $$
begin
  if lower(trim(public._vvv_commercial_launch_authorised())) <> 'yes' then
    raise exception
      'ABORTED: this script lifts the private-beta gate so anyone can sign up and be charged. Edit STEP 0 to ''yes'' when HQ has authorised commercial launch, then run again. Nothing has been changed.';
  end if;
  raise notice 'Commercial launch authorised in STEP 0 -- proceeding.';
end $$;


-- ---------------------------------------------------------------------------
-- STEP 1 -- NEW ACCOUNTS STOP BEING GIVEN FREE ACCESS
--
-- The trigger keeps its name and its place, so nothing else has to know it
-- changed. What it does is now conditional on the thing it was always
-- implicitly assuming: that the only route into the product is the allowlist.
--
--   on the allowlist  -> override='beta', exactly as today. A tester who signs
--                        in for the first time after commercial launch is still
--                        a tester and is not asked to pay.
--   not on it         -> a row with NO override and state='expired'. That is
--                        the honest starting position: the account exists, it
--                        holds no access, and the entitlement engine decides
--                        the rest. Writing a row rather than none is
--                        deliberate -- resolveAccess() denies 'no_entitlement'
--                        and denies 'expired' identically, and a row that
--                        exists is one the webhook can PATCH rather than having
--                        to INSERT, which removes a race from first payment.
--
-- NO TRIAL IS GRANTED HERE. A trial length is a commercial decision and
-- state='trial' with an access_until is a single UPDATE away when HQ has made
-- it. Guessing one in a migration is how a free month ends up being permanent.
-- ---------------------------------------------------------------------------
-- RETIRED. This step used to redefine seed_entitlement_for_new_user() so that
-- ordinary signups got state='expired' while allowlisted testers still got
-- override='beta'. That was the right shape at the time and it is superseded
-- now, for two reasons.
--
-- First, the beta half duplicates canonical authority: entitlement_grants rows
-- with source='admin_beta' already carry the cohort, created by
-- supabase-commercial-core.sql STEP 7 from the same beta_allowlist. Two places
-- granting the same access is how they drift.
--
-- Second, the ordinary half is no longer needed. resolveAccess() denies
-- 'no_entitlement' and denies 'expired' identically, so writing an expired row
-- at signup buys nothing the absence of a row does not already give. Phase 1's
-- seed_account_commercial_on_signup creates the account_commercial row a trial
-- allowance is recorded against, and that is the whole of what a new account
-- should receive.
--
-- A new account therefore arrives with: an account_commercial row, no trial
-- consumed, no entitlement, and no access -- until an explicit path grants one.
-- That is the commercial front door working, rather than being bypassed.


-- ---------------------------------------------------------------------------
-- STEP 2 -- AN ADDRESS THAT IS NOT ON THE ALLOWLIST MAY CREATE AN ACCOUNT
--
-- The creation gate is dropped, not weakened: there is no half-open version of
-- "may this person sign up". The function is left in place because
-- beta_email_approved() and is_beta_approved() are still used -- by STEP 1
-- above, and by the operator tooling -- and because STEP 5 puts the trigger
-- back with one statement.
--
-- What still refuses an unwanted account after this: nothing in the database,
-- by design. Access is refused instead, by the entitlement engine, which is
-- the correct layer for it -- "you may have an account and no access" is
-- exactly the state a lapsed customer is in, and it already works.
-- ---------------------------------------------------------------------------
drop trigger if exists beta_allowlist_gate on auth.users;


-- ---------------------------------------------------------------------------
-- STEP 3 -- OWNERSHIP POLICIES STOP ASKING WHETHER THE ATHLETE IS A TESTER
--
-- Back to auth.uid() = user_id, which is what these policies were before the
-- beta gate borrowed them and what they must be for a paying customer to reach
-- their own training.
--
-- READ THIS BEFORE RUNNING: revoking a tester currently takes their cloud
-- access away on their next request, through is_beta_approved() in these
-- predicates. After this step it does not. Withdrawing access from an
-- individual becomes an entitlements operation -- clear the override, or set
-- state='expired' -- which is the same mechanism used for everybody else and
-- which the revocation trigger already turns into a lease revocation. The
-- allowlist stops being an access control and becomes what its name says.
--
-- strava_connections is untouched. RLS on, no policies, deny-all to every
-- browser role: the tokens stay unreachable from any session.
-- ---------------------------------------------------------------------------
drop policy if exists "own plan: select" on public.plans;
drop policy if exists "own plan: insert" on public.plans;
drop policy if exists "own plan: update" on public.plans;

create policy "own plan: select" on public.plans
  for select using (auth.uid() = user_id);
create policy "own plan: insert" on public.plans
  for insert with check (auth.uid() = user_id);
create policy "own plan: update" on public.plans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own activities: select" on public.strava_activities;
drop policy if exists "own activities: update" on public.strava_activities;

create policy "own activities: select" on public.strava_activities
  for select using (auth.uid() = user_id);
create policy "own activities: update" on public.strava_activities
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- STEP 4 -- VERIFY. Run on its own; reads and changes nothing.
--
-- Every column has one correct value and it is named in the column heading, so
-- the output is checkable without reading this file again.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_trigger
     where tgname = 'seed_entitlement_on_signup')                       as signup_seed_expect_1,
  (select count(*) from pg_trigger
     where tgname = 'beta_allowlist_gate')                              as creation_gate_expect_0,
  (select count(*) from pg_policies
     where tablename in ('plans','strava_activities')
       and (coalesce(qual,'') like '%is_beta_approved%'
         or coalesce(with_check,'') like '%is_beta_approved%'))          as policies_still_beta_gated_expect_0,
  (select count(*) from pg_policies
     where tablename = 'plans')                                         as plan_policies_expect_3,
  (select count(*) from pg_policies
     where tablename = 'strava_activities')                             as activity_policies_expect_2,
  (select count(*) from pg_policies
     where tablename = 'strava_connections')                            as connection_policies_expect_0,
  (select count(*) from pg_policies
     where tablename = 'entitlements')                                  as entitlement_policies_expect_1,
  -- unchanged by this script, and confirmed so: no tester lost anything
  (select count(*) from public.entitlements where override = 'beta')     as beta_overrides_unchanged,
  (select count(*) from public.entitlements where override = 'owner')    as owner_overrides_unchanged;


-- ---------------------------------------------------------------------------
-- STEP 5 -- PUTTING THE PRIVATE BETA BACK
--
-- The exact inverse of steps 1 to 3. Run this to close the product again;
-- accounts created while it was open keep their rows and are refused by the
-- entitlement engine rather than by the schema, which is the correct outcome.
--
--   create or replace function public.seed_entitlement_for_new_user()
--   returns trigger language plpgsql security definer
--   set search_path = public, auth as $$
--   begin
--     insert into public.entitlements (user_id, override, override_note)
--     values (new.id, 'beta', 'auto-seeded at signup while private beta is the only route in')
--     on conflict (user_id) do nothing;
--     return new;
--   end; $$;
--
--   create trigger beta_allowlist_gate before insert on auth.users
--     for each row execute function public.enforce_beta_allowlist();
--
--   drop policy if exists "own plan: select" on public.plans;
--   create policy "own plan: select" on public.plans
--     for select using (auth.uid() = user_id and public.is_beta_approved());
--   -- ...and the same predicate re-added to the other four policies in STEP 3.
-- ---------------------------------------------------------------------------
