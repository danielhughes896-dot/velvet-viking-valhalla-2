-- ===========================================================================
-- PUBLIC SIGN-UP, AS A SWITCH THE DATABASE ITSELF READS
--
-- Founder, 18 November 2026: "It's on Vercel so only I can send it to people.
-- So make it as if it's ready to go." The app is reachable only by people the
-- founder sends the link to, so sign-up must work for anyone who reaches it,
-- as it will at launch: no invitation needed. And it must be a SWITCH, so it
-- can be turned back without a code change or a migration.
--
-- WHY THE SWITCH LIVES HERE AND NOT IN VERCEL. The thing that actually refuses
-- an uninvited address is beta_allowlist_gate, a BEFORE INSERT trigger on
-- auth.users (supabase-beta-gate.sql STEP 4a). /api/beta-signin is not the
-- gate and never was: the publishable key is public, so anyone can ask GoTrue
-- for an account directly. A Vercel variable cannot be read by a trigger, so a
-- switch kept there would be a second authority that the real gate ignores --
-- the route saying "open" while the database says "closed", which is the exact
-- shape of the fortnight public signup stayed shut after the cutover (see
-- test/publicSignIn.test.js). One row, read by the trigger, by the row-level
-- predicate and, for its wording only, by the server, cannot disagree with
-- itself.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE CHANGES, AND NOTHING ELSE
--
--   1. public.signup_settings     NEW. One row (id = 1), public_signup boolean.
--                                 RLS on with no policies, and no browser role
--                                 holds any privilege on it. The server's key
--                                 may READ it (for wording); only the SQL
--                                 editor can change it.
--   2. public.public_signup_open() NEW. True only while that row says so.
--                                 A missing row reads as false: closed.
--   3. public.enforce_beta_allowlist()  REDEFINED, same name, same refusal,
--                                 same message, same errcode. It now asks
--                                 public_signup_open() first and, while the
--                                 switch is on, admits any address.
--   4. public.is_beta_approved()  REDEFINED, same name, same grants. True while
--                                 the switch is on; otherwise exactly what it
--                                 was (the caller's JWT email on the
--                                 allowlist). This matters only if the five
--                                 plans / strava_activities policies still
--                                 carry the beta predicate (that is, if
--                                 supabase-retire-beta-rls.sql has not been
--                                 applied): then an athlete who signed up while
--                                 the switch is on can read and write their
--                                 OWN plan. The ownership half of every policy,
--                                 (select auth.uid()) = user_id, is untouched,
--                                 so nobody reaches anybody else's rows.
--   5. beta_allowlist_gate        RE-ATTACHED (drop if exists, then create, as
--                                 supabase-beta-gate.sql does), so the switch
--                                 is what decides, in both directions. The
--                                 trigger is KEPT: turning the switch off
--                                 restores the allowlist gate at once.
--
-- WHAT THE SWITCH IS SET TO WHEN THIS FILE RUNS: WHAT THE DATABASE ALREADY
-- DOES. The row is seeded once, and never again (on conflict do nothing):
--     gate trigger attached now  -> public_signup = false  (closed, as now)
--     gate trigger absent now    -> public_signup = true   (open, as now:
--                                   supabase-commercial-cutover.sql dropped it)
-- So applying this file changes nobody's ability to sign up. Opening sign-up
-- is the one UPDATE under "TURN IT ON", run separately and deliberately.
--
-- WHAT THIS FILE DOES NOT DO, each deliberate:
--   * grant anything. entitlements, entitlement_grants, subscriptions and
--     account_commercial are not read or written. An account created while
--     the switch is on holds exactly what any new account holds: an
--     account_commercial row (seed_account_commercial_on_signup), no trial
--     consumed, no entitlement. Whether it may USE SACORO is decided by
--     resolveAccess() in api/_access.js, as for everybody: admitted while
--     VVV_COMMERCIAL_REQUIRED is off, sent to the seven-day trial while on.
--   * touch the allowlist's rows, or any row-level policy, or any other
--     trigger on auth.users.
--   * drop anything. No trigger, function, table or policy is removed.
--   * change the meaning of any file already applied. Those files are not
--     edited; this one redefines two functions in place, and the ROLL BACK
--     section below puts both bodies back exactly.
--
-- IDEMPOTENT. create ... if not exists, create or replace, drop-if-exists then
-- create, and a seed that never overwrites. Running it twice leaves the same
-- objects and the SAME SWITCH VALUE. Transactional: a failure changes nothing.
--
-- PROVED ON A DISPOSABLE POSTGRES (never against production) by
--   tools/db-proof/full-chain.sh tools/db-proof/public-signup-proof.sql
-- which rebuilds the whole schema, applies this file twice, and then acts as
-- real people with the switch off, on, and off again, and over a database the
-- cutover had already opened.
--
-- ---------------------------------------------------------------------------
-- TURN IT ON (open sign-up to any address). Run on its own, in the SQL editor:
--
--   update public.signup_settings
--      set public_signup = true, changed_at = now(),
--          note = 'opened: founder decision 18 November 2026'
--    where id = 1;
--
-- TURN IT BACK OFF (invitation only again; the allowlist decides):
--
--   update public.signup_settings
--      set public_signup = false, changed_at = now(),
--          note = 'closed: <why>'
--    where id = 1;
--
-- Either takes effect on the very next sign-up attempt. No redeploy. Accounts
-- created while it was on keep their account; with it off, they are treated
-- as any address not on the allowlist (their own plan rows are refused again
-- if the beta predicate is still in the policies), so add them to
-- beta_allowlist if they should keep cloud sync.
--
-- ---------------------------------------------------------------------------
-- VERIFY. Read-only; the last statement of this file runs it, and it can be
-- pasted again at any time. Every column names the value that is right:
--
--   public_signup                      true once you have turned it on
--   gate_trigger_attached_expect_true  the trigger is on auth.users, enabled
--   gate_reads_switch_expect_true      the trigger asks the switch first
--   rls_predicate_reads_switch_expect_true
--   settings_rls_on_expect_true / settings_policies_expect_0
--   browser_can_read_switch_expect_false / browser_can_call_switch_expect_false
--   server_key_can_change_switch_expect_false
--   commercial_seed_intact_expect_true seed_account_commercial_on_signup
--   beta_predicate_policies            5 = the policies still carry the beta
--                                      clause (and now read the switch through
--                                      it); 0 = supabase-retire-beta-rls.sql
--                                      already made them ownership-only. Both
--                                      are fine; it is reported, not judged.
--
-- And the live check: with it on, request a link for an address you control
-- that is NOT on beta_allowlist, open it, and confirm the account exists.
--
-- ---------------------------------------------------------------------------
-- ROLL BACK (remove the switch itself; turning it off is usually enough).
-- Puts both functions back exactly as supabase-beta-gate.sql and
-- supabase-security-posture.sql left them, then removes the switch:
--
--   begin;
--   create or replace function public.enforce_beta_allowlist()
--   returns trigger language plpgsql security definer
--   set search_path = public, auth as $$
--   begin
--     if not public.beta_email_approved(new.email) then
--       raise exception 'velvet_viking_private_beta: address not authorised'
--         using errcode = '42501';
--     end if;
--     return new;
--   end; $$;
--   create or replace function public.is_beta_approved()
--   returns boolean language sql stable security definer
--   set search_path = '' as $$
--     select public.beta_email_approved(coalesce(auth.jwt() ->> 'email', ''));
--   $$;
--   drop function if exists public.public_signup_open();
--   drop table if exists public.signup_settings;
--   commit;
--
-- If the gate trigger was ABSENT before this file ran (the cutover had dropped
-- it) and you want that state back as well, add, inside the transaction:
--   drop trigger if exists beta_allowlist_gate on auth.users;
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- STEP 0 -- REFUSE TO RUN AGAINST A SHAPE THIS WAS NOT WRITTEN FOR
--
-- The gate this file puts a switch on must already exist: the allowlist and
-- its lookup are supabase-beta-gate.sql. Without them there is nothing to
-- switch, and inventing them here would be a second copy of that file.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.beta_allowlist') is null then
    raise exception 'ABORTED: public.beta_allowlist is missing. Apply supabase-beta-gate.sql first. Nothing has been changed.';
  end if;
  if to_regprocedure('public.beta_email_approved(text)') is null then
    raise exception 'ABORTED: public.beta_email_approved(text) is missing. Apply supabase-beta-gate.sql first. Nothing has been changed.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'ABORTED: auth.users is missing. This is not a Supabase database. Nothing has been changed.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- STEP 1 -- THE SWITCH
