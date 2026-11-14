-- ===========================================================================
-- CIRCLES, PROVED BY ACTING AS REAL PEOPLE
--
-- Runs after supabase-circles.sql on the disposable cluster that
-- tools/db-proof/run.sh builds. Every check acts as a signed-in athlete (or
-- the anonymous key) through the same row-level security production uses,
-- and tries to do the thing the rule forbids. Any rule that does not hold
-- stops the run with the sentence that failed.
--
--   Ann    starts the circle          Ben    joins it with an invite
--   Cal    is NOT in it (an outsider)  P1-P7  fill it to 8, and one too many
-- ===========================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned

create schema if not exists proof;
grant usage on schema proof to anon, authenticated;

-- Act as someone: their claims, the signed-in role. Null acts as the anon key.
create or replace function proof.act(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when u is null then '{}' else json_build_object('sub', u, 'role', 'authenticated')::text end, false);
  execute case when u is null then 'set role anon' else 'set role authenticated' end;
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
-- The statement must be refused (an error of any kind). Not refused is a failure.
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
grant execute on all functions in schema proof to anon, authenticated;

\set ann '''a0000000-0000-0000-0000-000000000001'''
\set ben '''b0000000-0000-0000-0000-000000000002'''
\set cal '''c0000000-0000-0000-0000-000000000003'''

-- The people. Their addresses go on the private-beta allowlist first when
-- the full migration chain is in place, because its signup gate refuses
-- anyone who is not on it -- which is that gate working, not this proof.
do $$ begin
  if to_regclass('public.beta_allowlist') is not null then
    insert into public.beta_allowlist (email, note)
    select 'proof' || i || '@test.invalid', 'circles proof' from generate_series(1, 10) i
    on conflict do nothing;
  end if;
end $$;
insert into auth.users (id, email) values
  (:ann, 'proof1@test.invalid'), (:ben, 'proof2@test.invalid'), (:cal, 'proof3@test.invalid'),
  ('d0000000-0000-0000-0000-000000000001', 'proof4@test.invalid'),
  ('d0000000-0000-0000-0000-000000000002', 'proof5@test.invalid'),
  ('d0000000-0000-0000-0000-000000000003', 'proof6@test.invalid'),
  ('d0000000-0000-0000-0000-000000000004', 'proof7@test.invalid'),
  ('d0000000-0000-0000-0000-000000000005', 'proof8@test.invalid'),
  ('d0000000-0000-0000-0000-000000000006', 'proof9@test.invalid'),
  ('d0000000-0000-0000-0000-000000000007', 'proof10@test.invalid');

-- ---------------------------------------------------------------- consent
select proof.act(:ann);
select proof.refused($$select public.circle_create('Sunday Runners', 'Ann', '')$$,
  'a circle cannot be started without recording consent');
select public.circle_create('Sunday Runners', 'Ann', 'circles-v1') as cid \gset
select proof.ok((select consent_version = 'circles-v1' and consented_at is not null
                   from public.circle_members where user_id = :ann),
  'the agreement is recorded on the membership');
select proof.ok((select count(*) = 1 from public.circle_sharing_log where user_id = :ann and event = 'created'),
  'starting a circle is written to the consent log');
select proof.ok((select show_km = false and sharing = true from public.circle_members where user_id = :ann),
  'km starts OFF, sharing starts on');
select proof.refused($$select public.circle_create('Second', 'Ann', 'circles-v1')$$,
  'one circle per person (Ann cannot start a second)');

-- ---------------------------------------------------------------- invites
select public.circle_invite_create() as code \gset
select proof.ok((select count(*) = 0 from public.circle_invites), 'nobody can read invite codes from the table');
select proof.refused($$insert into public.circle_invites (code, circle_id) values ('aaaaaaaaaaaa', '$$ || :'cid' || $$')$$,
  'nobody can forge an invite');

select proof.act(:ben);
select proof.refused($$select public.circle_join('$$ || :'code' || $$', 'Ben', '')$$,
  'joining without consent is refused');
select proof.refused($$select public.circle_join('000000000000', 'Ben', 'circles-v1')$$,
  'a made-up invite is refused');
select public.circle_join(:'code', 'Ben', 'circles-v1') as joined \gset
select proof.ok(:'joined' = :'cid', 'Ben joins Ann''s circle with the invite');
select proof.ok((select count(*) = 1 from public.circle_sharing_log where user_id = :ben and event = 'joined'),
  'joining is written to the consent log');

