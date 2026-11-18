-- ===========================================================================
-- COACH MEMORY, PROVED BY ACTING AS REAL PEOPLE
--
-- Runs after supabase-coach-memory.sql on the disposable cluster that
-- tools/db-proof/run.sh builds:
--   tools/db-proof/run.sh supabase-coach-memory.sql tools/db-proof/coach-memory-proof.sql
--
-- Ann owns some lines, Ben owns others, and the anonymous key owns nothing.
-- Every check tries the thing the rule forbids, through the same row-level
-- security and grants production uses.
-- ===========================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

create schema if not exists proof;
grant usage on schema proof to anon, authenticated, service_role;

create or replace function proof.act(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when u is null then '{}' else json_build_object('sub', u, 'role', 'authenticated')::text end, false);
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

\set ann '''a0000000-0000-0000-0000-0000000000a1'''
\set ben '''b0000000-0000-0000-0000-0000000000b2'''

do $$ begin
  if to_regclass('public.beta_allowlist') is not null then
    insert into public.beta_allowlist (email, note)
    select 'memproof' || i || '@test.invalid', 'coach memory proof' from generate_series(1, 2) i
    on conflict do nothing;
  end if;
end $$;
insert into auth.users (id, email) values
  (:ann, 'memproof1@test.invalid'), (:ben, 'memproof2@test.invalid');

-- ------------------------------------------------------- the server writes
select proof.server();
insert into public.coach_memory (user_id, day, kind, line) values
  (:ann, '2026-11-10', 'decision', 'Declined the extra run, week 5.'),
  (:ann, '2026-11-11', 'conversation', 'Asked: Why is my long run shorter this week?');
insert into public.coach_memory (user_id, day, kind, line, health) values
  (:ann, '2026-11-12', 'flag', 'Said they could not train normally because of injury or illness, week 5.', true);
insert into public.coach_memory (user_id, day, kind, line) values
  (:ben, '2026-11-12', 'decision', 'Kept the week as planned, week 2.');
select proof.ok((select count(*) = 4 from public.coach_memory), 'the server can write lines');
-- The same line on the same day is kept once.
select proof.refused($$insert into public.coach_memory (user_id, day, kind, line)
                       values ('a0000000-0000-0000-0000-0000000000a1', '2026-11-10', 'decision',
                               'Declined the extra run, week 5.')$$,
  'the same line twice on one day');
select proof.refused($$insert into public.coach_memory (user_id, day, kind, line)
                       values ('a0000000-0000-0000-0000-0000000000a1', '2026-11-13', 'decision', repeat('x', 201))$$,
  'a line over 200 characters');
select proof.refused($$insert into public.coach_memory (user_id, day, kind, line)
                       values ('a0000000-0000-0000-0000-0000000000a1', '2026-11-13', 'decision', '   ')$$,
  'an empty line');
select proof.refused($$insert into public.coach_memory (user_id, day, kind, line)
                       values ('a0000000-0000-0000-0000-0000000000a1', '2026-11-13', 'decision', E'one\ntwo')$$,
  'a line with a line break');
select proof.refused($$insert into public.coach_memory (user_id, day, kind, line)
                       values ('a0000000-0000-0000-0000-0000000000a1', '2026-11-13', 'conversation', 'Asked: how was my STRAVA run')$$,
  'a line mentioning Strava');
select proof.refused($$insert into public.coach_memory (user_id, day, kind, line)
                       values ('a0000000-0000-0000-0000-0000000000a1', '2026-11-13', 'note', 'Heavy legs today')$$,
  'a kind that is not decision, conversation or flag');

-- ------------------------------------------------------- the athlete reads
select proof.act(:ann);
select proof.ok((select count(*) = 3 from public.coach_memory), 'Ann reads her own three lines');
select proof.ok((select count(*) = 0 from public.coach_memory where user_id = :ben), 'and none of Ben''s');
select proof.refused($$insert into public.coach_memory (user_id, day, kind, line)
                       values ('a0000000-0000-0000-0000-0000000000a1', '2026-11-14', 'decision', 'Forged by the browser.')$$,
  'Ann cannot write a line from the browser');
select proof.refused($$insert into public.coach_memory (user_id, day, kind, line)
                       values ('b0000000-0000-0000-0000-0000000000b2', '2026-11-14', 'decision', 'Forged for Ben.')$$,
  'Ann cannot write a line for Ben');
select proof.refused($$update public.coach_memory set line = 'Rewritten.'$$,
  'Ann cannot rewrite a line');
select proof.refused($$delete from public.coach_memory$$,
  'Ann cannot delete from the browser (clearing goes through the server)');

-- AND RLS SAYS NO ON ITS OWN. The grants above refuse first, which is the
-- point of revoking them -- but a refusal at the GRANT layer proves nothing
-- about the policies. So the write privileges are put back for a moment, as a
-- hand-edit in the dashboard might, and RLS must still refuse every write.
select proof.admin();
grant insert, update, delete on public.coach_memory to authenticated;
select proof.act(:ann);
select proof.refused($$insert into public.coach_memory (user_id, day, kind, line)
                       values ('a0000000-0000-0000-0000-0000000000a1', '2026-11-14', 'decision', 'Forged by the browser.')$$,
  'with the grant back, RLS still refuses a browser insert');
update public.coach_memory set line = 'Rewritten.';
delete from public.coach_memory;
select proof.admin();
select proof.ok((select count(*) = 4 and count(*) filter (where line = 'Rewritten.') = 0 from public.coach_memory),
  'with the grant back, RLS still lets no browser update or delete touch a row');
revoke insert, update, delete on public.coach_memory from authenticated;

select proof.act(null);
select proof.refused($$select count(*) from public.coach_memory$$,
  'the anonymous key cannot read the table at all');

select proof.act(:ben);
select proof.ok((select count(*) = 1 from public.coach_memory), 'Ben reads only his own line');

-- ---------------------------------------------------- erasure and clearing
select proof.server();
delete from public.coach_memory where user_id = :ann and health;
select proof.ok((select count(*) = 2 from public.coach_memory where user_id = :ann),
  'an erasure request removes the health line and keeps the rest');
delete from public.coach_memory where user_id = :ann;
select proof.ok((select count(*) = 0 from public.coach_memory where user_id = :ann), 'Clear memory removes every line');
select proof.ok((select count(*) = 1 from public.coach_memory where user_id = :ben), 'and nobody else''s');

-- ----------------------------------------------------------- only 100 kept
insert into public.coach_memory (user_id, day, kind, line, created_at)
select :ann, date '2026-01-01' + i, 'conversation', 'Asked: question ' || i, now() - make_interval(days => 200 - i)
  from generate_series(1, 120) i;
select proof.ok((select count(*) = 100 from public.coach_memory where user_id = :ann), 'only the newest 100 lines are kept');
select proof.ok((select min(line) is not null and not exists (select 1 from public.coach_memory
                    where user_id = :ann and line = 'Asked: question 1') from public.coach_memory where user_id = :ann),
  'and it is the oldest that go');
select proof.ok((select count(*) = 1 from public.coach_memory where user_id = :ben), 'Ben''s line is untouched by Ann''s prune');

-- -------------------------------------------------- the account goes, so do they
select proof.admin();
delete from auth.users where id = :ben;
select proof.ok((select count(*) = 0 from public.coach_memory where user_id = :ben), 'deleting the account deletes its lines');
delete from auth.users where id = :ann;
select proof.ok((select count(*) = 0 from public.coach_memory), 'and nothing is left behind');

select proof.admin();
drop schema proof cascade;
\echo 'ALL COACH MEMORY RULES HELD'
