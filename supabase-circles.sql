-- ===========================================================================
-- CIRCLES: A SMALL PRIVATE GROUP THAT SEES WHETHER EACH MEMBER DID THEIR PLAN
--
-- Founder: "a private circle experience to make users accountable. Not open
-- socials. Just I can share my experience with people I choose to. Then have
-- accountability through a table of completed workouts." And, made
-- non-negotiable: "Joining a circle must require explicit consent, and each
-- athlete should be able to leave, hide their training details and stop
-- sharing without affecting their SACORO programme."
--
-- THIS IS THE FIRST TIME ONE ATHLETE'S DATA IS VISIBLE TO ANOTHER. Every
-- other table in this database is readable by its owner and nobody else. So
-- the shape of this file is: share the least that makes the table work, let
-- the database (not the app) enforce every rule that protects somebody, and
-- refuse to run if any of it has drifted.
--
-- WHAT A CIRCLE CAN SEE OF A MEMBER, AND NOTHING ELSE
--   * the name they chose to show (not their email, not their account)
--   * per day: done, missed, rest, restricted ("Resting by plan") or planned
--   * the session's name on a done or missed day ("Long run")
--   * kilometres on a done day, ONLY if that member has switched km on
--   * the "Nice work" each member has given and received in the circle
-- NEVER: pace, heart rate, readiness, notes, the plan itself, the reason for
-- a restriction, or anything about their body. None of it has a column here.
--
-- THE PROGRAMME IS UNTOUCHED. Nothing in this file writes public.plans. It is
-- read in exactly one place, to confirm that a day sent as "done" is a session
-- the athlete's own plan records as completed (STEP 4b); nothing read there is
-- shared. A circle receives a copy of what the athlete has done; nothing flows
-- back. Joining, pausing and leaving change nothing in anyone's plan.
--
-- HOW CHANGES ARE MADE. The browser can READ what its circle may see and can
-- WRITE only its own day rows. Every other change -- create, invite, join,
-- pause, km on or off, Nice work, leave -- goes through a function below that
-- checks the rule before it acts. There are no client insert, update or
-- delete policies on the membership, invite, Nice work or log tables, so
-- those rules cannot be stepped around with the public key.
--
-- WHERE IT SITS IN THE ORDER. After supabase-security-posture.sql (file 10):
-- every table here is created with row-level security on, so re-running 10
-- afterwards passes. It needs nothing from files 2 to 9.
--
-- Safe to re-run.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 -- THE TABLES
-- ---------------------------------------------------------------------------

-- The circle itself: a name, and nothing that points at a person. Who
-- started it is in that person's own consent log ('created'), which goes
-- with their account -- so a circle never outlives anyone's data, and the
-- billing ledger stays the only row in this database that survives a
-- deleted account (LEGAL-FACTS.md, section 6).
create table if not exists public.circles (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (char_length(btrim(name)) between 1 and 40),
  created_at  timestamptz not null default now()
);
alter table public.circles enable row level security;

