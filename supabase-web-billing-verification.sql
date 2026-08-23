-- ===========================================================================
-- VELVET VIKING -- WEB BILLING READINESS: IS THIS DATABASE READY TO SELL?
--
-- READ-ONLY. There is no INSERT, UPDATE, DELETE, CREATE, DROP, ALTER or GRANT
-- anywhere in this file. It can be pasted into the SQL editor of a production
-- project without approval, because it cannot change anything.
--
-- WHY IT EXISTS. Phase 2 added no schema. Every column the web billing code
-- writes already exists in migrations that are committed to this repository --
-- but committed is not applied, and the repository cannot see a database. The
-- gap between "the SQL file exists" and "the SQL file has been run" is exactly
-- where a launch fails silently: the code writes agreed_price_minor, the column
-- is not there, PostgREST returns 400, and the only symptom is a webhook
-- retrying.
--
-- So this asks the database. Every column heading names the value that means
-- READY, so the output is checkable without reading this file again.
--
-- WHAT A 'false' MEANS is written under each section, together with which file
-- in this repository fixes it. Nothing here decides to run any of them: two of
-- those files open the product to the public and that is HQ's decision, not a
-- script's.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE COMMERCIAL CORE
--
-- supabase-commercial-core.sql. Four tables and the two unique indexes that do
-- the real work: one makes a redelivered provider event harmless, the other
-- makes one provider subscription belong to exactly one row.
-- ---------------------------------------------------------------------------
select
  to_regclass('public.account_commercial')  is not null as account_commercial_expect_true,
  to_regclass('public.subscriptions')       is not null as subscriptions_expect_true,
  to_regclass('public.entitlement_grants')  is not null as grants_expect_true,
  to_regclass('public.billing_events')      is not null as billing_events_expect_true,
  exists (select 1 from pg_indexes where indexname = 'billing_events_provider_identity')
                                                        as replay_guard_expect_true,
  exists (select 1 from pg_indexes where indexname = 'subscriptions_provider_identity')
                                                        as one_row_per_purchase_expect_true,
  exists (select 1 from pg_indexes where indexname = 'entitlement_grants_one_live_per_source')
                                                        as one_live_grant_expect_true;


-- ---------------------------------------------------------------------------
-- 2. THE COLUMNS THE WEB RAIL WRITES
--
-- supabase-trial-via-provider.sql. lockAgreedPrice() writes the first four on
-- the FIRST event of every subscription; if they are missing, every purchase
-- logs STRIPE_AGREEMENT_NOT_LOCKED and the founding-price promise is silently
-- not being kept. The pause columns are read by the resolver on every access
-- decision.
--
-- grace_period_end is listed because the rule depends on it EXISTING and being
-- empty: Valhalla honours provider-supplied grace and adds none of its own, so
-- the column is written explicitly as null by the web adapter rather than left
-- unwritten.
-- ---------------------------------------------------------------------------
with cols as (
  select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'subscriptions'
)
select
  exists (select 1 from cols where column_name = 'agreed_price_minor') as agreed_price_expect_true,
  exists (select 1 from cols where column_name = 'agreed_currency')    as agreed_currency_expect_true,
  exists (select 1 from cols where column_name = 'price_locked_at')    as price_lock_expect_true,
  exists (select 1 from cols where column_name = 'catalogue_version')  as catalogue_version_expect_true,
  exists (select 1 from cols where column_name = 'grace_period_end')   as provider_grace_expect_true,
  exists (select 1 from cols where column_name = 'paused_at')          as paused_at_expect_true,
  exists (select 1 from cols where column_name = 'pause_resumes_at')   as pause_resumes_expect_true,
  exists (select 1 from cols where column_name = 'last_pause_started_at') as last_pause_expect_true;


-- ---------------------------------------------------------------------------
-- 3. THE TWO GATES THAT STILL CLOSE THE PRODUCT
--
-- These are the ones that matter most, because both of them fail in the
-- direction of "looks fine in staging, sells nothing in production".
--
--   legacy_autogrant_gone
--     A trigger on auth.users that gave EVERY new account override='beta'.
--     resolveAccess() checks the override BEFORE any commercial rule, so while
--     it lives, every athlete who signs up is granted permanent free access and
--     never meets a trial, a preview gate or a paywall.
--     FIX: supabase-retire-legacy-beta-autogrant.sql. It refuses to run unless
--     every current override='beta' holder also holds a canonical admin_beta
--     grant, so it cannot take a tester's access away.
--
--   signup_open_to_public
--     beta_allowlist_gate is a BEFORE INSERT trigger on auth.users that raises
--     42501 for any address not on the allowlist. A paying customer cannot
--     create an account at all while it exists.
--     FIX: supabase-commercial-activation.sql -- which DELIBERATELY refuses to
--     run until a human edits STEP 0 to 'yes', because it is the act of opening
--     the product to the public.
--
--   plans_not_beta_gated / activities_not_beta_gated
--     The ownership policies read auth.uid() = user_id AND is_beta_approved().
--     A customer who paid and is not on the allowlist is refused SELECT and
--     INSERT on their own plan, so the app falls back to local-only and reports
--     an error the athlete cannot act on.
--     FIX: the same activation file, STEP 3.
--
--   commercial_seed_intact
--     The Phase 1 trigger that creates the account_commercial row a trial
--     allowance is recorded against. This one must STAY.
-- ---------------------------------------------------------------------------
select
  not exists (select 1 from pg_trigger t
               join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'auth' and c.relname = 'users'
                and t.tgname = 'seed_entitlement_on_signup')          as legacy_autogrant_gone_expect_true,
  not exists (select 1 from pg_trigger where tgname = 'beta_allowlist_gate')
                                                                      as signup_open_to_public_expect_true,
  not exists (select 1 from pg_policies
               where tablename = 'plans'
                 and (coalesce(qual,'') like '%is_beta_approved%'
                   or coalesce(with_check,'') like '%is_beta_approved%'))
                                                                      as plans_not_beta_gated_expect_true,
  not exists (select 1 from pg_policies
               where tablename = 'strava_activities'
                 and (coalesce(qual,'') like '%is_beta_approved%'
                   or coalesce(with_check,'') like '%is_beta_approved%'))
                                                                      as activities_not_beta_gated_expect_true,
  exists (select 1 from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'auth' and c.relname = 'users'
            and t.tgname = 'seed_account_commercial_on_signup')       as commercial_seed_intact_expect_true;


