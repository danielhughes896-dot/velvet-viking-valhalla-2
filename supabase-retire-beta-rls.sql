-- ===========================================================================
-- RETIRE THE BETA PREDICATE FROM ROW AUTHORIZATION
--
-- WHAT IS WRONG IN PRODUCTION. Five row-level policies still read
-- is_beta_approved(), which resolves the caller's JWT email against
-- public.beta_allowlist:
--
--   plans              select / insert / update
--   strava_activities  select / update
--
-- So a newly authenticated athlete who was never in the private beta cannot
-- read, create or update THEIR OWN plan. The builder's cloud push is refused
-- with 403 and the app reports "Your private-beta access has ended" -- to
-- somebody who has never been in a beta. The commercial journey cannot
-- complete while this is true.
--
-- WHY A NEW FILE RATHER THAN supabase-commercial-activation.sql. That file
-- also seeds entitlements, retires a signup trigger and rewrites overrides --
-- work the cutover and projection migrations have already done, in their own
-- way, against this database. Re-running it would replay commercial history
-- over the top of the current state. This is STEP 3 of it and nothing else.
--
-- WHAT THIS CHANGES: the beta clause, in five predicates. That is all.
--
-- WHAT THIS DOES NOT CHANGE, each deliberate:
--   * ownership. Every predicate keeps (select auth.uid()) = user_id, so an
--     athlete reaches their own rows and no other athlete's. Removing the beta
--     clause narrows nothing and widens nothing except who counts as a
--     legitimate owner.
--   * the ABSENT policies. plans has no DELETE policy and strava_activities
--     has no INSERT policy, so those remain denied to every browser role. A
--     migration that "tidied up" by adding them would hand the client two
--     abilities it has never had.
--   * strava_connections, which has RLS on and no policies at all: deny-all to
--     every browser role, so the OAuth tokens stay unreachable from a session.
--   * the roles. The policies apply TO PUBLIC exactly as they do now. An
--     anonymous caller has auth.uid() = null, null = user_id is null, and a
--     null predicate admits no rows -- so anonymous stays denied by the
--     ownership clause itself rather than by a role list.
--   * entitlements, grants, subscriptions, account_commercial: untouched.
--     Nothing here decides whether anybody may USE Valhalla. resolveAccess()
--     still refuses an authenticated athlete with no entitlement, and that is
--     the separation this migration must not blur -- owning your rows in the
--     database is not the same as being allowed through the product's door.
--   * is_beta_approved() and beta_email_approved() themselves, which are left
--     installed with their grants intact. Nothing authorises on them after
--     this runs; they stay so the beta's history remains inspectable and so
--     re-closing signup in an emergency does not need a function rebuilt from
--     git.
--
-- IDEMPOTENT. drop-if-exists then create, so a second run leaves the same five
-- policies. Transactional, so a failure leaves the old ones in place.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- STEP 0 -- REFUSE TO RUN AGAINST A SHAPE THIS WAS NOT WRITTEN FOR
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.plans') is null or to_regclass('public.strava_activities') is null then
    raise exception 'refusing: plans or strava_activities is missing';
  end if;
  -- RLS itself must already be on. This migration rewrites predicates; it is
  -- not the thing that turns row security on, and silently running against a
  -- table with RLS off would leave every row readable.
  if not (select relrowsecurity from pg_class where oid = 'public.plans'::regclass) then
    raise exception 'refusing: RLS is not enabled on public.plans';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.strava_activities'::regclass) then
    raise exception 'refusing: RLS is not enabled on public.strava_activities';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 1 -- OWNERSHIP ONLY
--
-- (select auth.uid()) rather than auth.uid(): the subselect is evaluated once
-- per statement instead of once per row, which is the documented performance
-- shape for this and is how the current policies are already written.
-- ---------------------------------------------------------------------------
drop policy if exists "own plan: select" on public.plans;
drop policy if exists "own plan: insert" on public.plans;
drop policy if exists "own plan: update" on public.plans;

create policy "own plan: select" on public.plans
  for select using ((select auth.uid()) = user_id);
create policy "own plan: insert" on public.plans
  for insert with check ((select auth.uid()) = user_id);
create policy "own plan: update" on public.plans
  for update using ((select auth.uid()) = user_id)
          with check ((select auth.uid()) = user_id);

drop policy if exists "own activities: select" on public.strava_activities;
drop policy if exists "own activities: update" on public.strava_activities;

create policy "own activities: select" on public.strava_activities
  for select using ((select auth.uid()) = user_id);
create policy "own activities: update" on public.strava_activities
  for update using ((select auth.uid()) = user_id)
          with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- STEP 2 -- PROVE IT, BEFORE COMMITTING
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  -- No beta clause survives anywhere in row authorization.
  select count(*) into n from pg_policies
   where coalesce(qual,'') || coalesce(with_check,'') like '%is_beta_approved%';
  if n <> 0 then
    raise exception '% policies still impose beta membership', n;
  end if;

  -- Ownership is still required everywhere. A policy that lost its user_id
  -- clause would have made the table public, which is the one mistake this
  -- migration could make and the one worth failing on.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('plans','strava_activities')
     and coalesce(qual,'') || coalesce(with_check,'') not like '%user_id%';
  if n <> 0 then
    raise exception '% policies no longer check row ownership', n;
  end if;

  -- Exactly the policies that existed before, no more and no fewer: three on
  -- plans, two on strava_activities. plans still has no DELETE and
  -- strava_activities still has no INSERT.
  select count(*) into n from pg_policies where schemaname='public' and tablename='plans';
  if n <> 3 then raise exception 'plans has % policies, expected 3', n; end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='plans' and cmd='DELETE';
  if n <> 0 then raise exception 'a DELETE policy was added to plans'; end if;

  select count(*) into n from pg_policies where schemaname='public' and tablename='strava_activities';
  if n <> 2 then raise exception 'strava_activities has % policies, expected 2', n; end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='strava_activities' and cmd='INSERT';
  if n <> 0 then raise exception 'an INSERT policy was added to strava_activities'; end if;

  -- The token table stays unreachable from any browser session.
  select count(*) into n from pg_policies where schemaname='public' and tablename='strava_connections';
  if n <> 0 then raise exception 'strava_connections gained % policies', n; end if;

  raise notice 'row authorization is ownership only; beta membership no longer required';
end $$;

commit;