-- -------------------------------------------- nobody joins by writing rows
select proof.act(:cal);
select proof.refused($$insert into public.circle_members (user_id, circle_id, display_name, consent_version, consented_at)
                       values ('c0000000-0000-0000-0000-000000000003', '$$ || :'cid' || $$', 'Cal', 'circles-v1', now())$$,
  'an outsider cannot add themselves to a circle by writing a row');

-- ------------------------------------------------------- the plans say
-- What each athlete's own synced plan records as completed: Ann ran
-- yesterday and today, Ben ran yesterday. The plan carries a distance on
-- each, which must NOT reach the circle unless the athlete switches km on.
-- (A bare plans table stands in when this runs without the full chain.)
select proof.admin();
create table if not exists public.plans (user_id uuid primary key, data jsonb not null);
insert into public.plans (user_id, data) values
  (:ann, jsonb_build_object('days', jsonb_build_array(
     jsonb_build_object('date', current_date - 1, 'completed', true, 'title', 'Long Run', 'actual', jsonb_build_object('km', 16.2)),
     jsonb_build_object('date', current_date,     'completed', true, 'title', 'Easy Run', 'actual', jsonb_build_object('km', 8)),
     jsonb_build_object('date', current_date - 2, 'completed', false, 'title', 'Threshold')))),
  (:ben, jsonb_build_object('days', jsonb_build_array(
     jsonb_build_object('date', current_date - 1, 'completed', true, 'title', 'Easy Run', 'actual', jsonb_build_object('km', 6)))));

-- ------------------------------------------------------------ day writes
select proof.act(:ann);
insert into public.circle_days (user_id, day, state, session_label, km) values
  (:ann, current_date - 1, 'done',    'Long run', 16.2),
  (:ann, current_date - 2, 'missed',  'Threshold', null),
  (:ann, current_date - 3, 'rest',    null, null),
  (:ann, current_date + 1, 'planned', null, null);
select proof.ok((select km is null from public.circle_days where user_id = :ann and day = current_date - 1),
  'km is not shared while km is OFF, even though the plan records 16.2 km');
insert into public.circle_days (user_id, day, state, session_label) values
  (:ann, current_date - 6, 'done', 'Easy Run'),
  (:ann, current_date - 7, 'rest', null);
select proof.ok((select count(*) = 0 from public.circle_days where user_id = :ann and day = current_date - 6),
  'a "done" the plan does not record as completed is not stored');
select proof.ok((select count(*) = 1 from public.circle_days where user_id = :ann and day = current_date - 7),
  'and the rest of the same send still arrives');
delete from public.circle_days where user_id = :ann and day = current_date - 7;
select proof.ok((select session_label = 'Long run' from public.circle_days where user_id = :ann and day = current_date - 1),
  'the session name is the one sent ("Long run"), not copied from the plan ("Long Run")');
select proof.refused($$insert into public.circle_days (user_id, day, state, session_label)
                       values ('a0000000-0000-0000-0000-000000000001', current_date - 4, 'restricted', 'Calf strain')$$,
  'a restricted day cannot carry a reason');
select proof.refused($$insert into public.circle_days (user_id, day, state, session_label)
                       values ('a0000000-0000-0000-0000-000000000001', current_date + 3, 'planned', 'Long Run')$$,
  'a day still to come cannot carry its session name (that would show the plan)');
insert into public.circle_days (user_id, day, state, km) values (:ann, current_date - 5, 'rest', 5);
select proof.ok((select km is null from public.circle_days where user_id = :ann and day = current_date - 5),
  'with km OFF, km on any day is dropped');
delete from public.circle_days where user_id = :ann and day = current_date - 5;
select proof.refused($$insert into public.circle_days (user_id, day, state)
                       values ('b0000000-0000-0000-0000-000000000002', current_date, 'missed')$$,
  'Ann cannot write a day for Ben');

select proof.act(:ben);
insert into public.circle_days (user_id, day, state, session_label) values (:ben, current_date - 1, 'done', 'Easy run');
with x as (update public.circle_days set state = 'missed'
                   where user_id = :ann returning 1)
select proof.ok((select count(*) = 0 from x),
  'Ben cannot change Ann''s days');
with x as (delete from public.circle_days where user_id = :ann returning 1)
select proof.ok((select count(*) = 0 from x),
  'Ben cannot delete Ann''s days');

-- ---------------------------------------------------------------- reading
select proof.ok((select count(*) = 4 from public.circle_days where user_id = :ann),
  'Ben sees all four of Ann''s days');
