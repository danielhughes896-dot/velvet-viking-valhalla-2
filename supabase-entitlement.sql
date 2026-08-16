-- ===========================================================================
-- VELVET VIKING -- PHASE 3A1 ENTITLEMENT FOUNDATION
--
-- Adds the server-owned tables the account gate needs, and nothing else. No
-- payment logic, no trial logic, no commercial activation: those arrive in
-- 3A2 as INSERTs and UPDATEs against this same shape, not as a migration.
--
-- WHAT THIS ESTABLISHES
--   entitlements   one row per athlete. Access authority. Written only by the
--                  service role inside Vercel; readable by the athlete for
--                  display, never trusted from the browser.
--   access_leases  short-lived delivery credentials. Existence of a live row
--                  is what lets /api/app hand over the protected runtime, so
--                  deleting rows revokes access on every device at the next
--                  revalidation.
--
-- SAFE TO RUN TWICE. Every statement is idempotent, and the backfill only ever
-- ADDS access -- it never downgrades or removes an existing override.
--
-- THIS SCRIPT DOES NOT ACTIVATE ANYTHING. The gate is switched on by the
-- VVV_ACCOUNT_REQUIRED environment variable in Vercel, not by this schema.
-- Running this while the flag is off changes nothing an athlete can see.
--
-- IT ALSO DOES NOT TOUCH THE BETA GATE. supabase-beta-gate.sql is live and
-- verified; its trigger and its RLS predicates are left exactly as they are.
-- This reads beta_allowlist to seed overrides and writes nothing back to it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 -- THE OWNER UID
--
-- Replace the placeholder below with the uid already configured in Vercel as
-- VVV_OWNER_USER_ID. SQL cannot read that environment variable, so it has to
-- be stated here once; STEP 5 refuses to run while the placeholder is still
-- in place, exactly as the beta gate refuses example.com addresses.
--
-- The uid is NOT a secret (it is a random identifier that grants nothing on
-- its own), but there is no reason to paste it anywhere it is not needed.
-- ---------------------------------------------------------------------------
create or replace function public._vvv_owner_uid()
returns text language sql immutable as $$
  select 'REPLACE-WITH-VVV_OWNER_USER_ID'::text;
$$;

