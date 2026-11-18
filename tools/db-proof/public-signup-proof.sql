-- ===========================================================================
-- THE PUBLIC SIGN-UP SWITCH, PROVED BY ACTING AS REAL PEOPLE
--
-- Runs on the disposable cluster tools/db-proof/full-chain.sh builds, after
-- the whole schema in order and then supabase-public-signup.sql (twice):
--   tools/db-proof/full-chain.sh tools/db-proof/public-signup-proof.sql
--
-- Ivy is invited (on the allowlist). Una is not. The anonymous key and a
-- signed-in athlete both try to read and to turn the switch. Every check tries
-- the thing the rule forbids, through the same trigger, row-level security and
-- grants production uses. NEVER run this against a real Supabase project.
-- ===========================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

create schema if not exists proof;
grant usage on schema proof to anon, authenticated, service_role;

create or replace function proof.act(u uuid, mail text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when u is null then '{}' else json_build_object('sub', u, 'email', mail, 'role', 'authenticated')::text end, false);
  execute case when u is null then 'set role anon' else 'set role authenticated' end;
end $$;
create or replace function proof.server() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', false);
  execute 'set role service_role';
end $$;
create or replace function proof.admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', false);
end $$;
create or replace function proof.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'RULE BROKEN: %', what; end if;
  raise notice 'ok  %', what;
end $$;
create or replace function proof.refused(stmt text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok  refused: %  (%)', what, sqlerrm;
    return;
  end;
  raise exception 'RULE BROKEN, NOT REFUSED: %', what;
end $$;
grant execute on all functions in schema proof to anon, authenticated, service_role;

\set ivy '''e0000000-0000-0000-0000-000000000001'''
\set una '''e0000000-0000-0000-0000-000000000002'''
\set una2 '''e0000000-0000-0000-0000-000000000003'''

select proof.admin();
insert into public.beta_allowlist (email, note) values ('ivy@test.invalid', 'switch proof')
  on conflict (email) do update set revoked_at = null;

-- ------------------------------------------------ as installed: CLOSED
select proof.ok((select public_signup = false from public.signup_settings where id = 1),
  'installed over an attached gate, the switch is seeded OFF: applying the file opened nothing');
select proof.ok((select count(*) = 1 from public.signup_settings), 'two runs leave exactly one row');
select proof.ok(exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                        join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'beta_allowlist_gate'),
  'the gate trigger is attached');

select proof.refused($$insert into auth.users (id, email) values ('e0000000-0000-0000-0000-000000000002', 'una@test.invalid')$$,
  'switch OFF: an uninvited address cannot become an account');
select proof.ok(not exists (select 1 from auth.users where email = 'una@test.invalid'),
  'and no row was created for it');
insert into auth.users (id, email) values (:ivy, 'ivy@test.invalid');
select proof.ok(exists (select 1 from auth.users where id = :ivy), 'switch OFF: an invited address still can');

-- ------------------------------------------------ the switch is nobody's but the SQL editor's
select proof.act(null, null);
select proof.refused($$select * from public.signup_settings$$, 'the anonymous key cannot read the switch');
select proof.refused($$update public.signup_settings set public_signup = true$$, 'the anonymous key cannot turn it');
select proof.refused($$select public.public_signup_open()$$, 'the anonymous key cannot call the switch');
select proof.act(:ivy, 'ivy@test.invalid');
select proof.refused($$select * from public.signup_settings$$, 'a signed-in athlete cannot read the switch');
select proof.refused($$update public.signup_settings set public_signup = true where id = 1$$, 'a signed-in athlete cannot turn it');
select proof.refused($$insert into public.signup_settings (id, public_signup) values (2, true)$$, 'nor add a second row');
select proof.server();
select proof.ok((select count(*) = 1 from public.signup_settings), 'the server key can read the switch, for its wording');
select proof.refused($$update public.signup_settings set public_signup = true where id = 1$$,
  'the server key cannot turn it: who may sign up is decided in the SQL editor');
select proof.admin();
select proof.refused($$insert into public.signup_settings (id, public_signup) values (2, true)$$,
  'there is only ever one switch');
select proof.ok((select public_signup = false from public.signup_settings where id = 1), 'still OFF after all of that');

-- ------------------------------------------------ TURN IT ON
update public.signup_settings set public_signup = true, changed_at = now(), note = 'proof: opened' where id = 1;

