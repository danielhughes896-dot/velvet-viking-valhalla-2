-- Velvet Viking — cloud sync setup
-- Run this once in your Supabase project: SQL Editor -> New query -> paste -> Run.
--
-- One row per user holding the whole training block as JSON. The app already
-- keeps its entire state in a single serialisable object (~32KB), so no schema
-- design or migrations are needed here -- the existing in-app version handling
-- in loadState() keeps working untouched.

create table if not exists public.plans (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security is the part that actually protects the data. The anon key
-- shipped in the client is public by design; RLS is what stops anyone holding
-- it from reading someone else's plan. Without these policies every plan would
-- be world-readable.
alter table public.plans enable row level security;

-- ---------------------------------------------------------------------------
-- WHY `(select auth.uid())` AND NOT `auth.uid()`
--
-- A bare auth.uid() in a policy is evaluated ONCE PER ROW. Wrapped in a
-- scalar sub-select it becomes an InitPlan: Postgres evaluates it once for the
-- whole statement and reuses the result. On a table with a few hundred rows
-- that is a rounding error; on a scan it is the difference between one call and
-- one per row, and it is what Supabase's performance advisor is pointing at.
--
-- IT CHANGES NO SEMANTICS, and that is checkable rather than hopeful:
-- auth.uid() is STABLE, takes no arguments and reads nothing from the row, so
-- its value cannot differ between rows of one statement. The same is true of
-- is_beta_approved(), which reads the caller's own JWT claim -- so it is
-- hoisted for the same reason and with the same guarantee.
--
-- WHAT WOULD BE WRONG is hoisting something that DOES depend on the row. There
-- is nothing of that kind in any policy here, and a new one must not be added
-- inside a sub-select.
-- ---------------------------------------------------------------------------
drop policy if exists "own plan: select" on public.plans;
drop policy if exists "own plan: insert" on public.plans;
drop policy if exists "own plan: update" on public.plans;

create policy "own plan: select" on public.plans
  for select using ((select auth.uid()) = user_id);

create policy "own plan: insert" on public.plans
  for insert with check ((select auth.uid()) = user_id);

create policy "own plan: update" on public.plans
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Quick check: should return 3 policies, and rowsecurity = true.
-- select relrowsecurity from pg_class where relname = 'plans';
-- select policyname from pg_policies where tablename = 'plans';


-- ---------------------------------------------------------------------------
-- Right to erasure (GDPR Art. 17): let a signed-in user delete themselves.
--
-- Removing a row from auth.users needs privileges the browser must never hold,
-- so this runs SECURITY DEFINER (as the function owner) instead of shipping a
-- service_role key to the client. It is safe because:
--   * it only ever touches auth.uid() -- the caller's own id, taken from their
--     verified JWT -- so it cannot be pointed at anyone else's account;
--   * search_path is pinned, closing the usual SECURITY DEFINER hijack;
--   * EXECUTE is revoked from public and granted only to authenticated, so an
--     anonymous caller cannot invoke it at all;
--   * with no session auth.uid() is null and it deletes nothing.
-- Deleting the auth row also clears public.plans via ON DELETE CASCADE; the
-- explicit delete is belt-and-braces.
-- ---------------------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.plans where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;


-- ---------------------------------------------------------------------------
-- STRAVA INTEGRATION
--
-- Two tables with deliberately different exposure:
--
--   strava_connections  holds OAuth access/refresh tokens. RLS is ON and there
--                       are NO policies, which in Postgres means every request
--                       made with the anon or authenticated role is denied --
--                       including a correctly signed-in athlete's own JWT.
--                       Only the service_role key held inside the Vercel
--                       functions can read or write it, so a Strava token is
--                       not reachable from any browser, any exported backup or
--                       any other user's session.
--
--   strava_activities   holds objective activity data waiting to be logged
--                       into the athlete's plan. This one the athlete's own
--                       session may read, because it is their own training
--                       data and the app has to ingest it client-side.
-- ---------------------------------------------------------------------------

create table if not exists public.strava_connections (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  strava_athlete_id bigint unique,
  access_token      text        not null,
  refresh_token     text        not null,
  expires_at        bigint      not null,
  scope             text,
  athlete_name      text,
  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.strava_connections enable row level security;
-- No policies on purpose. Do not add one.

create table if not exists public.strava_activities (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  activity_id text        not null,
  payload     jsonb       not null,
  received_at timestamptz not null default now(),
  ingested_at timestamptz,
  deleted     boolean     not null default false,
  primary key (user_id, activity_id)
);

create index if not exists strava_activities_pending
  on public.strava_activities (user_id) where ingested_at is null and deleted = false;

alter table public.strava_activities enable row level security;

-- ---------------------------------------------------------------------------
-- WHY `(select auth.uid())` AND NOT `auth.uid()`
--
-- A bare auth.uid() in a policy is evaluated ONCE PER ROW. Wrapped in a
-- scalar sub-select it becomes an InitPlan: Postgres evaluates it once for the
-- whole statement and reuses the result. On a table with a few hundred rows
-- that is a rounding error; on a scan it is the difference between one call and
-- one per row, and it is what Supabase's performance advisor is pointing at.
--
-- IT CHANGES NO SEMANTICS, and that is checkable rather than hopeful:
-- auth.uid() is STABLE, takes no arguments and reads nothing from the row, so
-- its value cannot differ between rows of one statement. The same is true of
-- is_beta_approved(), which reads the caller's own JWT claim -- so it is
-- hoisted for the same reason and with the same guarantee.
--
-- WHAT WOULD BE WRONG is hoisting something that DOES depend on the row. There
-- is nothing of that kind in any policy here, and a new one must not be added
-- inside a sub-select.
-- ---------------------------------------------------------------------------
drop policy if exists "own activities: select" on public.strava_activities;
drop policy if exists "own activities: update" on public.strava_activities;

create policy "own activities: select" on public.strava_activities
  for select using ((select auth.uid()) = user_id);

-- The athlete's own session may only mark a row ingested. Insert and delete
-- stay server-side so the client can never manufacture training evidence.
create policy "own activities: update" on public.strava_activities
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- delete_own_account() predates these tables; both cascade from auth.users, so
-- deleting the account still removes the connection and every staged activity.
