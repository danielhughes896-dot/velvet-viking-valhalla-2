-- ===========================================================================
-- VELVET VIKING -- PRIVATE-BETA SUPABASE VERIFICATION
--
-- READ-ONLY. This script contains no INSERT, UPDATE, DELETE, CREATE, DROP,
-- ALTER or GRANT. It reads system catalogues and counts rows. Running it
-- changes nothing and is safe at any time, including mid-beta.
--
-- WHY IT EXISTS. "Verified Supabase closure" has been carried as an open
-- private-beta requirement across several reports, and the reason it stayed
-- open is that it cannot be closed from the repository. The repository holds
-- the migration SCRIPTS; it cannot know whether they were applied, whether
-- they were applied in full, or whether anything has been changed in the
-- dashboard since. Those are facts about a running database and only the
-- database can state them.
--
-- So this is the whole of the gap. Paste it into Supabase -> SQL Editor -> New
-- query -> Run, and read one row. Every column is named with the value it must
-- have. Anything that does not match its name is a finding.
--
-- Expected, in full:
--
--   plans_rls_expect_true                    t
--   plans_policies_expect_3                  3
--   plans_owner_scoped_expect_3              3
--   plans_beta_gated_expect_3                3
--   connections_rls_expect_true              t
--   connections_policies_expect_0            0
--   activities_rls_expect_true               t
--   activities_policies_expect_2             2
--   allowlist_rls_expect_true                t
--   allowlist_policies_expect_0              0
--   entitlements_rls_expect_true             t
--   entitlements_policies_expect_1           1
--   leases_rls_expect_true                   t
--   leases_policies_expect_0                 0
--   public_tables_without_rls_expect_0       0
--   creation_gate_expect_1                   1
--   signup_seed_expect_1                     1
--   revocation_trigger_expect_1              1
--   delete_own_account_anon_expect_false     f
--   delete_own_account_authed_expect_true    t
--   active_testers                           (the number HQ authorised)
--   approved_uncovered_expect_0              0
--   accounts_without_override_expect_0       0
--   live_leases                              (informational)
--   oracle_readable_by_testers               (see note below)
--   activities_payload_writable_by_testers   (see note below)
--
-- THE LAST TWO ARE NOT PASS/FAIL. They report two facts the Phase 5 audit
-- found and judged acceptable for a five-person private beta. Both are 't'
-- today, both are addressed by supabase-beta-hardening.sql, and neither is a
-- beta blocker:
--
--   oracle_readable_by_testers
--     beta_email_approved(text) is revoked from public and anon but not from
--     authenticated, so a signed-in tester can ask whether a specific address
--     is on the allowlist. It discloses one bit about an address the asker
--     already knows, to somebody already on the list. No plan, token or
--     address is obtainable through it.
--
--   activities_payload_writable_by_testers
--     the "own activities: update" policy allows writing any column, while
--     supabase-setup.sql describes it as marking a row ingested. Since
--     ingestion moved server-side, no browser code touches this table at all
--     -- verified: zero references to strava_activities in the runtime -- and
--     Strava is off unless VVV_STRAVA_ENABLED says otherwise. An athlete
--     rewriting their own activity payload would be misleading themselves,
--     which they can already do by typing into the log.
-- ===========================================================================