--
-- One row, enforced by the check on id, so there is never a question of which
-- row is the setting. Service-only: RLS on with no policies (deny-all to the
-- browser roles), and their table privileges revoked as well, so the switch is
-- neither readable nor writable from a browser even if a policy were added by
-- mistake. The server's key may SELECT it, to choose its wording; it may not
-- change it. Changing who may sign up is a decision made in the SQL editor.
-- ---------------------------------------------------------------------------
create table if not exists public.signup_settings (
  id            smallint    primary key default 1 check (id = 1),
  public_signup boolean     not null default false,
  changed_at    timestamptz not null default now(),
  note          text
);

alter table public.signup_settings enable row level security;
-- No policies on purpose. Do not add one.

revoke all on table public.signup_settings from public, anon, authenticated, service_role;
grant select on table public.signup_settings to service_role;

comment on table public.signup_settings is
  'THE PUBLIC SIGN-UP SWITCH (supabase-public-signup.sql). One row. public_signup = true: '
  'beta_allowlist_gate admits any address. false: only addresses on beta_allowlist may '
  'create an account. Read by the trigger, by is_beta_approved() and (for wording only) by '
  '/api/beta-signin. Changed only in the SQL editor. Grants no product access: that is '
  'decided by the entitlements model.';

/* SEEDED ONCE, TO WHAT THE DATABASE ALREADY DOES. Before the trigger is
   re-attached in STEP 4, so this reads the state the file found, not the state
   it is about to make. on conflict do nothing: a second run never resets a
   switch somebody has since turned. */
