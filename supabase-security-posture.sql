-- ===========================================================================
-- THE SECURITY POSTURE, MADE REPRODUCIBLE AND MADE TO REFUSE
--
-- Four things, and each one is a live production advisor finding or a gap
-- between what production is and what this repository can rebuild.
--
--   1. RLS INIT-PLAN. Policies that call auth.uid() once per row become
--      policies that call it once per statement. Same rows, same permissions.
--   2. THE SERVICE-ONLY TABLES. Four tables run RLS with NO policies on
--      purpose, which is deny-all to every browser role. The advisor reports
--      that as INFO and the temptation is to add a policy and make the message
--      go away. This file makes the posture ASSERTED instead: if a client
--      policy ever appears on one of them, this refuses.
--   3. SECURITY DEFINER SEARCH PATHS. Both remaining definer functions are
--      pinned to the empty search path, which is the strictest available.
--   4. RLS EVERYWHERE. A fresh database rebuilt from this repository now
--      CHECKS that every table in public has row-level security on, rather
--      than relying on an event trigger the repository never contained.
--
-- NOTHING HERE WIDENS ANYTHING. No policy is created that did not exist, no
-- grant is added, no table is written to. Every statement either restates an
-- existing permission in a faster form, tightens a search path, or refuses.
--
-- Safe to re-run.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 -- THE INIT-PLAN REWRITE
--
-- A bare auth.uid() in a policy is evaluated ONCE PER ROW. Wrapped in a scalar
-- sub-select it becomes an InitPlan: evaluated once for the statement and
-- reused. That is what the performance advisor is pointing at.
--
-- IT CHANGES NO SEMANTICS, and that is checkable rather than hopeful.
-- auth.uid() is STABLE, takes no arguments and reads nothing from the row, so
-- its value cannot differ between rows of one statement. is_beta_approved() is
-- the same: STABLE, no arguments, reads the caller's own JWT claim. Hoisting
-- something that DID depend on the row would be wrong, and there is nothing of
-- that kind in any policy below.
--
-- THE BETA PREDICATE STAYS. `is_beta_approved()` is not decoration and it is
-- not obsolete: it is what closes the product to anybody not on the allowlist,
-- and public signup is closed. Dropping it here would open the beta as a side
-- effect of a performance fix. supabase-commercial-activation.sql is the file
-- that removes it, deliberately, on the day HQ opens the gate.
-- ---------------------------------------------------------------------------
do $$
declare has_gate boolean;
begin
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'is_beta_approved')
    into has_gate;

  -- plans
  execute 'drop policy if exists "own plan: select" on public.plans';
  execute 'drop policy if exists "own plan: insert" on public.plans';
  execute 'drop policy if exists "own plan: update" on public.plans';
  if has_gate then
    execute 'create policy "own plan: select" on public.plans for select
               using ((select auth.uid()) = user_id and (select public.is_beta_approved()))';
    execute 'create policy "own plan: insert" on public.plans for insert
               with check ((select auth.uid()) = user_id and (select public.is_beta_approved()))';
    execute 'create policy "own plan: update" on public.plans for update
               using ((select auth.uid()) = user_id and (select public.is_beta_approved()))
               with check ((select auth.uid()) = user_id and (select public.is_beta_approved()))';
  else
    /* Only reachable AFTER commercial activation has deliberately removed the
       gate. This branch must never be how the gate disappears. */
    execute 'create policy "own plan: select" on public.plans for select
               using ((select auth.uid()) = user_id)';
    execute 'create policy "own plan: insert" on public.plans for insert
               with check ((select auth.uid()) = user_id)';
    execute 'create policy "own plan: update" on public.plans for update
               using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)';
  end if;

  -- strava_activities
  execute 'drop policy if exists "own activities: select" on public.strava_activities';
  execute 'drop policy if exists "own activities: update" on public.strava_activities';
  if has_gate then
    execute 'create policy "own activities: select" on public.strava_activities for select
               using ((select auth.uid()) = user_id and (select public.is_beta_approved()))';
    execute 'create policy "own activities: update" on public.strava_activities for update
               using ((select auth.uid()) = user_id and (select public.is_beta_approved()))
               with check ((select auth.uid()) = user_id and (select public.is_beta_approved()))';
  else
    execute 'create policy "own activities: select" on public.strava_activities for select
               using ((select auth.uid()) = user_id)';
    execute 'create policy "own activities: update" on public.strava_activities for update
               using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)';
  end if;

  -- entitlements: read-own, and there has never been a write policy
  execute 'drop policy if exists "read own entitlement" on public.entitlements';
  execute 'create policy "read own entitlement" on public.entitlements for select
             using ((select auth.uid()) = user_id)';

  raise notice 'Policies rewritten to the InitPlan form. Beta gate present: %', has_gate;