-- ---------------------------------------------------------------------------
-- STEP 2 -- ENTITLEMENTS
--
-- Deliberately small. `state` and `override` are the only enumerations; every
-- other access question is answered by a timestamp, so the row can never
-- disagree with itself the way a wider state machine can. "Cancelled but paid
-- through Friday" is state='active' + cancel_at_period_end=true +
-- access_until=Friday -- three facts that cannot contradict, rather than a
-- fourth state that can.
--
-- provider/provider_* are opaque strings on purpose: no payment provider's
-- vocabulary is allowed to become this application's access model.
-- ---------------------------------------------------------------------------
create table if not exists public.entitlements (
  user_id               uuid primary key references auth.users(id) on delete cascade,

  -- commercial state. Nothing in 3A1 writes anything but 'expired' here; the
  -- account gate runs entirely off `override` and the ACCOUNT_REQUIRED flag.
  state                 text        not null default 'expired'
                          check (state in ('trial','active','grace','expired')),
  tier                  text        not null default 'standard',
  access_until          timestamptz,
  cancel_at_period_end  boolean     not null default false,

  -- non-commercial access. Orthogonal to state on purpose: an owner is not a
  -- kind of subscriber, and a beta tester whose subscription lapses should not
  -- silently lose their tester access.
  override              text        check (override in ('owner','beta','promo')),
  override_expires_at   timestamptz,
  override_note         text,

  -- payment provider references, unused until 3A2
  provider              text,
  provider_customer_id  text,
  provider_sub_id       text,
  -- webhook ordering/idempotency, unused until 3A2
  event_seq             bigint,
  last_event_at         timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists entitlements_access_until_idx
  on public.entitlements (access_until);
create index if not exists entitlements_provider_sub_idx
  on public.entitlements (provider_sub_id);

alter table public.entitlements enable row level security;

-- The athlete may READ their own row so the app can show "beta access" or an
-- expiry date. They may not write it under any circumstances -- there is no
-- insert/update/delete policy, and RLS with no policy is deny-all. The service
-- role inside Vercel bypasses RLS and is the only writer.
drop policy if exists "read own entitlement" on public.entitlements;
create policy "read own entitlement" on public.entitlements
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- STEP 3 -- ACCESS LEASES
--
-- One row per delivery credential. The cookie carries only the opaque id; every
-- fact about the lease lives here, server-side, which is what makes revocation
-- real: deleting the row ends access at the next revalidation on every device,
-- without waiting for a token to expire.
--
-- Deliberately NOT recorded: IP address, user agent, device fingerprint. The
-- lease answers "may this browser still be handed the runtime", and that
-- question needs none of them.
-- ---------------------------------------------------------------------------
create table if not exists public.access_leases (
  id          text        primary key,             -- opaque, 256 bits of entropy
  user_id     uuid        not null references auth.users(id) on delete cascade,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);

create index if not exists access_leases_user_idx    on public.access_leases (user_id);
create index if not exists access_leases_expires_idx on public.access_leases (expires_at);

alter table public.access_leases enable row level security;
-- No policies at all: deny-all to anon and authenticated alike. A browser can
-- neither read nor forge a lease; only the service role touches this table.

-- Housekeeping. Expired leases carry no authority once past expires_at, so
-- this is tidiness rather than a security control.
create or replace function public.prune_access_leases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.access_leases
   where expires_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.prune_access_leases() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP 4 -- ACCOUNT DELETION MUST KILL THE LEASES
--
-- delete_own_account() already releases the plan-ownership stamp and removes
-- the auth row; access_leases and entitlements cascade from auth.users, so the
-- delete alone is sufficient. This trigger exists for the OTHER direction --
-- an entitlement revoked by an operator (beta withdrawn, refund) must not
-- leave a live delivery cookie valid for the rest of its TTL.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_leases_on_entitlement_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- only when access was actually taken away, never on an ordinary renewal
  if (old.override is not null and new.override is null)
     or (new.state = 'expired' and old.state <> 'expired') then
    update public.access_leases
       set revoked_at = now()
     where user_id = new.user_id and revoked_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists entitlement_revocation_kills_leases on public.entitlements;
create trigger entitlement_revocation_kills_leases
  after update on public.entitlements
  for each row execute function public.revoke_leases_on_entitlement_change();

-- ---------------------------------------------------------------------------
-- STEP 5 -- BACKFILL: OWNER AND BETA
--
-- Adds product access for everyone who already has it. Refuses to run while
-- the owner placeholder is unedited, so a half-configured deployment cannot
-- quietly end up with no owner.
--
-- Beta identities are read from the LIVE beta_allowlist by joining to
-- auth.users on email. A tester who has not signed in yet has no auth row and
-- therefore no entitlement row -- that is correct and self-correcting, because
-- STEP 6 gives them one the moment they first sign in.
-- ---------------------------------------------------------------------------
do $$
declare
  owner_uid text := public._vvv_owner_uid();
  beta_n    integer;
begin
  if owner_uid is null or owner_uid = '' or owner_uid like 'REPLACE-WITH-%' then
    raise exception
      'ABORTED: edit STEP 1 with the uid held in Vercel as VVV_OWNER_USER_ID, then run again. Nothing has been changed.';
  end if;
  if owner_uid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'ABORTED: STEP 1 does not look like a uuid. Nothing has been changed.';
  end if;
  if not exists (select 1 from auth.users where id = owner_uid::uuid) then
    raise exception 'ABORTED: no auth user with that id exists in this project. Nothing has been changed.';
  end if;

  -- OWNER. Product access only. This grants nothing administrative: /api/admin-*
  -- check VVV_OWNER_USER_ID from the environment independently and do not read
  -- this table, so an override written here can never become admin authority.
  insert into public.entitlements (user_id, override, override_note)
  values (owner_uid::uuid, 'owner', 'phase 3a1 backfill')
  on conflict (user_id) do update
    set override = 'owner', override_expires_at = null, updated_at = now();

  -- BETA. Every approved, unrevoked tester who has an account.
  with approved as (
    select u.id
      from public.beta_allowlist b
      join auth.users u on lower(u.email) = b.email
     where b.revoked_at is null
  )
  insert into public.entitlements (user_id, override, override_note)
  select id, 'beta', 'phase 3a1 backfill' from approved
  on conflict (user_id) do update
    -- never demote an owner to a beta tester
    set override = case when public.entitlements.override = 'owner' then 'owner' else 'beta' end,
        updated_at = now();

  select count(*) into beta_n from public.entitlements where override = 'beta';
  raise notice 'backfill complete: owner=1 beta=%', beta_n;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 6 -- NEW SIGN-INS INHERIT BETA AUTOMATICALLY
--
-- The beta trigger already refuses to create an auth user for an address that
-- is not on the allowlist, so any account that comes into existence from here
-- IS an approved tester. Giving it the override on creation means a tester who
-- signs in for the first time after this migration is not locked out by an
-- ordering accident.
--
-- This becomes the wrong default the moment ordinary paying customers can sign
-- up, so 3A2 must replace it -- noted here rather than in a ticket because the
-- consequence of forgetting is free access.
-- ---------------------------------------------------------------------------
create or replace function public.seed_entitlement_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.entitlements (user_id, override, override_note)
  values (new.id, 'beta', 'auto-seeded at signup while private beta is the only route in')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_entitlement_on_signup on auth.users;
create trigger seed_entitlement_on_signup
  after insert on auth.users
  for each row execute function public.seed_entitlement_for_new_user();

-- ---------------------------------------------------------------------------
-- STEP 7 -- VERIFY
--
-- Run on its own and read the result. Every number should be explicable.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.entitlements where override = 'owner')          as owners,
  (select count(*) from public.entitlements where override = 'beta')           as beta_users,
  (select count(*) from public.beta_allowlist where revoked_at is null)        as approved_testers,
  (select count(*) from public.access_leases where revoked_at is null
      and expires_at > now())                                                  as live_leases,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='entitlements')                   as entitlement_policies,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='access_leases')                  as lease_policies_expect_0,
  (select count(*) from pg_trigger
     where tgname = 'seed_entitlement_on_signup')                              as signup_trigger,
  (select count(*) from pg_trigger
     where tgname = 'entitlement_revocation_kills_leases')                     as revocation_trigger;