-- ONE CIRCLE PER PERSON is the primary key: a user_id can appear once. The
-- consent the athlete gave to join is on the row itself, so a membership
-- without a recorded agreement cannot exist (both columns are NOT NULL), and
-- the full history of every decision is in circle_sharing_log below.
-- show_km defaults OFF (founder: "making the weekly kilometres optional,
-- because distance comparisons aren't really the purpose").
create table if not exists public.circle_members (
  user_id         uuid        primary key references auth.users(id) on delete cascade,
  circle_id       uuid        not null references public.circles(id) on delete cascade,
  display_name    text        not null check (char_length(btrim(display_name)) between 1 and 24),
  sharing         boolean     not null default true,
  show_km         boolean     not null default false,
  consent_version text        not null check (char_length(consent_version) between 1 and 40),
  consented_at    timestamptz not null,
  joined_at       timestamptz not null default now()
);
create index if not exists circle_members_circle_idx
  on public.circle_members (circle_id, joined_at);
alter table public.circle_members enable row level security;

-- Invite codes. SERVICE-ONLY: row-level security with no policy at all, so no
-- browser can list, read or forge one. They are made and redeemed only by the
-- functions below. Twelve hex characters (48 bits) that expire after 7 days.
create table if not exists public.circle_invites (
  code        text        primary key check (code ~ '^[a-f0-9]{12}$'),
  circle_id   uuid        not null references public.circles(id) on delete cascade,
  created_by  uuid        references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days'
);
alter table public.circle_invites enable row level security;

-- One row per member per day: what the table draws. Keyed to the MEMBERSHIP,
-- so leaving deletes every one of a member's days by cascade -- there is no
-- way for a former member's training to stay behind in a circle.
-- A restricted day carries no session name: the circle sees "Resting by
-- plan", never why. Kilometres only ever sit on a done day.
create table if not exists public.circle_days (
  user_id       uuid        not null references public.circle_members(user_id) on delete cascade,
  day           date        not null,
  state         text        not null check (state in ('done','missed','rest','restricted','planned')),
  session_label text        check (session_label is null or char_length(session_label) between 1 and 40),
  km            numeric(5,2) check (km is null or (km > 0 and km <= 300)),
  updated_at    timestamptz not null default now(),
  primary key (user_id, day),
  constraint circle_days_restricted_says_nothing check (state <> 'restricted' or session_label is null),
  constraint circle_days_km_only_when_done      check (km is null or state = 'done'),
  constraint circle_days_label_only_for_finished check (session_label is null or state in ('done','missed'))
);
alter table public.circle_days enable row level security;
-- A NAME ONLY ON A DAY THAT HAS HAPPENED. A planned day's session name would
-- show the circle the athlete's plan ahead, and the circle never sees the
-- plan. Added to production on its first application (from outside this
-- file) and adopted here so the file matches it; added by name for a
-- database that ran an earlier version of this file.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'circle_days_label_only_for_finished'
                    and conrelid = 'public.circle_days'::regclass) then
    alter table public.circle_days add constraint circle_days_label_only_for_finished
      check (session_label is null or state in ('done','missed'));
  end if;
end $$;

-- "Nice work": one per giver, per receiver, per day. Keyed to both
-- memberships, so it disappears with either member when they leave.
create table if not exists public.circle_cheers (
  id          bigint      generated by default as identity primary key,
  circle_id   uuid        not null references public.circles(id) on delete cascade,
  from_user   uuid        not null references public.circle_members(user_id) on delete cascade,
  to_user     uuid        not null references public.circle_members(user_id) on delete cascade,
  day         date        not null,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz,
  constraint circle_cheers_not_self check (from_user <> to_user),
  constraint circle_cheers_once     unique (from_user, to_user, day)
);
create index if not exists circle_cheers_to_idx on public.circle_cheers (to_user, seen_at);
alter table public.circle_cheers enable row level security;

-- THE PROOF OF CONSENT, the same reasoning as health_data_consent: one row
-- per decision, never updated, never deleted by the athlete, so "what did
-- they agree to share, and when" survives them changing their mind. It holds
-- no training data. circle_id carries no foreign key on purpose: the record
-- of having left a circle must outlive the circle.
create table if not exists public.circle_sharing_log (
  id              bigint      generated by default as identity primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  circle_id       uuid        not null,
  event           text        not null check (event in
                    ('created','joined','paused','resumed','km_on','km_off','left')),
  consent_version text,
  at              timestamptz not null default now()
);
create index if not exists circle_sharing_log_user_idx on public.circle_sharing_log (user_id, at desc);
alter table public.circle_sharing_log enable row level security;


-- ---------------------------------------------------------------------------
-- STEP 2 -- THE TWO QUESTIONS EVERY POLICY ASKS
--
-- "Which circle am I in?" and "who in it is sharing?". SECURITY DEFINER so a
-- policy on circle_members can ask about circle_members without recursing
-- into itself; pinned to the empty search path like every definer function
-- in this database; executable by signed-in users only.
-- ---------------------------------------------------------------------------
create or replace function public.circle_my_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.circle_id from public.circle_members m where m.user_id = auth.uid()
$$;

