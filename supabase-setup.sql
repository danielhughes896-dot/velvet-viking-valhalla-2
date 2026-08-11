-- Velvet Viking Valhalla — cloud sync setup
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

drop policy if exists "own plan: select" on public.plans;
drop policy if exists "own plan: insert" on public.plans;
drop policy if exists "own plan: update" on public.plans;

create policy "own plan: select" on public.plans
  for select using (auth.uid() = user_id);

create policy "own plan: insert" on public.plans
  for insert with check (auth.uid() = user_id);

create policy "own plan: update" on public.plans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Quick check: should return 3 policies, and rowsecurity = true.
-- select relrowsecurity from pg_class where relname = 'plans';
-- select policyname from pg_policies where tablename = 'plans';
