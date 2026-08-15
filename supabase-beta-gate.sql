-- Velvet Viking — PRIVATE BETA ACCESS GATE
--
-- Run this once in the Supabase project: SQL Editor -> New query -> paste -> Run.
-- It is idempotent: running it twice changes nothing.
--
-- ===========================================================================
-- BEFORE YOU RUN IT: EDIT STEP 2.
-- ===========================================================================
-- Step 2 is the only part you have to change. Replace the five placeholder
-- addresses with the real tester addresses, and include the address the
-- existing athlete/owner signs in with if they need cloud access -- if their
-- address is missing, step 4 locks them out of their own backup.
--
-- You cannot get this wrong silently. Step 3 is a safety gate that ABORTS the
-- whole run if any @example.com placeholder is still present or the list is
-- empty, and step 4 -- the part that makes access conditional -- is never
-- reached. The failure mode is "nothing changed", not "nobody can sign in".
--
-- On success the last statement prints how many testers are active. Check that
-- number is what HQ authorised before telling anyone the beta is open.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 1. The allowlist itself.
--
-- RLS is ON with NO policies, exactly like strava_connections. In Postgres
-- that denies every request made with the anon or authenticated role, so the
-- list of beta testers is not readable by any browser -- including a signed-in
-- tester's own session. Only the service_role key held inside the Vercel
-- functions, and the SQL editor, can see or change it.
--
-- Revocation is a timestamp rather than a delete, so removing one tester is a
-- single reversible statement that leaves the other four untouched and leaves
-- a record that it happened.
-- ---------------------------------------------------------------------------
create table if not exists public.beta_allowlist (
  email      text        primary key,   -- always stored lowercased/trimmed
  note       text,                      -- e.g. "beta tester 3" -- never required
  added_at   timestamptz not null default now(),
  revoked_at timestamptz                -- null = active, set = revoked
);

alter table public.beta_allowlist enable row level security;
-- No policies on purpose. Do not add one.

/* Is this address approved right now? Case- and whitespace-insensitive.
   SECURITY DEFINER so it can read a table that denies the caller, and
   search_path is pinned, which closes the usual SECURITY DEFINER hijack. */
create or replace function public.beta_email_approved(addr text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.beta_allowlist
     where email = lower(trim(coalesce(addr, '')))
       and revoked_at is null
  );
$$;

/* The same question asked about the CALLER, from their verified JWT. This is
   the predicate the RLS policies below use. It reads the email claim that
   Supabase itself put in the token, so a client cannot influence it. */
create or replace function public.is_beta_approved()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.beta_email_approved(coalesce(auth.jwt() ->> 'email', ''));
$$;

revoke all on function public.beta_email_approved(text) from public, anon;
revoke all on function public.is_beta_approved()        from public, anon;
grant execute on function public.is_beta_approved() to authenticated;


-- ---------------------------------------------------------------------------
-- STEP 2. THE FIVE TESTERS.   <<<<  EDIT THESE FIVE LINES  >>>>
--
-- Replace each placeholder with a real address. Add or remove rows to match
-- exactly who HQ has authorised, and include the existing athlete/owner if they
-- need cloud access. Addresses are lowercased on the way in, so a tester typing
-- "Name@Example.com" still matches.
-- ---------------------------------------------------------------------------
insert into public.beta_allowlist (email, note) values
  (lower(trim('tester1@example.com')), 'beta tester 1'),
  (lower(trim('tester2@example.com')), 'beta tester 2'),
  (lower(trim('tester3@example.com')), 'beta tester 3'),
  (lower(trim('tester4@example.com')), 'beta tester 4'),
  (lower(trim('tester5@example.com')), 'beta tester 5')
on conflict (email) do nothing;


-- ---------------------------------------------------------------------------
-- STEP 3. SAFETY GATE. Nothing below this runs if step 2 was not edited.
--
-- Without this, pasting the file unedited would install a working gate whose
-- only authorised users are five example.com addresses -- locking out the real
-- athlete while looking like it succeeded. Aborting here leaves the database
-- exactly as it was.
-- ---------------------------------------------------------------------------
do $$
declare
  placeholders int;
  active       int;
begin
  select count(*) into placeholders
    from public.beta_allowlist where email like '%@example.com';
  select count(*) into active
    from public.beta_allowlist where revoked_at is null;

  if placeholders > 0 then
    raise exception
      'ABORTED: % placeholder address(es) still in beta_allowlist. Edit STEP 2 with the real tester addresses, delete the example.com rows, and run again. Nothing has been changed.',
      placeholders;
  end if;

  if active = 0 then
    raise exception
      'ABORTED: the allowlist is empty, which would deny everyone including the existing athlete. Add the authorised addresses in STEP 2 and run again. Nothing has been changed.';
  end if;

  raise notice 'Safety gate passed: % active tester(s) on the allowlist.', active;
end $$;