create or replace function public.circle_sharing_members()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id
    from public.circle_members m
   where m.sharing
     and m.circle_id = (select me.circle_id from public.circle_members me where me.user_id = auth.uid())
$$;


-- ---------------------------------------------------------------------------
-- STEP 3 -- ROW-LEVEL SECURITY
--
--   circles             read your own circle. Nothing else.
--   circle_members      read the members of your own circle. No writes.
--   circle_invites      nothing. Service-only.
--   circle_days         read your own days, and the days of members of your
--                       circle who are sharing. Write your own days, and
--                       only while you are sharing.
--   circle_cheers       read the Nice work in your circle. Take back one you
--                       gave. Giving one goes through circle_nice_work().
--   circle_sharing_log  read your own history. Nothing else, ever.
--
-- (select ...) around each function call for the InitPlan reason written out
-- in supabase-security-posture.sql: evaluated once per statement, not per row.
-- Every policy is FOR the signed-in role only, so the anonymous key is not
-- refused with an error: it simply has no policy, and sees nothing.
-- ---------------------------------------------------------------------------
drop policy if exists "circle: read own" on public.circles;
create policy "circle: read own" on public.circles
  for select to authenticated using (id = (select public.circle_my_id()));

drop policy if exists "circle members: read own circle" on public.circle_members;
create policy "circle members: read own circle" on public.circle_members
  for select to authenticated using (circle_id = (select public.circle_my_id()));

drop policy if exists "circle days: read own and sharing members" on public.circle_days;
drop policy if exists "circle days: insert own while sharing"     on public.circle_days;
drop policy if exists "circle days: update own while sharing"     on public.circle_days;
drop policy if exists "circle days: delete own"                   on public.circle_days;
create policy "circle days: read own and sharing members" on public.circle_days
  for select to authenticated using (
    user_id = (select auth.uid())
    or user_id in (select public.circle_sharing_members())
  );
create policy "circle days: insert own while sharing" on public.circle_days
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and user_id in (select public.circle_sharing_members())
  );
create policy "circle days: update own while sharing" on public.circle_days
  for update to authenticated using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and user_id in (select public.circle_sharing_members())
  );
create policy "circle days: delete own" on public.circle_days
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "circle cheers: read own circle" on public.circle_cheers;
drop policy if exists "circle cheers: take back own"   on public.circle_cheers;
create policy "circle cheers: read own circle" on public.circle_cheers
  for select to authenticated using (circle_id = (select public.circle_my_id()));
create policy "circle cheers: take back own" on public.circle_cheers
  for delete to authenticated using (from_user = (select auth.uid()));

