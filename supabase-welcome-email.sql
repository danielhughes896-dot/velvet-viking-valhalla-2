-- ===========================================================================
-- THE FOUNDER WELCOME EMAIL -- ONE PER ATHLETE, EVER
--
-- Valhalla sends one welcome email, from Dan, the first time an athlete
-- actually gets into the product. Not on every sign-in, not twice, and not at
-- all if it cannot be recorded.
--
-- WHY THIS NEEDS A TABLE AND NOT A COLUMN. The obvious shortcut is a
-- welcome_email_sent_at column on account_commercial. That table is the
-- COMMERCIAL record -- the trial allowance and the money -- and a welcome email
-- is neither. More practically: this row is a LOCK as much as it is a record,
-- and giving a lock its own table means the primary key is the lock. Two
-- simultaneous first sign-ins both attempt the insert and exactly one wins,
-- decided by Postgres rather than by a read-then-write in JavaScript that is
-- correct until two requests arrive in the same millisecond.
--
-- AT MOST ONCE IS GUARANTEED. AT LEAST ONCE IS NOT, and this file does not
-- pretend otherwise. If the provider is down when an athlete first signs in,
-- the send is retried on their next few visits and then given up on. An email
-- that never arrives is a disappointment; an email that arrives three times is
-- an apology, and the two are not equally bad.
--
-- WHAT IS NOT HERE. No email address -- the address lives in auth.users and is
-- read from the athlete's own verified token at send time, so this table never
-- becomes a second copy of everybody's inbox. No open tracking, no click
-- tracking, no delivery telemetry beyond a failure code. It answers exactly one
-- question: has this athlete been welcomed.
--
-- WHERE IT SITS. After supabase-security-posture.sql (file 10), which asserts
-- that every table in public has row-level security on -- this one is created
-- with RLS on and no policies, so re-running 10 afterwards passes.
--
-- Safe to re-run.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 -- THE RECORD
--
-- next_attempt_at exists so a retry is a DECISION rather than a repetition. A
-- failed send sets it forward; a claim will not succeed again until that
-- instant passes. Combined with attempts, that is a bounded backoff with no
-- scheduler, no queue and nothing to run: the next sign-in is the retry.
-- ---------------------------------------------------------------------------
create table if not exists public.account_welcome_email (
  account_id      uuid        primary key references auth.users(id) on delete cascade,
  first_claim_at  timestamptz not null default now(),
  sent_at         timestamptz,
  attempts        integer     not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- A CODE, never a provider body. Resend's errors echo the request, and the
  -- request carries the athlete's address.
  last_error      text
);

comment on table public.account_welcome_email is
  'One row per athlete: has the founder welcome email been sent. The primary key is the lock.';

alter table public.account_welcome_email enable row level security;

-- NO POLICIES, DELIBERATELY. RLS on with none is deny-all to every browser
-- role, including the athlete's own session. Nothing here is the athlete's to
-- read and nothing is theirs to write -- a client that could delete its own row
-- could ask for the welcome email again, and again.


