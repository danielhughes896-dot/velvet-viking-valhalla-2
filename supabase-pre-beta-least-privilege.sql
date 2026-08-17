-- ---------------------------------------------------------------------------
-- PRE-BETA LEAST PRIVILEGE -- ALREADY APPLIED
-- ---------------------------------------------------------------------------
--
-- STATUS: applied to the live project as migration
-- `pre_beta_least_privilege_on_definer_functions`. This file is the record, kept
-- here so the repository states what the database is rather than what somebody
-- intended it to be. Re-running it is harmless -- every statement is idempotent.
--
-- WHAT THIS IS NOT. It disables no RLS, creates no policy, widens no access,
-- changes no column, and touches no row. Every statement removes an EXECUTE
-- grant that no application path uses, plus one search_path pin. The two grants
-- at the end are restatements of privileges the product genuinely needs.
--
-- WHY IT WAS NEEDED. Supabase grants EXECUTE on new public functions to `anon`
-- and `authenticated` by default, and PostgREST exposes the public schema at
-- /rest/v1/rpc/<name>. Nothing had removed those defaults for the trigger
-- functions, so four SECURITY DEFINER functions were nominally callable by an
-- unauthenticated caller.
--
-- THE SAFETY QUESTION, and how it was answered rather than assumed.
-- Revoking EXECUTE on a function that a trigger depends on looks dangerous. It
-- is not, because Postgres checks EXECUTE on a trigger function when the trigger
-- is CREATED, not each time it fires. That was verified empirically on this
-- server (Postgres 17.6) before anything was applied: on a throwaway table, with
-- an identical revoke in place, the trigger still fired for the revoked role
-- while a direct call by that role returned "permission denied for function".
-- After applying, the live gate was re-checked the same way -- see STEP 4.


-- ---------------------------------------------------------------------------
-- STEP 1 -- TRIGGER AND EVENT-TRIGGER FUNCTIONS
--
-- All four return `trigger` or `event_trigger`, so direct invocation was never
-- useful to a legitimate caller -- only to somebody probing.
--
--   enforce_beta_allowlist              -> trigger beta_allowlist_gate on auth.users
--   seed_entitlement_for_new_user       -> trigger seed_entitlement_on_signup on auth.users
--   revoke_leases_on_entitlement_change -> trigger entitlement_revocation_kills_leases
--   rls_auto_enable                     -> EVENT trigger ensure_rls on ddl_command_end
--
-- rls_auto_enable is the one that mattered most: it exists to turn RLS ON for
-- any new table, which means it can alter the security state of the database,
-- and it was reachable at /rest/v1/rpc/rls_auto_enable without signing in.
-- ---------------------------------------------------------------------------
revoke all on function public.enforce_beta_allowlist()              from public, anon, authenticated;
revoke all on function public.seed_entitlement_for_new_user()       from public, anon, authenticated;
revoke all on function public.revoke_leases_on_entitlement_change() from public, anon, authenticated;
revoke all on function public.rls_auto_enable()                     from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- STEP 2 -- THE OWNER-UID HELPER
--
-- _vvv_owner_uid() returns the uid hardcoded in STEP 1 of
-- supabase-entitlement.sql and exists only to be read by the one-off DO block in
-- that file, which runs as the owner. It has zero references in application
-- code, and yet PUBLIC and anon held EXECUTE -- so an unauthenticated caller
-- could read the owner uid through PostgREST.
--
-- Proportionate description: the uid grants nothing on its own, so this is least
-- privilege rather than an incident. It is still not a value to hand out.
--
-- The search_path pin resolves the advisor's function_search_path_mutable
-- finding. An empty search_path is correct here and is the strictest available:
-- the body is a single literal cast that references no table and no schema, and
-- built-in types still resolve through the implicit pg_catalog entry. Verified
-- after applying -- the function still returns its 36-character value.
-- ---------------------------------------------------------------------------
revoke all on function public._vvv_owner_uid() from public, anon, authenticated;
alter function public._vvv_owner_uid() set search_path = '';


-- ---------------------------------------------------------------------------
-- STEP 3 -- THE ALLOWLIST MEMBERSHIP ORACLE
--
-- This is the substance of STEP 1 of supabase-beta-hardening.sql. That file was
-- written, reasoned and committed, but had NEVER been run against this project:
-- its own STEP 0 authorisation switch, _vvv_beta_hardening_authorised(), does
-- not exist in the live database. It is applied here because it is also a live
-- advisor finding, and it is the whole of that file's STEP 1 -- STEP 2 (the
-- strava_activities column grant) is deliberately NOT included, because it is
-- not an advisor finding and its author gated it behind an explicit switch.
--
-- beta_email_approved(addr) answers "is this address an approved tester" for any
-- address the caller names. What it leaks is one bit about an address the caller
-- already has, to somebody already on the list -- no plan, no token, no
-- enumeration of the list. That is why it never blocked the beta, and why it is
-- worth closing anyway.
--
-- IT CANNOT BREAK ROW-LEVEL SECURITY. The policies do not call this function.
-- They call is_beta_approved(), which is SECURITY DEFINER, so when its body
-- calls beta_email_approved() the privilege check is made against the function
-- OWNER rather than against `authenticated`. Server paths use the service key,
-- which bypasses grants entirely. Verified after applying -- see STEP 4.
-- ---------------------------------------------------------------------------
revoke execute on function public.beta_email_approved(text) from authenticated;