drop policy if exists "circle log: read own" on public.circle_sharing_log;
create policy "circle log: read own" on public.circle_sharing_log
  for select to authenticated using (user_id = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- STEP 4 -- KILOMETRES ARE NOT STORED UNLESS THE MEMBER HAS SWITCHED THEM ON
--
-- Enforced here rather than trusted to the app: a day written with km while
-- show_km is off has its km dropped on the way in, and switching km off
-- removes every km already shared. Turning it off is a privacy act, so it
-- deletes, it does not hide.
-- ---------------------------------------------------------------------------
create or replace function public.circle_days_km_gate()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.km is not null and not exists (
       select 1 from public.circle_members m where m.user_id = new.user_id and m.show_km) then
    new.km := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists circle_days_km_gate on public.circle_days;
create trigger circle_days_km_gate
  before insert or update on public.circle_days
  for each row execute function public.circle_days_km_gate();

create or replace function public.circle_members_km_off()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.show_km and not new.show_km then
    update public.circle_days set km = null where user_id = new.user_id and km is not null;
  end if;
  return new;
end $$;

drop trigger if exists circle_members_km_off on public.circle_members;
create trigger circle_members_km_off
  after update of show_km on public.circle_members
  for each row execute function public.circle_members_km_off();


-- ---------------------------------------------------------------------------
-- STEP 4b -- "DONE" MUST BE A SESSION THE PLAN RECORDS AS COMPLETED
--
-- Agreed with the founder: a day can only show green in a circle when the
-- athlete's own SACORO plan (public.plans, synced from the app) records that
-- day as completed. A row sent as done that the plan does not confirm is
-- SKIPPED -- not stored, and not an error -- so one day that has not synced
-- yet never stops the rest of the week reaching the circle; it arrives on
-- the next send, after the plan itself has synced.
--
-- IT CONFIRMS, IT DOES NOT COPY. An earlier live version of this check (not
-- from this file) also copied the plan's recorded distance into the shared
-- row. It ran after the km gate above, so it put km back on the day of an
-- athlete who had km switched OFF -- breaking the consent screen's "Kilometres
-- only if you turn them on". This version never touches km or the session
-- name: km is decided by the athlete's own switch alone (STEP 4), and the
-- name is the short one the app sends.
-- ---------------------------------------------------------------------------
create or replace function public.circle_days_verified_completion()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state = 'done' and not exists (
       select 1
         from public.plans p
        cross join lateral jsonb_array_elements(coalesce(p.data->'days', '[]'::jsonb)) d(value)
        where p.user_id = new.user_id
          and d.value->>'date' = new.day::text
          and d.value->>'completed' = 'true') then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists circle_days_verified_completion on public.circle_days;
create trigger circle_days_verified_completion
  before insert or update on public.circle_days
  for each row execute function public.circle_days_verified_completion();


-- ---------------------------------------------------------------------------
-- STEP 5 -- THE ACTIONS
--
-- Each checks its rule, acts, and records the decision in the log where the
-- decision is about sharing. Each refuses with a plain sentence the app can
-- show. All are SECURITY DEFINER on the empty search path and executable by
-- signed-in users only.
-- ---------------------------------------------------------------------------
create or replace function public.circle_create(p_name text, p_display_name text, p_consent_version text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid(); new_id uuid;
begin
  if me is null then raise exception 'Sign in to start a circle.'; end if;
  if exists (select 1 from public.circle_members where user_id = me) then
    raise exception 'You are already in a circle. Leave it to start another.';
  end if;
  if coalesce(btrim(p_consent_version), '') = '' then
    raise exception 'Agree to what your circle will see before starting one.';
  end if;
  insert into public.circles (name) values (btrim(p_name)) returning id into new_id;
  insert into public.circle_members (user_id, circle_id, display_name, consent_version, consented_at)
    values (me, new_id, btrim(p_display_name), p_consent_version, now());
  insert into public.circle_sharing_log (user_id, circle_id, event, consent_version)
    values (me, new_id, 'created', p_consent_version);
  return new_id;
end $$;

create or replace function public.circle_invite_create()
returns text
language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid(); cid uuid; c text;
begin
  select circle_id into cid from public.circle_members where user_id = me;
  if cid is null then raise exception 'Join or start a circle before inviting anyone.'; end if;
  if (select count(*) from public.circle_members where circle_id = cid) >= 8 then
    raise exception 'Your circle is full. A circle holds up to 8 people.';
  end if;
  delete from public.circle_invites where expires_at < now();
  c := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 12);
  insert into public.circle_invites (code, circle_id, created_by) values (c, cid, me);
  return c;
end $$;

create or replace function public.circle_join(p_code text, p_display_name text, p_consent_version text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid(); cid uuid;
begin
  if me is null then raise exception 'Sign in to join a circle.'; end if;
  if exists (select 1 from public.circle_members where user_id = me) then
    raise exception 'You are already in a circle. Leave it to join another.';
  end if;
  if coalesce(btrim(p_consent_version), '') = '' then
    raise exception 'Agree to what your circle will see before joining.';
  end if;
  select circle_id into cid from public.circle_invites
   where code = lower(btrim(p_code)) and expires_at >= now();
  if cid is null then raise exception 'That invite has expired or does not exist. Ask for a new one.'; end if;
  -- Locked, so two people accepting at the same moment cannot make it nine.
  perform 1 from public.circles where id = cid for update;
  if (select count(*) from public.circle_members where circle_id = cid) >= 8 then
    raise exception 'That circle is full. A circle holds up to 8 people.';
  end if;
  insert into public.circle_members (user_id, circle_id, display_name, consent_version, consented_at)
    values (me, cid, btrim(p_display_name), p_consent_version, now());
  insert into public.circle_sharing_log (user_id, circle_id, event, consent_version)
    values (me, cid, 'joined', p_consent_version);
  return cid;
end $$;

-- Stop or start sharing, and km on or off. Null leaves a setting as it is.
create or replace function public.circle_set_sharing(p_sharing boolean, p_show_km boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid(); m public.circle_members;
begin
  select * into m from public.circle_members where user_id = me;
  if m.user_id is null then raise exception 'You are not in a circle.'; end if;
  if p_sharing is not null and p_sharing <> m.sharing then
    update public.circle_members set sharing = p_sharing where user_id = me;
    insert into public.circle_sharing_log (user_id, circle_id, event)
      values (me, m.circle_id, case when p_sharing then 'resumed' else 'paused' end);
  end if;
  if p_show_km is not null and p_show_km <> m.show_km then
    update public.circle_members set show_km = p_show_km where user_id = me;
    insert into public.circle_sharing_log (user_id, circle_id, event)
      values (me, m.circle_id, case when p_show_km then 'km_on' else 'km_off' end);
  end if;
end $$;

-- Leaving deletes the membership; the cascades take every day row and every
-- Nice work given or received with it.
create or replace function public.circle_leave()
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid(); cid uuid;
begin
  select circle_id into cid from public.circle_members where user_id = me;
  if cid is null then return; end if;
  delete from public.circle_members where user_id = me;
  insert into public.circle_sharing_log (user_id, circle_id, event) values (me, cid, 'left');
end $$;

-- THE LAST ONE OUT TAKES THE CIRCLE, however they left: through Leave, or by
-- deleting their SACORO account (which removes the membership by cascade and
-- never passes through circle_leave). The circle's name and invites go with it.
create or replace function public.circle_members_last_out()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.circle_members where circle_id = old.circle_id) then
    delete from public.circles where id = old.circle_id;
  end if;
  return null;
end $$;

drop trigger if exists circle_members_last_out on public.circle_members;
create trigger circle_members_last_out
  after delete on public.circle_members
  for each row execute function public.circle_members_last_out();

-- "Nice work" on another member's done day, in the last 7 days, while they
-- are sharing it. Once per giver, receiver and day.
create or replace function public.circle_nice_work(p_to uuid, p_day date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid(); cid uuid;
begin
  select circle_id into cid from public.circle_members where user_id = me;
  if cid is null then raise exception 'You are not in a circle.'; end if;
  if p_to = me then raise exception 'Nice work is for someone else.'; end if;
  if not exists (select 1 from public.circle_members
                  where user_id = p_to and circle_id = cid and sharing) then
    raise exception 'That person is not sharing with your circle.';
  end if;
  if p_day > current_date or p_day < current_date - 6 then
    raise exception 'Nice work is for the last 7 days.';
  end if;
  if not exists (select 1 from public.circle_days
                  where user_id = p_to and day = p_day and state = 'done') then
    raise exception 'There is no finished session on that day.';
  end if;
  insert into public.circle_cheers (circle_id, from_user, to_user, day)
    values (cid, me, p_to, p_day)
  on conflict on constraint circle_cheers_once do nothing;
end $$;

-- The line on Today has been read: mark the caller's received Nice work seen.
create or replace function public.circle_nice_work_seen()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.circle_cheers set seen_at = now()
   where to_user = auth.uid() and seen_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'circle_my_id()', 'circle_sharing_members()',
    'circle_create(text, text, text)', 'circle_invite_create()',
    'circle_join(text, text, text)', 'circle_set_sharing(boolean, boolean)',
    'circle_leave()', 'circle_nice_work(uuid, date)', 'circle_nice_work_seen()']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  -- Trigger functions are never called directly by anyone.
  execute 'revoke all on function public.circle_days_km_gate() from public, anon, authenticated';
  execute 'revoke all on function public.circle_members_km_off() from public, anon, authenticated';
  execute 'revoke all on function public.circle_members_last_out() from public, anon, authenticated';
  execute 'revoke all on function public.circle_days_verified_completion() from public, anon, authenticated';
end $$;


-- ---------------------------------------------------------------------------
-- STEP 6 -- REFUSE IF THE POSTURE IS WRONG
--
-- Everything above is idempotent, so on a second run this file's value is in
-- what it CHECKS. Each line is a way somebody's training could leak, or a
-- rule could be stepped around, without anybody noticing.
-- ---------------------------------------------------------------------------
do $$
declare
  t text; v text; n integer;
  circle_tables text[] := array['circles','circle_members','circle_invites',
                                'circle_days','circle_cheers','circle_sharing_log'];
begin
  -- 1. Row-level security on every circle table.
  foreach t in array circle_tables loop
    if not (select c.relrowsecurity from pg_class c
             where c.oid = ('public.' || t)::regclass) then
      raise exception using errcode = 'raise_exception',
        message = t || ' has row-level security OFF. Nothing has been changed.';
    end if;
  end loop;

  -- 2. Invites are service-only: no browser policy of any kind.
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'circle_invites';
  if n > 0 then
    raise exception using errcode = 'raise_exception',
      message = 'circle_invites must have no client policy, but has ' || n || '. Nothing has been changed.';
  end if;

  -- 3. Membership, Nice work and the log are written only by the checked
  --    functions. A client INSERT/UPDATE policy on any of them, or a DELETE
  --    on membership or the log, would let a rule be stepped around.
  select string_agg(tablename || ': ' || policyname || ' (' || cmd || ')', ', ') into v
    from pg_policies
   where schemaname = 'public'
     and (   (tablename in ('circles','circle_members','circle_sharing_log') and cmd <> 'SELECT')
          or (tablename = 'circle_cheers' and cmd not in ('SELECT','DELETE')));
  if v is not null then
    raise exception using errcode = 'raise_exception',
      message = 'These policies let a circle rule be bypassed: ' || v || '. Nothing has been changed.';
  end if;

  -- 4. Every policy applies to signed-in users only.
  select string_agg(tablename || ': ' || policyname, ', ') into v
    from pg_policies
   where schemaname = 'public' and tablename = any(circle_tables)
     and roles <> '{authenticated}';
  if v is not null then
    raise exception using errcode = 'raise_exception',
      message = 'These circle policies reach beyond signed-in users: ' || v || '. Nothing has been changed.';
  end if;

  -- 5. Every policy names the caller or the caller's circle.
  select string_agg(tablename || ': ' || policyname, ', ') into v
    from pg_policies
   where schemaname = 'public' and tablename = any(circle_tables)
     and coalesce(qual, '') || coalesce(with_check, '') not like '%auth.uid()%'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%circle_my_id()%';
  if v is not null then
    raise exception using errcode = 'raise_exception',
      message = 'These circle policies are not scoped to the caller: ' || v || '. Nothing has been changed.';
  end if;

  -- 6. Every circle function runs on the empty search path and is closed to
  --    the anonymous key.
  select string_agg(p.proname, ', ') into v
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like 'circle%'
     and (p.proconfig is null or not ('search_path=""' = any(p.proconfig)));
  if v is not null then
    raise exception using errcode = 'raise_exception',
      message = 'These circle functions are not pinned to the empty search path: ' || v || '. Nothing has been changed.';
  end if;
  select string_agg(p.proname, ', ') into v
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like 'circle%'
     and has_function_privilege('anon', p.oid, 'execute');
  if v is not null then
    raise exception using errcode = 'raise_exception',
      message = 'The anonymous key can call these circle functions: ' || v || '. Nothing has been changed.';
  end if;

  raise notice 'Circles: row-level security, write paths and functions are as designed.';
end $$;

-- Quick check:
--   select tablename, policyname, cmd from pg_policies where tablename like 'circle%' order by 1, 3;
