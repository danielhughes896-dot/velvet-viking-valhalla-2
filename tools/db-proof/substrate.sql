-- ===========================================================================
-- THE SUPABASE SUBSTRATE, FOR A DISPOSABLE POSTGRES
--
-- Just enough of what Supabase provides for the migrations in this repository
-- to apply and for their row-level security to be proved by acting as real
-- users: the three platform roles, auth.users, auth.uid() and auth.jwt() read
-- from the request claims exactly as Supabase reads them, and the default
-- table grants that let ROW-LEVEL SECURITY do the deciding. Without those
-- grants every refusal is "permission denied" at the GRANT layer, which proves
-- the wrong thing (see SUPABASE-MIGRATIONS.md).
--
-- NEVER run this against a real Supabase project. It is for a throwaway
-- cluster only (tools/db-proof/run.sh makes one and deletes it).
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin noinherit; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key,
  email text
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

grant usage on schema auth   to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