select proof.ok((select count(*) = 2 from public.circle_members), 'Ben sees the two members of his circle');
select proof.ok((select count(*) = 1 from public.circles), 'Ben sees his own circle');
select proof.ok((select count(*) = 0 from public.circle_sharing_log where user_id <> :ben),
  'Ben cannot read anyone else''s consent log');

select proof.act(:cal);
select proof.ok((select count(*) = 0 from public.circles), 'an outsider sees no circle');
select proof.ok((select count(*) = 0 from public.circle_members), 'an outsider sees no members');
select proof.ok((select count(*) = 0 from public.circle_days), 'an outsider sees no training');
select proof.ok((select count(*) = 0 from public.circle_cheers), 'an outsider sees no Nice work');

select proof.act(null);
select proof.ok((select count(*) = 0 from public.circle_days), 'the anonymous key sees no training');
select proof.refused($$select public.circle_my_id()$$, 'the anonymous key cannot call circle functions');
select proof.refused($$select public.circle_invite_create()$$, 'the anonymous key cannot make invites');

-- --------------------------------------------------------------- km opt-in
select proof.act(:ann);
with x as (update public.circle_members set show_km = true
                   where user_id = :ann returning 1)
select proof.ok((select count(*) = 0 from x),
  'settings change only through the checked function, never by writing the row');
select proof.ok((select show_km = false from public.circle_members where user_id = :ann),
  'and the direct write changed nothing');
select public.circle_set_sharing(null, true);
update public.circle_days set km = 16.2 where user_id = :ann and day = current_date - 1;
select proof.refused($$insert into public.circle_days (user_id, day, state, km)
                       values ('a0000000-0000-0000-0000-000000000001', current_date - 5, 'rest', 5)$$,
  'with km ON, km still only sits on a done day');
select proof.act(:ben);
select proof.ok((select km = 16.2 from public.circle_days where user_id = :ann and day = current_date - 1),
  'with km ON, Ben sees Ann''s 16.2 km');
select proof.act(:ann);
select public.circle_set_sharing(null, false);
select proof.act(:ben);
select proof.ok((select km is null from public.circle_days where user_id = :ann and day = current_date - 1),
  'switching km OFF deletes the km already shared');

-- --------------------------------------------------------------- Nice work
select public.circle_nice_work(:ann, current_date - 1);
select public.circle_nice_work(:ann, current_date - 1);          -- a second tap
select proof.ok((select count(*) = 1 from public.circle_cheers), 'Nice work counts once per person per day');
select proof.refused($$select public.circle_nice_work('a0000000-0000-0000-0000-000000000001', current_date - 2)$$,
  'no Nice work on a missed day');
select proof.refused($$select public.circle_nice_work('a0000000-0000-0000-0000-000000000001', current_date - 3)$$,
  'no Nice work on a rest day');
select proof.refused($$select public.circle_nice_work('b0000000-0000-0000-0000-000000000002', current_date - 1)$$,
  'no Nice work to yourself');
select proof.refused($$insert into public.circle_cheers (circle_id, from_user, to_user, day)
                       values ('$$ || :'cid' || $$', 'b0000000-0000-0000-0000-000000000002',
                               'a0000000-0000-0000-0000-000000000001', current_date - 2)$$,
  'Nice work cannot be written around its rules');
select proof.act(:cal);
select proof.refused($$select public.circle_nice_work('a0000000-0000-0000-0000-000000000001', current_date - 1)$$,
  'an outsider cannot send Nice work');
select proof.act(:ann);
select proof.ok((select count(*) = 1 from public.circle_cheers where to_user = :ann and seen_at is null),
  'Ann sees the Nice work waiting for her');
select proof.ok((select public.circle_nice_work_seen() = 1), 'opening Today marks it seen');
select proof.ok((select count(*) = 0 from public.circle_cheers where seen_at is null), 'and it is not shown again');
with x as (update public.circle_cheers set seen_at = null returning 1)
select proof.ok((select count(*) = 0 from x),
  'Nice work cannot be edited directly');

-- ------------------------------------------------------------ stop sharing
select public.circle_set_sharing(false, null);
select proof.act(:ben);
select proof.ok((select count(*) = 0 from public.circle_days where user_id = :ann),
  'when Ann stops sharing, Ben sees none of her days');
select proof.ok((select count(*) = 2 from public.circle_members),
  'Ann is still a member while paused');
select proof.refused($$select public.circle_nice_work('a0000000-0000-0000-0000-000000000001', current_date - 1)$$,
  'no Nice work for someone who is not sharing');
select proof.act(:ann);
select proof.ok((select count(*) = 4 from public.circle_days where user_id = :ann),
  'Ann still sees her own days');