-- ---------------------------------------------------------------------------
-- DELIBERATELY UNCHANGED, restated so this file cannot be read as narrowing
-- them. Both are required by paths in use right now, and both remain as live
-- advisor warnings ON PURPOSE.
--
--   is_beta_approved()    the predicate inside the row-level policies on plans
--                         and strava_connections. A policy expression is
--                         evaluated with the CALLER's privileges, so revoking
--                         this from `authenticated` would make every signed-in
--                         read and write fail. It stays.
--   delete_own_account()  the only RPC the application calls anywhere
--                         (api/_account-delete.js), and how an athlete
--                         exercises erasure. It stays.
-- ---------------------------------------------------------------------------
grant execute on function public.is_beta_approved()   to authenticated;
grant execute on function public.delete_own_account() to authenticated;


-- ---------------------------------------------------------------------------
-- STEP 4 -- VERIFY
--
-- Expected after applying:
--   the four *_revoked columns          false
--   owner_uid_readable_by_anon          false
--   membership_oracle_open              false
--   is_beta_approved_kept               true    <- must stay true
--   delete_own_account_kept             true    <- must stay true
--   owner_uid_search_path               search_path=""
--   triggers_enabled                    3
--   ensure_rls_enabled                  O
-- ---------------------------------------------------------------------------
select
  has_function_privilege('anon','public.enforce_beta_allowlist()','EXECUTE')              as gate_fn_open,
  has_function_privilege('anon','public.seed_entitlement_for_new_user()','EXECUTE')       as seed_fn_open,
  has_function_privilege('anon','public.revoke_leases_on_entitlement_change()','EXECUTE') as lease_fn_open,
  has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')                     as rls_fn_open,
  has_function_privilege('anon','public._vvv_owner_uid()','EXECUTE')                      as owner_uid_readable_by_anon,
  has_function_privilege('authenticated','public.beta_email_approved(text)','EXECUTE')    as membership_oracle_open,
  has_function_privilege('authenticated','public.is_beta_approved()','EXECUTE')           as is_beta_approved_kept,
  has_function_privilege('authenticated','public.delete_own_account()','EXECUTE')         as delete_own_account_kept,
  (select coalesce(array_to_string(proconfig,','),'(none)')
     from pg_proc where oid='public._vvv_owner_uid()'::regprocedure)                      as owner_uid_search_path,
  (select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid
     where not t.tgisinternal and t.tgenabled='O'
       and p.proname in ('enforce_beta_allowlist','seed_entitlement_for_new_user',
                         'revoke_leases_on_entitlement_change'))                          as triggers_enabled,
  (select evtenabled::text from pg_event_trigger where evtname='ensure_rls')               as ensure_rls_enabled;

-- And the check that matters most, because it is the one that would break the
-- product rather than merely fail a lint: can a signed-in caller still evaluate
-- the RLS predicate? "evaluates fine" is the required answer.
do $$
declare ok text;
begin
  begin
    set local role authenticated;
    perform public.is_beta_approved();
    reset role;
    ok := 'evaluates fine';
  exception when others then reset role; ok := 'BROKEN: '||sqlerrm;
  end;
  reset role;
  raise notice 'authenticated can evaluate the RLS predicate: %', ok;
end $$;


-- ---------------------------------------------------------------------------
-- HOW TO UNDO, if a legitimate path turns out to have depended on one of these.
-- Grant back only the one you need; do not restore the set.
--
--   grant execute on function public.beta_email_approved(text) to authenticated;
--   grant execute on function public._vvv_owner_uid() to authenticated;
--   alter function public._vvv_owner_uid() reset search_path;
--
-- The four trigger/event-trigger functions have no legitimate direct caller, so
-- there is no supported reason to restore those grants.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- STILL OPEN, AND INTENTIONALLY NOT DONE HERE
--
-- 1. rls_enabled_no_policy on access_leases, beta_allowlist and
--    strava_connections. These are INFO, and they are FAIL-CLOSED: RLS is on
--    with no policy, so the browser roles can read nothing at all. Every access
--    to these tables goes through a server function using the service key, which
--    is the intended design. Adding a policy to silence the lint would be the
--    only way to make these tables less safe than they are now.
--
-- 2. supabase-beta-hardening.sql STEP 2 -- `revoke update on
--    public.strava_activities from authenticated` plus a column-scoped
--    `grant update (ingested_at)`. Live check confirms `authenticated` can still
--    UPDATE the `payload` column, which the coaching engine treats as objective
--    data. It is a real narrowing and it is prepared, but it is not an advisor
--    finding and its author put it behind an explicit authorisation switch, so it
--    needs that authorisation rather than a quiet inclusion here. Strava is
--    switched off and strava_activities is empty, so nothing is exposed today.
--
-- 3. auth_leaked_password_protection -- an Auth dashboard setting, not SQL.
--    See the pre-beta report: the application has no password path, but one
--    account carries a real bcrypt hash, so the warning is not vacuous.
-- ---------------------------------------------------------------------------