end $$;


-- ---------------------------------------------------------------------------
-- STEP 2 -- THE SERVICE-ONLY TABLES, ASSERTED RATHER THAN SILENCED
--
-- Four tables carry RLS with no policies. In Postgres that is deny-all: every
-- request made with the anon or authenticated role is refused, including a
-- correctly signed-in athlete's own. Only the service key inside the Vercel
-- functions reaches them, which is the design.
--
--   access_leases        the delivery credential. A lease an athlete could
--                        read is a lease an athlete could forge the shape of;
--                        a lease they could write is unlimited access.
--   beta_allowlist       who is invited. Readable by a tester it would be an
--                        enumeration of everybody else's address.
--   billing_events       the money ledger. Nothing about it is the athlete's
--                        to see, and everything about it is ours to keep
--                        exactly as the provider told us.
--   strava_connections   OAuth access and refresh tokens. Not reachable from
--                        any browser, any export or any other session.
--
-- ADDING A POLICY TO SILENCE THE LINT IS THE ONLY WAY TO MAKE THESE LESS SAFE
-- THAN THEY ARE. So this does the opposite: it refuses if anybody has.
-- ---------------------------------------------------------------------------
do $$
declare t text; bad text := ''; missing text := ''; n integer;
begin
  foreach t in array array['access_leases','beta_allowlist','billing_events','strava_connections']
  loop
    if not exists (select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                    where ns.nspname = 'public' and c.relname = t) then
      continue;   -- not every database has every table yet
    end if;

    if not (select c.relrowsecurity from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
             where ns.nspname = 'public' and c.relname = t) then
      missing := missing || t || ' ';
    end if;

    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t;
    if n > 0 then bad := bad || t || '(' || n || ') '; end if;
  end loop;

  if missing <> '' then
    raise exception using errcode = 'raise_exception',
      message = 'ABORTED: row-level security is OFF on: ' || missing,
      hint    = 'These tables are reachable only by the service key by design. '
                'Turn RLS on before running this. Nothing has been changed.';
  end if;
  if bad <> '' then
    raise exception using errcode = 'raise_exception',
      message = 'ABORTED: a client policy exists on a service-only table: ' || bad,
      hint    = 'RLS with no policy is deny-all, which is the intended posture. '
                'A policy here is a widening, not a lint fix. Nothing has been changed.';
  end if;
  raise notice 'Service-only posture intact on all four tables.';
end $$;