insert into auth.users (id, email) values (:una, 'una@test.invalid');
select proof.ok(exists (select 1 from auth.users where id = :una), 'switch ON: an uninvited address becomes an account');
select proof.ok(not exists (select 1 from public.beta_allowlist where email = 'una@test.invalid'),
  'without being put on the allowlist');

-- What the new account holds: the commercial row and nothing that grants access.
select proof.ok(exists (select 1 from public.account_commercial where account_id = :una and trial_consumed_at is null),
  'the new account has its commercial row, trial unused');
select proof.ok(not exists (select 1 from public.entitlement_grants where account_id = :una),
  'and no grant of any kind');
select proof.ok(not exists (select 1 from public.entitlements where user_id = :una
                             and (override is not null or state <> 'expired')),
  'and no entitlement that opens the door');

-- Her own plan, and only hers.
select proof.act(:una, 'una@test.invalid');
insert into public.plans (user_id, data) values (:una, '{"mine": true}');
select proof.ok((select count(*) = 1 from public.plans where user_id = :una), 'switch ON: she can save and read her own plan');
select proof.refused($$insert into public.plans (user_id, data) values ('e0000000-0000-0000-0000-000000000001', '{"x":1}')$$,
  'but not write one for somebody else');
select proof.act(:ivy, 'ivy@test.invalid');
insert into public.plans (user_id, data) values (:ivy, '{"ivy": true}')
  on conflict (user_id) do update set data = excluded.data;
select proof.act(:una, 'una@test.invalid');
select proof.ok((select count(*) = 0 from public.plans where user_id = :ivy), 'nor read anybody else''s');
select proof.act(null, null);
/* The anonymous key holds no EXECUTE on the predicate, so it is refused
   outright rather than shown zero rows: either way it reads no plan. */
select proof.refused($$select count(*) from public.plans$$, 'and the anonymous key reads no plan at all');

-- ------------------------------------------------ TURN IT BACK OFF
select proof.admin();
update public.signup_settings set public_signup = false, changed_at = now(), note = 'proof: closed' where id = 1;
select proof.refused($$insert into auth.users (id, email) values ('e0000000-0000-0000-0000-000000000003', 'una2@test.invalid')$$,
  'switch OFF again: the allowlist gate is back at once, with no migration');
select proof.ok((select count(*) = 1 from auth.users where id = :una), 'the account made while it was on still exists');
select proof.act(:una, 'una@test.invalid');
select proof.ok((select count(*) = 0 from public.plans where user_id = :una),
  'and, with the beta predicate still in the policies, is treated as any uninvited address again');
select proof.act(:ivy, 'ivy@test.invalid');
select proof.ok((select count(*) = 1 from public.plans where user_id = :ivy), 'an invited athlete is untouched by any of it');

-- ------------------------------------------------ the refusal is word for word what it was
select proof.admin();
do $$
begin
  begin
    insert into auth.users (id, email) values ('e0000000-0000-0000-0000-000000000004', 'una3@test.invalid');
  exception when insufficient_privilege then
    if sqlerrm <> 'velvet_viking_private_beta: address not authorised' then
      raise exception 'RULE BROKEN: the refusal changed its words: %', sqlerrm;
    end if;
    raise notice 'ok  the refusal keeps its message and its errcode (42501)';
    return;
  end;
  raise exception 'RULE BROKEN, NOT REFUSED: closed gate admitted an uninvited address';
end $$;

-- ------------------------------------------------ a database the cutover had already opened
-- Detach the gate and forget the switch, as a database that ran
-- supabase-commercial-cutover.sql and never this file would be. Applying the
-- file there must seed the switch ON: it changes nobody's ability to sign up.
drop trigger if exists beta_allowlist_gate on auth.users;
drop table public.signup_settings;
\ir ../../supabase-public-signup.sql
\pset tuples_only on
\pset format unaligned
select proof.ok((select public_signup = true from public.signup_settings where id = 1),
  'applied over an already-open database, the switch is seeded ON, so nothing closes');
select proof.ok(exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                        join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'beta_allowlist_gate'),
  'and the gate is attached again, ready for the switch to close it');
insert into auth.users (id, email) values (:una2, 'una2@test.invalid');
select proof.ok(exists (select 1 from auth.users where id = :una2), 'an uninvited address still signs up there');

select proof.admin();
delete from auth.users where email like '%@test.invalid' and id::text like 'e%';
delete from public.beta_allowlist where note = 'switch proof';
drop schema proof cascade;
\echo 'ALL SIGN-UP SWITCH RULES HELD'
