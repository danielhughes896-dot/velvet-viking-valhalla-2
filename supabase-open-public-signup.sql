-- ===========================================================================
-- OPEN PUBLIC SIGNUP -- RETIRE THE PRIVATE-BETA DOOR
--
-- WHAT THIS REMOVES. beta_allowlist_gate, a trigger on auth.users that raised
--   velvet_viking_private_beta: address not authorised
-- for every address not present in public.beta_allowlist. It is the reason an
-- ordinary visitor cannot create an account, and therefore the reason the
-- commercial journey has no entrance: pricing page, builder, trial, checkout
-- and Stripe are all downstream of an account that cannot be made.
--
-- WHY THIS IS NOT A WEAKENING. The trigger was the whole of access control
-- while the product was a private beta and nothing was for sale. It is not
-- access control now. Access is decided by resolveAccess() in api/_access.js
-- against the entitlements row, with VVV_COMMERCIAL_REQUIRED on -- an account
-- with no subscription and no grant is refused the runtime whether or not it
-- exists. Removing this converts "you may not have an account" into "you may
-- have an account and must subscribe to use it", which is the launch.
--
-- WHAT IS DELIBERATELY KEPT.
--
--   public.beta_allowlist stays, with every row. It is the record of who was
--   invited and when, and it is referenced by past grants. Nothing reads it
--   for access any more: beta is retired in api/_entitlement.js
--   (RETIRED_GRANT_SOURCES) and refused at the gate in api/_access.js
--   (ACCESS_OVERRIDES). Dropping the table would destroy history to no
--   purpose.
--
--   public.beta_email_approved() stays for the same reason -- it is read by
--   operational views and by the allowlist admin surface, neither of which
--   grants anything.
--
--   seed_account_commercial_on_signup stays and MUST stay. It is the other
--   trigger on auth.users and it creates the account_commercial row every new
--   athlete needs before they can be sold anything. Removing it would break
--   checkout for every account created afterwards.
--
-- WHAT THIS DOES NOT DO. It grants nobody anything. No entitlement is created,
-- no grant is written, no trial is consumed, no subscription is made and no
-- existing row is modified. It removes one refusal.
--
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 -- REFUSE TO RUN IF THE COMMERCIAL GATE COULD NOT CATCH THE TRAFFIC
--
-- Opening signup while the commercial tables are absent would admit accounts
-- into a product with nothing to resolve their entitlement against. The check
-- is for the tables the gate and the purchase path actually read; the
-- environment flag that arms the gate lives in Vercel and cannot be seen from
-- here, so it is named in the deployment note rather than asserted.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.entitlements') is null then
    raise exception 'refusing to open signup: public.entitlements is missing';
  end if;
  if to_regclass('public.account_commercial') is null then
    raise exception 'refusing to open signup: public.account_commercial is missing';
  end if;
  if to_regclass('public.subscriptions') is null then
    raise exception 'refusing to open signup: public.subscriptions is missing';
  end if;
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users'
      and t.tgname = 'seed_account_commercial_on_signup'
      and not t.tgisinternal
  ) then
    raise exception
      'refusing to open signup: seed_account_commercial_on_signup is missing, so new accounts would have no commercial row';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 2 -- REMOVE THE REFUSAL
--
-- The trigger only. enforce_beta_allowlist() itself is left in place: it is a
-- few lines, it is referenced by nothing once the trigger is gone, and keeping
-- it means re-closing signup in an emergency is one CREATE TRIGGER rather than
-- a function that has to be reconstructed from git.
-- ---------------------------------------------------------------------------
drop trigger if exists beta_allowlist_gate on auth.users;

-- ---------------------------------------------------------------------------
-- STEP 3 -- SAY WHAT IS NOW TRUE
-- ---------------------------------------------------------------------------
comment on table public.beta_allowlist is
  'HISTORY, NOT ENTITLEMENT. Records who was invited to the private beta and '
  'when. Since the commercial launch it grants nothing: signup is open, and '
  'access is decided by the entitlements row. Kept for audit and because past '
  'entitlement_grants rows refer to this cohort.';

-- ---------------------------------------------------------------------------
-- STEP 4 -- PROVE IT
-- ---------------------------------------------------------------------------
do $$
declare gate_count int;
begin
  select count(*) into gate_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'auth' and c.relname = 'users'
    and t.tgname = 'beta_allowlist_gate' and not t.tgisinternal;
  if gate_count <> 0 then
    raise exception 'the signup gate is still attached to auth.users';
  end if;
  raise notice 'public signup is open; beta_allowlist retained as history';
end $$;