-- ---------------------------------------------------------------------------
-- 4. NOBODY MAY WRITE THEIR OWN COMMERCIAL STATE
--
-- Every commercial table is read-own at most. An athlete who could write any of
-- them could grant themselves a subscription, reset their trial, or edit a
-- period end to extend their own access. billing_events has NO policy at all,
-- which under RLS is deny-all: an athlete has no business reading the provider
-- event stream, not even their own.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_policies
    where tablename = 'account_commercial' and cmd <> 'SELECT')       as commercial_writes_expect_0,
  (select count(*) from pg_policies
    where tablename = 'subscriptions' and cmd <> 'SELECT')            as subscription_writes_expect_0,
  (select count(*) from pg_policies
    where tablename = 'entitlement_grants' and cmd <> 'SELECT')       as grant_writes_expect_0,
  (select count(*) from pg_policies
    where tablename = 'billing_events')                               as event_policies_expect_0,
  (select relrowsecurity from pg_class where oid = 'public.account_commercial'::regclass) as rls_commercial_expect_true,
  (select relrowsecurity from pg_class where oid = 'public.subscriptions'::regclass)      as rls_subscriptions_expect_true,
  (select relrowsecurity from pg_class where oid = 'public.entitlement_grants'::regclass) as rls_grants_expect_true,
  (select relrowsecurity from pg_class where oid = 'public.billing_events'::regclass)     as rls_events_expect_true;


-- ---------------------------------------------------------------------------
-- 5. WHERE THIS DATABASE ACTUALLY IS
--
-- Not a pass/fail -- the shape of the cohort, so a commissioning decision is
-- made against numbers rather than against an assumption. Read it before
-- switching anything on and again afterwards.
--
-- trials_used SHOULD BE 0 before launch. A non-zero count before any commerce
-- has been enabled means something spent an allowance that should not have,
-- and that is a stop-and-investigate rather than a curiosity.
--
-- sandbox_subscriptions is separated from production ones deliberately: a
-- Stripe test-mode purchase made during commissioning is a real row, and
-- counting it as a customer is how a launch report becomes fiction.
-- ---------------------------------------------------------------------------
select
  (select count(*) from auth.users)                                    as auth_users,
  (select count(*) from public.account_commercial)                     as commercial_accounts,
  (select count(*) from public.account_commercial
    where trial_consumed_at is not null)                               as trials_used_expect_0_before_launch,
  (select count(*) from public.entitlement_grants
    where source = 'admin_beta' and revoked_at is null)                as live_beta_grants,
  (select count(*) from public.entitlement_grants
    where source = 'admin_comp' and revoked_at is null)                as live_comp_grants,
  (select count(*) from public.entitlements where override = 'beta')   as legacy_beta_overrides,
  (select count(*) from public.subscriptions where environment = 'production') as production_subscriptions,
  (select count(*) from public.subscriptions where environment = 'sandbox')    as sandbox_subscriptions,
  (select count(*) from public.billing_events)                         as billing_events,
  (select count(*) from public.billing_events where processed_at is null)      as unprocessed_events_expect_0;


-- ---------------------------------------------------------------------------
-- 6. ANYONE WHOSE ACCESS EXISTS ONLY IN THE LEGACY COLUMN
--
-- The one query to run before retiring the auto-grant. Every athlete listed
-- here holds override='beta' with NO canonical admin_beta grant behind it, so
-- retiring the trigger would be the moment they lost access. Expect zero rows.
--
-- Identifiers are truncated: this is a readiness check, not a user export.
-- ---------------------------------------------------------------------------
select left(e.user_id::text, 8) || '…' as account, e.override, e.override_note
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


-- ---------------------------------------------------------------------------
-- 7. THE PROJECTION AGREES WITH WHAT IS BEHIND IT
--
-- public.entitlements is a CACHE of resolveStandardEntitlement(), written only
-- by syncEntitlementRow(). It is not authority and nothing reads it to decide
-- anything -- but a row that disagrees with the subscriptions and grants behind
-- it is still a row that will be shown to somebody, and it is the first symptom
-- of a webhook that stopped landing.
--
-- Expect zero rows. Each one names an account whose projection claims a
-- commercial state with no commercial source under it.
-- ---------------------------------------------------------------------------
select left(e.user_id::text, 8) || '…' as account,
       e.state, e.access_until, e.override
  from public.entitlements e
 where e.state in ('trial', 'active', 'grace')
   and coalesce(e.access_until, now()) > now()
   and not exists (
     select 1 from public.subscriptions s
      where s.account_id = e.user_id
        and s.condition in ('trialing', 'active', 'cancelled', 'past_due')
   );
