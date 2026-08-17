-- ===========================================================================
-- VELVET VIKING -- PRIVATE-BETA HARDENING (two grants)
--
-- THIS SCRIPT HAS NOT BEEN RUN. It is optional, and it is deliberately kept
-- apart from supabase-commercial-activation.sql because the two do opposite
-- things: that one DISMANTLES private-beta access control so customers can be
-- charged, and must stay off during the beta. This one TIGHTENS two privileges
-- that the private beta does not use, and is safe to run during it.
--
-- Neither change is a beta blocker. Both were judged acceptable for five
-- invited testers in the Phase 5 audit and are reported, not hidden, by
-- supabase-beta-verification.sql. They are written down here because "small
-- enough not to block" and "not worth fixing" are different sentences, and the
-- evidence that makes them safe to fix is fresh right now.
--
-- WHAT MAKES THEM SAFE, and it is the same evidence for both: the browser's
-- entire database surface is `public.plans` plus one RPC. Verified by counting
-- references in the shipped runtime --
--
--     plans                13
--     access_leases         1   (a comment)
--     strava_activities     0
--     strava_connections    0
--     beta_allowlist        0
--     entitlements          0
--     rpc/                  delete_own_account, and nothing else
--
-- -- so neither privilege below is exercised by any client code that ships.
--
-- IDEMPOTENT. Running it twice changes nothing.
-- REVERSIBLE. STEP 3 is the exact inverse of both.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 0 -- THE SWITCH
--
-- Change 'no' to 'yes' to apply. Nothing below runs while it says 'no'.
-- ---------------------------------------------------------------------------
create or replace function public._vvv_beta_hardening_authorised()
returns text language sql immutable as $$
  select 'no'::text;
$$;

do $$
begin
  if lower(trim(public._vvv_beta_hardening_authorised())) <> 'yes' then
    raise exception
      'ABORTED: edit STEP 0 to ''yes'' to apply the two hardening grants. They are optional and are not beta blockers. Nothing has been changed.';
  end if;
  raise notice 'Beta hardening authorised in STEP 0 -- proceeding.';
end $$;


-- ---------------------------------------------------------------------------
-- STEP 1 -- CLOSE THE ALLOWLIST MEMBERSHIP ORACLE
--
-- beta_email_approved(addr) answers "is this address an approved tester". It is
-- revoked from public and anon, but Supabase grants EXECUTE on new public
-- functions to `authenticated` by default, and that grant was never removed --
-- so a signed-in tester can call it through PostgREST for any address they care
-- to name.
--
-- WHAT IT ACTUALLY LEAKS, stated honestly: one bit about an address the caller
-- already has, to somebody already on the list. No plan, no token, no address
-- and no enumeration of the list itself. That is why it did not block the beta.
--
-- WHY REVOKING CANNOT BREAK RLS, which is the only reason this is safe to do
-- without a Preview cycle: the row-level policies do not call this function.
-- They call is_beta_approved(), which reads the caller's own JWT claim and is
-- SECURITY DEFINER -- so when its body calls beta_email_approved(), the
-- privilege check is made against the function OWNER, not against
-- `authenticated`. The owner's EXECUTE is untouched. is_beta_approved() keeps
-- its own grant to `authenticated` and keeps working unchanged.
--
-- The server side is unaffected for a different reason: it uses the service
-- key, which bypasses grants entirely.
-- ---------------------------------------------------------------------------
revoke execute on function public.beta_email_approved(text) from authenticated;

-- unchanged, and restated so this file cannot be read as narrowing it:
grant execute on function public.is_beta_approved() to authenticated;


-- ---------------------------------------------------------------------------
-- STEP 2 -- MAKE THE ACTIVITY POLICY MEAN WHAT ITS COMMENT SAYS
--
-- supabase-setup.sql describes the athlete's UPDATE on strava_activities as
-- "may only mark a row ingested". The policy does not implement that -- an
-- UPDATE policy authorises the ROW, never the COLUMN -- so a signed-in athlete
-- could rewrite `payload`, which the coaching engine treats as objective data.
--
-- IT IS ALSO STALE. That comment described client-side ingestion. Ingestion
-- moved to /api/strava-sync (handleAck), which PATCHes ingested_at with the
-- service key. The runtime has zero references to strava_activities, so the
-- athlete-facing privilege is not used by anything that ships.
--
-- Column-level UPDATE is the honest expression of the intent: the RLS policy
-- keeps deciding WHICH rows, and the grant decides WHICH columns. Both must
-- pass, so an athlete may still only touch their own rows, and on those rows
-- only the one field that means "the app has taken this in".
--
-- SELECT is left exactly as it is. It is also unused today, but reading one's
-- own staged activity is a capability the product may legitimately want back,
-- and removing a read nobody is harmed by is not hardening.
-- ---------------------------------------------------------------------------
revoke update on public.strava_activities from authenticated;
grant  update (ingested_at) on public.strava_activities to authenticated;


-- ---------------------------------------------------------------------------
-- STEP 3 -- VERIFY, then how to undo
--
-- Expected after running:
--   oracle_closed_expect_false        f
--   rls_predicate_intact_expect_true  t
--   payload_writable_expect_false     f
--   ingested_writable_expect_true     t
--   activity_policies_expect_2        2
-- ---------------------------------------------------------------------------
select
  has_function_privilege('authenticated', 'public.beta_email_approved(text)', 'EXECUTE')
                                                                    as oracle_closed_expect_false,
  has_function_privilege('authenticated', 'public.is_beta_approved()', 'EXECUTE')
                                                                    as rls_predicate_intact_expect_true,
  has_column_privilege('authenticated', 'public.strava_activities', 'payload', 'UPDATE')
                                                                    as payload_writable_expect_false,
  has_column_privilege('authenticated', 'public.strava_activities', 'ingested_at', 'UPDATE')
                                                                    as ingested_writable_expect_true,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'strava_activities') as activity_policies_expect_2;

-- ---------------------------------------------------------------------------
-- THE INVERSE. Restores both privileges exactly as they are today.
--
--   grant execute on function public.beta_email_approved(text) to authenticated;
--   revoke update (ingested_at) on public.strava_activities from authenticated;
--   grant  update on public.strava_activities to authenticated;
--
-- No policy is created or dropped by this script, so nothing about row
-- isolation is touched in either direction.
-- ---------------------------------------------------------------------------