-- ---------------------------------------------------------------------------
-- STEP 4a. CREATION GATE — an unapproved address cannot become a user at all.
--
-- The app calls /api/beta-signin, which checks the allowlist before asking
-- GoTrue for a link. That endpoint is the clean-UX layer, NOT the security
-- boundary: anyone holding the publishable key can POST /auth/v1/otp directly
-- and ask for an account. This trigger is what actually refuses, at the only
-- place the account can come into existence.
--
-- BEFORE INSERT on auth.users, so a rejected signup creates no row at all.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_beta_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.beta_email_approved(new.email) then
    raise exception 'velvet_viking_private_beta: address not authorised'
      using errcode = '42501';   -- insufficient_privilege
  end if;
  return new;
end;
$$;

drop trigger if exists beta_allowlist_gate on auth.users;
create trigger beta_allowlist_gate
  before insert on auth.users
  for each row execute function public.enforce_beta_allowlist();


-- ---------------------------------------------------------------------------
-- STEP 4b. USE GATE — revocation, and anyone who already has an account.
--
-- The trigger above only fires when an account is CREATED. It cannot help with
-- the two cases that matter just as much:
--   * a tester who already exists and is then revoked;
--   * an account created before this gate was installed.
-- So every athlete-facing policy gains the same predicate. Revoking a tester
-- (one UPDATE, below) takes their cloud access away on their very next
-- request, and touches nobody else.
--
-- auth.uid() = user_id is UNCHANGED and still does the isolation work. This
-- only ADDS a condition; it never widens one.
--
-- service_role bypasses RLS entirely, so the Vercel functions -- including the
-- operator deletion path -- keep working against a revoked user's rows.
-- ---------------------------------------------------------------------------
drop policy if exists "own plan: select" on public.plans;
drop policy if exists "own plan: insert" on public.plans;
drop policy if exists "own plan: update" on public.plans;

create policy "own plan: select" on public.plans
  for select using (auth.uid() = user_id and public.is_beta_approved());

create policy "own plan: insert" on public.plans
  for insert with check (auth.uid() = user_id and public.is_beta_approved());

create policy "own plan: update" on public.plans
  for update using (auth.uid() = user_id and public.is_beta_approved())
              with check (auth.uid() = user_id and public.is_beta_approved());

drop policy if exists "own activities: select" on public.strava_activities;
drop policy if exists "own activities: update" on public.strava_activities;

create policy "own activities: select" on public.strava_activities
  for select using (auth.uid() = user_id and public.is_beta_approved());

create policy "own activities: update" on public.strava_activities
  for update using (auth.uid() = user_id and public.is_beta_approved())
              with check (auth.uid() = user_id and public.is_beta_approved());

-- strava_connections is untouched: RLS on, no policies, deny-all to every
-- browser role already. Adding a policy there would only weaken it.


-- ---------------------------------------------------------------------------
-- OPERATING THE LIST
-- ---------------------------------------------------------------------------
-- Add a tester:
--   insert into public.beta_allowlist (email, note)
--   values (lower(trim('new@example.com')), 'beta tester 6')
--   on conflict (email) do update set revoked_at = null;
--
-- Revoke ONE tester (keeps the record; the other four are unaffected):
--   update public.beta_allowlist set revoked_at = now()
--    where email = lower(trim('leaver@example.com'));
--
-- Un-revoke:
--   update public.beta_allowlist set revoked_at = null
--    where email = lower(trim('returner@example.com'));
--
-- NOTE: revoking removes cloud ACCESS. It does not delete the tester's data --
-- that is the operator deletion path in /api/admin-user.js, which is separate
-- on purpose so "stop this person using the beta" and "erase this person"
-- stay two different decisions.


-- ---------------------------------------------------------------------------
-- VERIFICATION
-- ---------------------------------------------------------------------------
-- Who is active (should be exactly five):
--   select email, added_at, revoked_at from public.beta_allowlist order by email;
--   select count(*) from public.beta_allowlist where revoked_at is null;
--
-- The gate is installed:
--   select tgname from pg_trigger where tgname = 'beta_allowlist_gate';
--
-- The policies carry the predicate (expect is_beta_approved in each):
--   select policyname, qual, with_check from pg_policies
--    where tablename in ('plans','strava_activities') order by policyname;
--
-- The allowlist is not client-readable (expect rowsecurity=true, 0 policies):
--   select relrowsecurity from pg_class where relname = 'beta_allowlist';
--   select count(*) from pg_policies where tablename = 'beta_allowlist';

-- ---------------------------------------------------------------------------
-- FINAL CHECK — read this output before telling anyone the beta is open.
-- Expect: the number HQ authorised, trigger_installed = 1, policies_with_gate = 5,
--         allowlist_client_readable = false.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.beta_allowlist where revoked_at is null)      as active_testers,
  (select count(*) from public.beta_allowlist where revoked_at is not null)  as revoked_testers,
  (select count(*) from pg_trigger where tgname = 'beta_allowlist_gate')     as trigger_installed,
  (select count(*) from pg_policies
     where tablename in ('plans','strava_activities')
       and (coalesce(qual,'') like '%is_beta_approved%'
         or coalesce(with_check,'') like '%is_beta_approved%'))              as policies_with_gate,
  (select count(*) from pg_policies where tablename = 'beta_allowlist') > 0  as allowlist_client_readable;