select proof.refused($$insert into public.circle_days (user_id, day, state) values ('a0000000-0000-0000-0000-000000000001', current_date, 'done')$$,
  'nothing new goes out while paused');
select public.circle_set_sharing(true, null);
select proof.ok((select array_agg(event order by id)::text = '{created,km_on,km_off,paused,resumed}'
                   from public.circle_sharing_log where user_id = :ann),
  'every sharing decision is in Ann''s log, in order');
with x as (delete from public.circle_sharing_log returning 1)
select proof.ok((select count(*) = 0 from x),
  'the consent log cannot be deleted by the athlete');

-- ----------------------------------------------------- 8 people, no more
select public.circle_invite_create() as code2 \gset
select proof.act('d0000000-0000-0000-0000-000000000001'); select public.circle_join(:'code2', 'P1', 'circles-v1');
select proof.act('d0000000-0000-0000-0000-000000000002'); select public.circle_join(:'code2', 'P2', 'circles-v1');
select proof.act('d0000000-0000-0000-0000-000000000003'); select public.circle_join(:'code2', 'P3', 'circles-v1');
select proof.act('d0000000-0000-0000-0000-000000000004'); select public.circle_join(:'code2', 'P4', 'circles-v1');
select proof.act('d0000000-0000-0000-0000-000000000005'); select public.circle_join(:'code2', 'P5', 'circles-v1');
select proof.act('d0000000-0000-0000-0000-000000000006'); select public.circle_join(:'code2', 'P6', 'circles-v1');
select proof.ok((select count(*) = 8 from public.circle_members), 'the circle holds 8');
select proof.act('d0000000-0000-0000-0000-000000000007');
select proof.refused($$select public.circle_join('$$ || :'code2' || $$', 'P7', 'circles-v1')$$,
  'a ninth person is refused');
select proof.act(:ann);
select proof.refused($$select public.circle_invite_create()$$, 'a full circle cannot make invites');

-- --------------------------------------------------- expired invites
select proof.admin();
update public.circle_invites set expires_at = now() - interval '1 minute';
select proof.act('d0000000-0000-0000-0000-000000000006');
select public.circle_leave();
select proof.act('d0000000-0000-0000-0000-000000000007');
select proof.refused($$select public.circle_join('$$ || :'code2' || $$', 'P7', 'circles-v1')$$,
  'an expired invite is refused even with a space free');

-- ------------------------------------------------------------------ leave
select proof.act(:ann);
select public.circle_nice_work(:ben, current_date - 1);
select proof.act(:ben);
select public.circle_nice_work(:ann, current_date - 1);
select public.circle_leave();
select proof.ok((select count(*) = 0 from public.circle_members), 'after leaving, Ben sees no circle');
select proof.act(:ann);
select proof.ok((select count(*) = 0 from public.circle_members where user_id = :ben), 'Ben is gone from the circle');
select proof.ok((select count(*) = 0 from public.circle_days where user_id = :ben), 'Ben''s days are gone');
select proof.ok((select count(*) = 0 from public.circle_cheers where :ben in (from_user, to_user)),
  'Nice work Ben gave and received is gone');
select proof.admin();
select proof.ok((select count(*) = 0 from public.circle_days where user_id = :ben),
  'Ben''s days are deleted, not just hidden');
select proof.ok((select count(*) = 1 from public.circle_sharing_log where user_id = :ben and event = 'left'),
  'leaving is written to Ben''s log');

-- ------------------------------------------- the programme is untouched
select proof.ok(not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                            where ns.nspname = 'public' and p.proname like 'circle%'
                              and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+public\.plans'),
  'no circle function writes the training plan');
select proof.ok((select string_agg(p.proname, ',') = 'circle_days_verified_completion'
                   from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname like 'circle%' and p.prosrc ~* '\mplans\M'),
  'only the done check reads it');

-- ------------------------------------------ deleting an account, last out
select proof.admin();
delete from auth.users where id <> :ann and id::text like 'd%';
select proof.ok((select count(*) = 1 from public.circle_members), 'deleted accounts leave the circle with them');
delete from auth.users where id = :ann;
select proof.ok((select count(*) = 0 from public.circles), 'the last account deleted takes the empty circle');
select proof.ok((select count(*) = 0 from public.circle_invites), 'and its invites');
select proof.ok((select count(*) = 0 from public.circle_days), 'and no training is left anywhere');

select proof.admin();
drop schema proof cascade;
\echo 'ALL CIRCLE RULES HELD'