-- ---------------------------------------------------------------------------
-- STEP 3 -- THE TWO SECURITY DEFINER FUNCTIONS
--
-- Both are audited and both are KEPT. What changes is the search path.
--
-- WHY THE EMPTY SEARCH PATH IS STRICTER THAN `public, auth`. pg_catalog is
-- searched implicitly, and FIRST, unless it is named -- so naming schemas after
-- it is what lets a table in one of them shadow a builtin. An empty path leaves
-- only that implicit pg_catalog entry, which resolves the builtins these
-- functions use (lower, trim, coalesce, exists) and resolves nothing else. Both
-- bodies already qualify every object they touch, so nothing is left to
-- resolve by search. This was checked by applying it and calling them, not by
-- reading the manual.
--
-- delete_own_account()  the ONLY RPC the application calls, and how an athlete
--                       exercises erasure. It reads auth.uid() and nothing
--                       else, so it cannot be pointed at another account; with
--                       no session auth.uid() is null and it raises. EXECUTE is
--                       revoked from public and anon and granted only to
--                       authenticated. Retained, and restated below.
--
-- is_beta_approved()    the predicate inside the live row-level policies. A
--                       policy expression is evaluated with the CALLER's
--                       privileges, so revoking this from `authenticated` would
--                       make every signed-in read and write fail -- it is a
--                       load-bearing grant, not a leftover. Still required
--                       because public signup is closed. Retained.
--
-- beta_email_approved(text) is is_beta_approved()'s implementation and answers
--                       the same question about an address the CALLER names,
--                       which is why `authenticated` does not hold EXECUTE on
--                       it. The definer boundary is what lets is_beta_approved
--                       call it anyway. Restated so a re-grant stands out.
-- ---------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'delete_own_account') then
    execute 'alter function public.delete_own_account() set search_path = ''''';
    execute 'revoke all on function public.delete_own_account() from public, anon';
    execute 'grant execute on function public.delete_own_account() to authenticated';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'is_beta_approved') then
    execute 'alter function public.is_beta_approved() set search_path = ''''';
    execute 'revoke all on function public.is_beta_approved() from public, anon';
    execute 'grant execute on function public.is_beta_approved() to authenticated';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'beta_email_approved') then
    execute 'alter function public.beta_email_approved(text) set search_path = ''''';
    execute 'revoke all on function public.beta_email_approved(text) from public, anon, authenticated';
  end if;
  raise notice 'Definer functions pinned to the empty search path.';
end $$;

-- The check that matters more than the lint: can a signed-in caller still
-- evaluate the predicate its own row-level policies depend on?
do $$
declare ok text;
begin
  begin
    set local role authenticated;
    perform public.is_beta_approved();
    ok := 'evaluates fine';
  exception when others then ok := 'BROKEN: ' || sqlerrm;
  end;
  reset role;
  if ok <> 'evaluates fine' then
    raise exception using errcode = 'raise_exception',
      message = 'ABORTED: authenticated can no longer evaluate the RLS predicate -- ' || ok,
      hint    = 'Every signed-in read and write would fail. Revert the search_path pin.';
  end if;
  raise notice 'authenticated can still evaluate the RLS predicate.';
end $$;


-- ---------------------------------------------------------------------------
-- STEP 4 -- RLS EVERYWHERE, WITHOUT DEPENDING ON A HELPER THE REPOSITORY
--          NEVER CONTAINED
--
-- supabase-pre-beta-least-privilege.sql revokes EXECUTE on public.rls_auto_enable(),
-- an event-trigger function that turns RLS on for any newly created table. That
-- function was created by hand in production and its definition was never in
-- this repository -- so a database rebuilt from these files could not run that
-- migration, and the repository could not reproduce production.
--
-- THE HELPER IS THE SMALLER HALF OF THE ANSWER. Every table this repository
-- creates already carries an explicit `enable row level security`, so a fresh
-- rebuild reaches the intended posture from the explicit statements and does
-- not need the trigger to get there. What the trigger adds is a net under
-- tables created LATER, by hand, in the dashboard -- which is a real thing that
-- happens and is exactly when somebody forgets.
--
-- So both: the definition below, and the assertion after it that does not
-- depend on it.
--
-- IT MAY REFUSE TO INSTALL. Creating an event trigger requires superuser, and a
-- managed Postgres may not grant that. That is caught and reported rather than
-- failing the migration, because the assertion below is the part that actually
-- guarantees the posture.
-- ---------------------------------------------------------------------------
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare obj record;
begin
  for obj in select * from pg_catalog.pg_event_trigger_ddl_commands()
  loop
    if obj.command_tag = 'CREATE TABLE'
       and obj.schema_name = 'public'
       and obj.object_type = 'table' then
      execute 'alter table ' || obj.object_identity || ' enable row level security';
    end if;
  end loop;
end $$;

-- No legitimate caller invokes an event-trigger function directly; only
-- somebody probing would. Postgres checks EXECUTE when the trigger is CREATED,
-- not each time it fires, so revoking cannot stop it working.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    begin
      execute 'create event trigger ensure_rls on ddl_command_end
                 when tag in (''CREATE TABLE'')
                 execute function public.rls_auto_enable()';
      raise notice 'Event trigger ensure_rls installed.';
    exception when insufficient_privilege then
      raise notice 'Event trigger ensure_rls NOT installed: creating one needs superuser on this server. The assertion below is what guarantees the posture; run it after adding any table by hand.';
    end;
  else
    raise notice 'Event trigger ensure_rls already present.';
  end if;
end $$;

-- THE ASSERTION. This is the part that does not depend on any helper: every
-- ordinary table in `public` must have row-level security on. A fresh database
-- built from this repository passes it, which is what "reproduces production's
-- security posture" has to mean.
do $$
declare naked text := '';
begin
  select coalesce(string_agg(c.relname, ' ' order by c.relname), '')
    into naked
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if naked <> '' then
    raise exception using errcode = 'raise_exception',
      message = 'ABORTED: these public tables have row-level security OFF: ' || naked,
      hint    = 'Every table holding athlete data must have RLS on before this passes.';
  end if;
  raise notice 'Every table in public has row-level security enabled.';
end $$;


-- ---------------------------------------------------------------------------
-- DELIBERATELY NOT DONE HERE, and why
--
-- 1. auth_leaked_password_protection. An Auth dashboard setting, not SQL, and
--    it is NOT vacuous: the product has no password path anywhere -- sign-in is
--    a magic link -- but one account carries a real bcrypt hash from before
--    that was true. So the honest position is that the warning applies to
--    exactly one credential that no product surface can use. Turning the
--    setting on costs nothing and removes the question; inventing a password
--    UX to satisfy a lint would be adding an attack surface to clear a warning
--    about an attack surface.
--
-- 2. UNUSED INDEXES. The advisor reports several as unused. They are unused
--    because the beta has three accounts and commerce is closed, not because
--    nothing will ever read them -- subscriptions_live_idx serves the
--    duplicate-purchase check and the expiry sweep, and neither has run in
--    anger yet. Dropping an index on the evidence of an empty table is how the
--    first busy week becomes a sequential scan.
--
-- 3. supabase-beta-hardening.sql STEP 2 -- revoking UPDATE on
--    strava_activities from `authenticated` and granting only the ingested_at
--    column. A real narrowing, still behind its author's explicit switch, and
--    not an advisor finding. It needs that authorisation rather than a quiet
--    inclusion here.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- VERIFY. Read-only.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_policies where schemaname = 'public'
    and qual like '%( SELECT auth.uid()%')                                as policies_hoisted,
  (select count(*) from pg_policies where schemaname = 'public'
    and (qual ~ '(^|[^.])auth\.uid\(\)' and qual not like '%( SELECT auth.uid()%'))
                                                                          as policies_still_per_row,
  (select count(*) from pg_policies where schemaname = 'public'
    and tablename in ('access_leases','beta_allowlist','billing_events','strava_connections'))
                                                                          as service_only_policies_expect_0,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)
                                                                          as tables_without_rls_expect_0,
  (select coalesce(array_to_string(proconfig, ','), '(none)') from pg_proc
    where oid = 'public.delete_own_account()'::regprocedure)              as delete_own_account_search_path,
  (select coalesce(array_to_string(proconfig, ','), '(none)') from pg_proc
    where oid = 'public.is_beta_approved()'::regprocedure)                as is_beta_approved_search_path,
  has_function_privilege('authenticated','public.delete_own_account()','EXECUTE') as delete_kept_expect_true,
  has_function_privilege('authenticated','public.is_beta_approved()','EXECUTE')   as gate_kept_expect_true,
  has_function_privilege('anon','public.delete_own_account()','EXECUTE')          as delete_open_to_anon_expect_false,
  has_function_privilege('authenticated','public.beta_email_approved(text)','EXECUTE') as oracle_open_expect_false,
  (select evtenabled::text from pg_event_trigger where evtname = 'ensure_rls')    as ensure_rls_expect_O;