with
tbl as (
  select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
pol as (
  select tablename, policyname,
         coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
    from pg_policies where schemaname = 'public'
),
approved as (
  select b.email from public.beta_allowlist b where b.revoked_at is null
),
approved_accounts as (
  select u.id from approved a join auth.users u on lower(trim(u.email)) = a.email
)
select
  -- ---- the plan row: the only table the browser touches ----
  (select relrowsecurity from tbl where relname = 'plans')                    as plans_rls_expect_true,
  (select count(*) from pol where tablename = 'plans')                        as plans_policies_expect_3,
  (select count(*) from pol where tablename = 'plans'
     and body like '%auth.uid()%' and body like '%user_id%')                   as plans_owner_scoped_expect_3,
  (select count(*) from pol where tablename = 'plans'
     and body like '%is_beta_approved%')                                       as plans_beta_gated_expect_3,

  -- ---- the Strava token table: RLS on, no policy, unreachable from anywhere ----
  (select relrowsecurity from tbl where relname = 'strava_connections')        as connections_rls_expect_true,
  (select count(*) from pol where tablename = 'strava_connections')            as connections_policies_expect_0,

  -- ---- staged activities ----
  (select relrowsecurity from tbl where relname = 'strava_activities')         as activities_rls_expect_true,
  (select count(*) from pol where tablename = 'strava_activities')             as activities_policies_expect_2,

  -- ---- the tester list must not be readable by testers ----
  (select relrowsecurity from tbl where relname = 'beta_allowlist')            as allowlist_rls_expect_true,
  (select count(*) from pol where tablename = 'beta_allowlist')                as allowlist_policies_expect_0,

  -- ---- access authority: readable by its owner, writable by nobody ----
  (select relrowsecurity from tbl where relname = 'entitlements')              as entitlements_rls_expect_true,
  (select count(*) from pol where tablename = 'entitlements')                  as entitlements_policies_expect_1,
  (select relrowsecurity from tbl where relname = 'access_leases')             as leases_rls_expect_true,
  (select count(*) from pol where tablename = 'access_leases')                 as leases_policies_expect_0,

  /* THE CATCH-ALL, and the most valuable column here. Every check above names
     a table someone thought of. This one finds the table nobody thought of:
     anything in public with RLS switched off is readable by every signed-in
     athlete and, depending on grants, by anon. */
  (select count(*) from tbl where relrowsecurity = false)                      as public_tables_without_rls_expect_0,

  -- ---- the three triggers the beta depends on ----
  (select count(*) from pg_trigger where tgname = 'beta_allowlist_gate')       as creation_gate_expect_1,
  (select count(*) from pg_trigger where tgname = 'seed_entitlement_on_signup') as signup_seed_expect_1,
  (select count(*) from pg_trigger
     where tgname = 'entitlement_revocation_kills_leases')                     as revocation_trigger_expect_1,

  -- ---- erasure is reachable by an athlete and by nobody else ----
  has_function_privilege('anon', 'public.delete_own_account()', 'EXECUTE')     as delete_own_account_anon_expect_false,
  has_function_privilege('authenticated', 'public.delete_own_account()', 'EXECUTE')
                                                                              as delete_own_account_authed_expect_true,

  -- ---- who is actually in the beta ----
  (select count(*) from approved)                                             as active_testers,
  (select count(*) from approved_accounts aa
     where not exists (select 1 from public.entitlements e
                        where e.user_id = aa.id
                          and e.override in ('beta','owner')
                          and (e.override_expires_at is null
                               or e.override_expires_at > now())))              as approved_uncovered_expect_0,
  (select count(*) from auth.users u
     where not exists (select 1 from public.entitlements e
                        where e.user_id = u.id and e.override is not null))     as accounts_without_override_expect_0,
  (select count(*) from public.access_leases
     where revoked_at is null and expires_at > now())                           as live_leases,

  -- ---- the two accepted-for-beta facts, reported rather than judged ----
  has_function_privilege('authenticated', 'public.beta_email_approved(text)', 'EXECUTE')
                                                                              as oracle_readable_by_testers,
  has_column_privilege('authenticated', 'public.strava_activities', 'payload', 'UPDATE')
                                                                              as activities_payload_writable_by_testers;


-- ---------------------------------------------------------------------------
-- IF public_tables_without_rls_expect_0 IS NOT 0, run this to see which:
--
--   select c.relname
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
--    order by 1;
--
-- IF plans_beta_gated_expect_3 IS 0 but plans_owner_scoped_expect_3 IS 3, the
-- beta gate (supabase-beta-gate.sql STEP 4b) was never applied. Athletes are
-- still isolated from each other -- that is the auth.uid() half and it is
-- intact -- but revoking a tester will not remove their cloud access. Apply
-- the beta gate before inviting anyone.
--
-- IF creation_gate_expect_1 IS 0, any address can create an account. Apply
-- supabase-beta-gate.sql before inviting anyone.
--
-- IF accounts_without_override_expect_0 IS NOT 0, someone has an account who
-- would be refused the product the moment VVV_ACCOUNT_REQUIRED is switched on.
-- That is not a beta blocker while the flag is off; it is an activation
-- blocker. Identify them before switching it.
-- ---------------------------------------------------------------------------