-- ---------------------------------------------------------------------------
-- STEP 2 -- THE CLAIM
--
-- ONE STATEMENT, and that is the whole design. INSERT ... ON CONFLICT DO UPDATE
-- takes a row lock, so two simultaneous callers are serialised by the database:
-- the first inserts and is told to send, the second collides, fails the WHERE,
-- gets nothing back, and is told not to. There is no window between them.
--
-- The WHERE on the conflict branch is what makes a retry safe and bounded:
--   sent_at is null          it has not already gone
--   next_attempt_at <= now() the backoff has elapsed
--   attempts < p_max         we have not already tried enough times
-- Fail any of those and the update matches nothing, which returns nothing,
-- which is read as "do not send".
--
-- Returns a plain boolean because the caller has exactly one decision to make.
-- ---------------------------------------------------------------------------
create or replace function public.claim_welcome_email(
  p_account_id uuid,
  p_max_attempts integer default 3,
  p_backoff interval default interval '30 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_claimed boolean;
begin
  if p_account_id is null then return false; end if;

  insert into public.account_welcome_email as w
    (account_id, attempts, next_attempt_at)
  values
    (p_account_id, 1, now() + p_backoff)
  on conflict (account_id) do update
     set attempts        = w.attempts + 1,
         next_attempt_at = now() + p_backoff
   where w.sent_at is null
     and w.next_attempt_at <= now()
     and w.attempts < p_max_attempts
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end $$;


-- ---------------------------------------------------------------------------
-- STEP 3 -- THE OUTCOME
--
-- Stamped only after the provider has accepted it. Conditional on sent_at being
-- null so a late duplicate cannot move the timestamp, and so the row records
-- when the athlete was welcomed rather than when something last touched it.
-- ---------------------------------------------------------------------------
create or replace function public.mark_welcome_email_sent(p_account_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_done boolean;
begin
  update public.account_welcome_email
     set sent_at = now(), last_error = null
   where account_id = p_account_id and sent_at is null
  returning true into v_done;
  return coalesce(v_done, false);
end $$;

/* A failure code, so an operator can tell "the provider refused" from "nobody
   has signed in yet". Never a message: see the column comment. */
create or replace function public.record_welcome_email_failure(p_account_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_welcome_email
     set last_error = left(coalesce(p_code, 'unknown'), 60)
   where account_id = p_account_id and sent_at is null;
end $$;


-- ---------------------------------------------------------------------------
-- STEP 4 -- WHO MAY CALL THEM
--
-- The server, and nobody else. All three run SECURITY DEFINER against a table
-- the browser roles cannot touch, so an EXECUTE grant to `authenticated` would
-- hand a client the ability to claim, mark and clear its own welcome state --
-- which is every way this could be abused, in one grant.
-- ---------------------------------------------------------------------------
revoke all on function public.claim_welcome_email(uuid, integer, interval) from public, anon, authenticated;
revoke all on function public.mark_welcome_email_sent(uuid)                 from public, anon, authenticated;
revoke all on function public.record_welcome_email_failure(uuid, text)      from public, anon, authenticated;
grant execute on function public.claim_welcome_email(uuid, integer, interval) to postgres, service_role;
grant execute on function public.mark_welcome_email_sent(uuid)                to postgres, service_role;
grant execute on function public.record_welcome_email_failure(uuid, text)     to postgres, service_role;


-- ---------------------------------------------------------------------------
-- STEP 5 -- REFUSE IF THE POSTURE IS WRONG
--
-- Everything above is idempotent, so the value of a second run is entirely in
-- what it checks. Three ways this could quietly become wrong:
--   1. RLS off, and every athlete's welcome state world-readable.
--   2. A policy has appeared, so a client can reach the row at all.
--   3. `authenticated` has been granted EXECUTE on the claim, which would let
--      a client send itself the email repeatedly.
-- ---------------------------------------------------------------------------
do $$
declare v_rls boolean; v_policies int;
begin
  select relrowsecurity from pg_class
   where oid = 'public.account_welcome_email'::regclass into v_rls;
  if not coalesce(v_rls, false) then
    raise exception using errcode = 'raise_exception',
      message = 'account_welcome_email has row-level security OFF. Nothing has been changed.';
  end if;

  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'account_welcome_email';
  if v_policies > 0 then
    raise exception using errcode = 'raise_exception',
      message = 'account_welcome_email has ' || v_policies || ' policy/policies. It is service-only '
             || 'by design: RLS with no policy is deny-all, and a policy here is a widening. '
             || 'Nothing has been changed.';
  end if;

  if has_function_privilege('authenticated', 'public.claim_welcome_email(uuid, integer, interval)', 'EXECUTE') then
    raise exception using errcode = 'raise_exception',
      message = 'authenticated can execute claim_welcome_email(). A client could send itself the '
             || 'welcome email repeatedly. Nothing has been changed.';
  end if;

  raise notice 'account_welcome_email: RLS on, no policies, service-role only.';
end $$;


-- ---------------------------------------------------------------------------
-- VERIFY. Read-only.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.account_welcome_email)                        as accounts_seen,
  (select count(*) from public.account_welcome_email where sent_at is not null) as welcomed,
  (select count(*) from public.account_welcome_email
    where sent_at is null and attempts >= 3)                                 as given_up,
  (select count(*) from public.account_welcome_email
    where sent_at is null and attempts < 3)                                  as awaiting_retry,
  (select count(*) from pg_policies where schemaname = 'public'
    and tablename = 'account_welcome_email')                                 as policies_expect_0,
  has_function_privilege('authenticated','public.claim_welcome_email(uuid, integer, interval)','EXECUTE')
                                                                             as client_can_claim_expect_false;