insert into public.signup_settings (id, public_signup, note)
select 1,
       not exists (
         select 1 from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'auth' and c.relname = 'users'
            and t.tgname = 'beta_allowlist_gate'
            and not t.tgisinternal and t.tgenabled <> 'D'),
       'seeded by supabase-public-signup.sql to match what the database did when it ran'
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- STEP 2 -- THE QUESTION, ASKED ONE WAY EVERYWHERE
--
-- SECURITY DEFINER so the trigger and the RLS predicate can read a table the
-- caller cannot; the empty search path and the fully qualified name close the
-- usual definer hijack (the posture supabase-security-posture.sql set for the
-- other definer functions). No browser role may call it: nothing about who
-- may sign up is a browser's question.
-- ---------------------------------------------------------------------------
create or replace function public.public_signup_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.public_signup from public.signup_settings s where s.id = 1), false);
$$;

revoke all on function public.public_signup_open() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- STEP 3 -- THE GATE AND THE PREDICATE CONSULT THE SWITCH
--
-- The gate's refusal is word for word what it was: same message, same
-- errcode, so GoTrue reports it exactly as before ("Database error saving new
-- user") and the app's private-beta sentence still follows it while the switch
-- is off. The search path moves to the empty one, as for the other definer
-- functions; every name in the body is qualified.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_beta_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- PUBLIC SIGN-UP ON: any address may become an account. What it may then
  -- USE is decided by the entitlements model, not here.
  if public.public_signup_open() then
    return new;
  end if;
  if not public.beta_email_approved(new.email) then
    raise exception 'velvet_viking_private_beta: address not authorised'
      using errcode = '42501';   -- insufficient_privilege
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_beta_allowlist() from public, anon, authenticated;

/* The predicate inside the row-level policies, where it still is. Ownership is
   not here and never was: it is the (select auth.uid()) = user_id half of each
   policy, which this file does not touch. */
create or replace function public.is_beta_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.public_signup_open()
      or public.beta_email_approved(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- The grants supabase-beta-gate.sql and supabase-security-posture.sql set,
-- restated: a policy expression runs with the CALLER's privileges, so
-- authenticated must keep EXECUTE or every signed-in read and write fails.
revoke all on function public.is_beta_approved() from public, anon;
grant execute on function public.is_beta_approved() to authenticated;


-- ---------------------------------------------------------------------------
-- STEP 4 -- THE GATE STAYS ATTACHED, SO THE SWITCH DECIDES BOTH WAYS
-- ---------------------------------------------------------------------------
drop trigger if exists beta_allowlist_gate on auth.users;
create trigger beta_allowlist_gate
  before insert on auth.users
  for each row execute function public.enforce_beta_allowlist();

comment on table public.beta_allowlist is
  'Who was invited to the private beta. While public.signup_settings.public_signup is false, '
  'only these addresses may create an account (beta_allowlist_gate). While it is true, any '
  'address may. Never a grant of product access.';


-- ---------------------------------------------------------------------------
-- STEP 5 -- PROVE IT, BEFORE COMMITTING
-- ---------------------------------------------------------------------------
do $$
declare n int; src text;
begin
  if (select count(*) from public.signup_settings) <> 1 then
    raise exception 'ABORTED: signup_settings must hold exactly one row. Nothing has been changed.';
  end if;

  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'auth' and c.relname = 'users'
       and t.tgname = 'beta_allowlist_gate' and not t.tgisinternal and t.tgenabled <> 'D'
  ) then
    raise exception 'ABORTED: the gate trigger is not attached to auth.users. Nothing has been changed.';
  end if;

  select prosrc into src from pg_proc where oid = 'public.enforce_beta_allowlist()'::regprocedure;
  if src not like '%public.public_signup_open()%' or src not like '%velvet_viking_private_beta%' then
    raise exception 'ABORTED: the gate does not consult the switch, or lost its refusal. Nothing has been changed.';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.signup_settings'::regclass) then
    raise exception 'ABORTED: row-level security is off on signup_settings. Nothing has been changed.';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'signup_settings';
  if n <> 0 then
    raise exception 'ABORTED: signup_settings has % polic(ies); it must have none. Nothing has been changed.', n;
  end if;

  if has_table_privilege('anon', 'public.signup_settings', 'SELECT')
     or has_table_privilege('authenticated', 'public.signup_settings', 'SELECT')
     or has_table_privilege('anon', 'public.signup_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.signup_settings', 'UPDATE')
     or has_table_privilege('service_role', 'public.signup_settings', 'UPDATE')
     or has_table_privilege('service_role', 'public.signup_settings', 'INSERT')
     or has_table_privilege('service_role', 'public.signup_settings', 'DELETE') then
    raise exception 'ABORTED: a browser role can read the switch, or something other than the SQL editor can change it. Nothing has been changed.';
  end if;
  if has_function_privilege('anon', 'public.public_signup_open()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.public_signup_open()', 'EXECUTE') then
    raise exception 'ABORTED: a browser role can call public_signup_open(). Nothing has been changed.';
  end if;
  if not has_function_privilege('authenticated', 'public.is_beta_approved()', 'EXECUTE') then
    raise exception 'ABORTED: authenticated lost EXECUTE on the RLS predicate; every signed-in read would fail. Nothing has been changed.';
  end if;

  raise notice 'public sign-up switch installed; it reads %',
    case when public.public_signup_open() then 'ON (any address may sign up)'
         else 'OFF (allowlist only)' end;
end $$;

commit;


-- ---------------------------------------------------------------------------
-- VERIFY. Read-only. See the header for what each column should read.
-- ---------------------------------------------------------------------------
select
  (select public_signup from public.signup_settings where id = 1)              as public_signup,
  (select changed_at    from public.signup_settings where id = 1)              as switch_changed_at,
  exists (select 1 from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'auth' and c.relname = 'users'
             and t.tgname = 'beta_allowlist_gate'
             and not t.tgisinternal and t.tgenabled <> 'D')                    as gate_trigger_attached_expect_true,
  (select prosrc like '%public_signup_open%' from pg_proc
    where oid = 'public.enforce_beta_allowlist()'::regprocedure)               as gate_reads_switch_expect_true,
  (select prosrc like '%public_signup_open%' from pg_proc
    where oid = 'public.is_beta_approved()'::regprocedure)                     as rls_predicate_reads_switch_expect_true,
  (select relrowsecurity from pg_class
    where oid = 'public.signup_settings'::regclass)                            as settings_rls_on_expect_true,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'signup_settings')             as settings_policies_expect_0,
  (has_table_privilege('anon', 'public.signup_settings', 'SELECT')
   or has_table_privilege('authenticated', 'public.signup_settings', 'SELECT')) as browser_can_read_switch_expect_false,
  (has_function_privilege('anon', 'public.public_signup_open()', 'EXECUTE')
   or has_function_privilege('authenticated', 'public.public_signup_open()', 'EXECUTE')) as browser_can_call_switch_expect_false,
  has_table_privilege('service_role', 'public.signup_settings', 'UPDATE')      as server_key_can_change_switch_expect_false,
  exists (select 1 from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'auth' and c.relname = 'users'
             and t.tgname = 'seed_account_commercial_on_signup')               as commercial_seed_intact_expect_true,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename in ('plans', 'strava_activities')
      and coalesce(qual, '') || coalesce(with_check, '') like '%is_beta_approved%') as beta_predicate_policies;
