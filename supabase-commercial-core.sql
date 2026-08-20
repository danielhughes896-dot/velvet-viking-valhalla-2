-- ===========================================================================
-- VELVET VIKING -- COMMERCIAL CORE (Phase 1)
--
-- The provider-neutral foundation that web billing, Apple StoreKit and Google
-- Play Billing will all feed. It sells nothing, charges nothing, starts no
-- trial and grants no paid access.
--
-- WHAT THIS ADDS
--   account_commercial   one row per athlete. Owns the ONE introductory trial
--                        allowance, at ACCOUNT level, across every provider.
--   subscriptions        provider-neutral mirror of purchases. Many per
--                        account, over time and across providers.
--   entitlement_grants   administrative access -- beta testers, comps. NOT
--                        subscriptions and never modelled as fake ones.
--   billing_events       provider event ledger. Its unique constraint is what
--                        makes a redelivered webhook harmless.
--
-- WHAT THIS DOES NOT TOUCH
--   entitlements   the deployed account gate reads it and keeps reading it.
--                  This script does not alter its shape, its policies or its
--                  trigger. It becomes a PROJECTION of the tables above,
--                  written by _commercial-store.js -- but that happens at
--                  runtime, not here.
--   plans, strava_*, beta_allowlist, access_leases   untouched.
--   auth.users     read only. No column is added to it and no athlete
--                  identity is duplicated: auth.users.id IS the account id.
--
-- SAFE TO RUN TWICE. Every statement is idempotent. The beta backfill in
-- STEP 6 only ever ADDS a grant, is protected by a partial unique index, and
-- deletes nothing.
--
-- IT ALSO STARTS NOBODY'S TRIAL. Creating an account_commercial row records
-- that the allowance is UNUSED. There is no code path in this file that writes
-- trial_consumed_at, and the backfill deliberately leaves every migrated beta
-- athlete's fourteen days intact.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 -- ACCOUNT COMMERCIAL STATE
--
-- The account's commercial facts that belong to NO provider. Today that is one
-- thing: whether the athlete has used their single introductory trial.
--
-- WHY THIS IS NOT A COLUMN ON entitlements. That row is the access gate's
-- cache and is rewritten from a projection; the trial allowance is a permanent
-- historical fact that must survive every rewrite, every lapse and every
-- provider change. A fact you can lose by recomputing a cache is a fact you
-- will eventually lose.
--
-- WHY IT IS NOT ON auth.users. That table belongs to GoTrue. Adding product
-- columns to somebody else's schema is how an upgrade silently drops them.
--
-- ONE ROW PER ATHLETE, keyed on the auth uid. Email appears nowhere: it is
-- mutable, and an athlete who changes it must keep their purchases, their
-- trial history and their training.
-- ---------------------------------------------------------------------------
create table if not exists public.account_commercial (
  account_id                    uuid primary key
                                  references auth.users(id) on delete cascade,

  -- THE ONE TRIAL. Null means never used. Set means used, once, forever --
  -- there is deliberately no "reset" anywhere in the application, because a
  -- trial you can reset is a trial you can farm.
  trial_consumed_at             timestamptz,
  trial_consumed_provider       text check (trial_consumed_provider in ('web','apple','google')),
  trial_consumed_subscription_id uuid,

  -- Separate from consumption on purpose: "used their trial" and "we have
  -- stopped offering them one" are different sentences to a support agent.
  trial_blocked_at              timestamptz,
  trial_blocked_reason          text,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

alter table public.account_commercial enable row level security;

-- The athlete may READ their own row, so a screen can say "your free trial has
-- already been used" honestly. They may not write it under any circumstances:
-- there is no insert, update or delete policy, and RLS with no policy is
-- deny-all. The service role inside Vercel is the only writer.
drop policy if exists "read own commercial state" on public.account_commercial;
create policy "read own commercial state" on public.account_commercial
  for select using (auth.uid() = account_id);


-- ---------------------------------------------------------------------------
-- STEP 2 -- SUBSCRIPTIONS
--
-- A purchase, mirrored from the provider that owns it.
--
-- WHO OWNS WHAT. Everything in this table except account_id is a MIRROR of a
-- fact the provider owns. We never invent a period end, never extend a trial,
-- never decide a subscription renewed. When we disagree with the provider, the
-- provider is right and a reconciliation overwrites us. account_id is the one
-- column that is OURS, and it is never written from a provider payload -- that
-- is what stops a crafted webhook re-pointing somebody's purchase at another
-- athlete.
--
-- `condition` is OUR six-word vocabulary, normalised at each provider adapter.
-- Stripe's `past_due`, Apple's billing-retry and Google's SUBSCRIPTION_ON_HOLD
-- all arrive here as 'past_due'. No provider's enum is allowed to become this
-- application's model.
--
-- NOTE WHAT IS NOT A CONDITION: grace. Grace is grace_period_end, a timestamp
-- the PROVIDER supplies. Valhalla does not add a grace period of its own, and
-- a past_due row with no provider grace end grants nothing.
--
-- NO CARD DATA. Not a PAN, not a last-four, not an expiry, not a brand. The
-- provider holds the instrument; we hold an opaque customer id at most.
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  account_id                uuid not null references auth.users(id) on delete cascade,

  -- provider identity
  provider                  text not null check (provider in ('web','apple','google')),
  provider_subscription_id  text not null,
  provider_customer_id      text,
  provider_product_id       text,          -- their id for the thing sold

  -- our catalogue
  product_code              text not null default 'VALHALLA_STANDARD'
                              check (product_code = 'VALHALLA_STANDARD'),
  offer_code                text check (offer_code in ('STANDARD_MONTHLY','STANDARD_YEARLY')),
  billing_period            text check (billing_period in ('monthly','yearly')),

  -- lifecycle, in our vocabulary
  condition                 text not null
                              check (condition in ('trialing','active','cancelled',
                                                   'past_due','expired','revoked')),

  -- the dates access is actually decided by
  trial_start               timestamptz,
  trial_end                 timestamptz,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  grace_period_end          timestamptz,   -- PROVIDER-supplied. Never ours.

  auto_renew                boolean not null default true,
  cancel_at_period_end      boolean not null default false,
  cancelled_at              timestamptz,

  -- Sandbox and production notifications are indistinguishable once this
  -- column does not exist, and telling them apart afterwards means guessing
  -- from identifier shapes. Recorded from the first row rather than added in a
  -- hurry the week before launch.
  environment               text not null default 'production'
                              check (environment in ('production','sandbox')),

  provider_updated_at       timestamptz,   -- the provider's own clock
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- The provider's identity for the purchase. This is what makes an upsert from
-- a redelivered event land on the same row instead of creating a second
-- subscription, and it is the only identifier guaranteed stable across
-- redeliveries.
create unique index if not exists subscriptions_provider_identity
  on public.subscriptions (provider, provider_subscription_id);

create index if not exists subscriptions_account_idx
  on public.subscriptions (account_id);
-- Serves the duplicate-purchase check and the expiry sweep alike.
create index if not exists subscriptions_live_idx
  on public.subscriptions (account_id, condition, current_period_end);

alter table public.subscriptions enable row level security;

-- Read-own so an account screen can show what the athlete bought and where.
-- No write policy of any kind: an athlete cannot insert themselves a paid
-- subscription, and cannot edit a period end to extend their own access.
drop policy if exists "read own subscriptions" on public.subscriptions;
create policy "read own subscriptions" on public.subscriptions
  for select using (auth.uid() = account_id);


-- ---------------------------------------------------------------------------
-- STEP 3 -- ENTITLEMENT GRANTS
--
-- Access that was given rather than bought: beta testers and comps.
--
-- WHY THESE ARE NOT SUBSCRIPTIONS. A beta tester is not a customer on a
-- strange price. Writing them into the subscriptions table would put fiction
-- into every revenue question anyone ever asks -- "how many subscribers do we
-- have" would need an asterisk forever -- and it would consume the trial
-- allowance of somebody who has bought nothing.
--
-- WHY A TABLE AND NOT A COLUMN. An athlete can legitimately hold more than one
-- source at once: a beta grant AND a new paid subscription during the
-- changeover, or a comp issued while a card is being sorted out. With one
-- override column, removing either takes access away. With rows, the resolver
-- folds over what remains and removing one grant is safe by construction.
--
-- REVOCATION IS A TIMESTAMP, never a delete. An audit trail you can delete is
-- not an audit trail.
-- ---------------------------------------------------------------------------
create table if not exists public.entitlement_grants (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references auth.users(id) on delete cascade,

  source        text not null check (source in ('admin_beta','admin_comp')),
  product_code  text not null default 'VALHALLA_STANDARD'
                  check (product_code = 'VALHALLA_STANDARD'),

  -- null = indefinite, which is what a beta grant is until somebody ends it
  expires_at    timestamptz,

  granted_by    uuid,          -- the owner uid that issued it, for audit
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid,
  note          text,

  created_at    timestamptz not null default now()
);

-- ONE LIVE GRANT OF EACH KIND PER ACCOUNT. This is what makes the beta
-- backfill idempotent: re-running it collides and adds nothing. Partial, so a
-- revoked grant stays on the record and a fresh one can still be issued later.
create unique index if not exists entitlement_grants_one_live_per_source
  on public.entitlement_grants (account_id, source)
  where revoked_at is null;

create index if not exists entitlement_grants_account_idx
  on public.entitlement_grants (account_id) where revoked_at is null;

alter table public.entitlement_grants enable row level security;

-- Read-own, so the app can say "beta access". No write policy: an athlete
-- cannot issue themselves a comp.
drop policy if exists "read own grants" on public.entitlement_grants;
create policy "read own grants" on public.entitlement_grants
  for select using (auth.uid() = account_id);


-- ---------------------------------------------------------------------------
-- STEP 4 -- BILLING EVENTS
--
-- The provider event ledger, and the reason a redelivered webhook is harmless.
--
-- Every provider redelivers. A web billing webhook retries until it gets a
-- 2xx; an Apple server notification arrives again because the first response
-- was slow; a Google RTDN comes back because a Pub/Sub ack was lost. Applying
-- one event twice is how a single payment becomes two months of access.
--
-- The unique index below is the whole mechanism: a handler CLAIMS an event by
-- inserting it, and the database decides who won, because the database is the
-- only participant that sees both requests.
--
-- DELIBERATELY NOT STORED: the provider's raw payload. It contains customer
-- identifiers, sometimes an email, sometimes a partial instrument, and it is
-- exactly the thing that ends up in a log export. We keep the id, the type and
-- the outcome -- enough to answer "did we see it and what did we do", and
-- nothing that would hurt if this table leaked.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null check (provider in ('web','apple','google')),
  provider_event_id  text not null,
  event_type         text,

  account_id         uuid references auth.users(id) on delete set null,
  subscription_id    uuid references public.subscriptions(id) on delete set null,

  environment        text not null default 'production'
                       check (environment in ('production','sandbox')),

  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  -- a short outcome word: claimed / processed / ignored / failed. Never a
  -- provider payload and never an error containing one.
  result             text
);

-- THE IDEMPOTENCY GUARANTEE.
create unique index if not exists billing_events_provider_identity
  on public.billing_events (provider, provider_event_id);

create index if not exists billing_events_account_idx
  on public.billing_events (account_id, received_at desc);

alter table public.billing_events enable row level security;
-- No policies at all: deny-all to anon and authenticated alike. An athlete has
-- no business reading the provider event stream, not even their own.


-- ---------------------------------------------------------------------------
-- STEP 5 -- KEEP updated_at HONEST
--
-- Cheap, and it removes a whole class of "why does this row say it changed in
-- March" question. Written as one function used by both tables.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists account_commercial_touch on public.account_commercial;
create trigger account_commercial_touch before update on public.account_commercial
  for each row execute function public.touch_updated_at();

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- STEP 6 -- EVERY EXISTING ACCOUNT GETS A COMMERCIAL ROW
--
-- And nothing else. The row records that the trial is UNUSED. No trial is
-- started, no timestamp is written, no entitlement is granted.
--
-- Backfill plus a trigger for accounts created from now on, so the invariant
-- "every athlete has somewhere to record their one trial" holds without the
-- application having to remember.
-- ---------------------------------------------------------------------------
insert into public.account_commercial (account_id)
select u.id from auth.users u
on conflict (account_id) do nothing;

create or replace function public.seed_account_commercial()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- NO TRIAL. NO ENTITLEMENT. Just the row the allowance will one day be
  -- recorded against. Account creation is not a purchase and must never look
  -- like one.
  insert into public.account_commercial (account_id)
  values (new.id)
  on conflict (account_id) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_account_commercial_on_signup on auth.users;
create trigger seed_account_commercial_on_signup
  after insert on auth.users
  for each row execute function public.seed_account_commercial();


-- ---------------------------------------------------------------------------
-- STEP 7 -- THE BETA COHORT
--
-- WHO. Exactly the addresses on public.beta_allowlist with revoked_at is null,
-- matched to an auth.users row. That table is the live, verified record of who
-- the testers are -- it is what the sign-up gate used and what
-- beta_email_approved() still reads -- so it is the cohort, and no wider
-- definition is invented here.
--
-- EXPLICITLY NOT "every account". Since supabase-commercial-activation.sql
-- STEP 2 dropped the sign-up gate, an ordinary address can create an account.
-- Granting Standard to every row in auth.users would hand the product to
-- anybody who ever typed an email into the sign-in box.
--
-- WHAT THEY GET. An admin_beta entitlement grant, indefinite. NOT a fake paid
-- subscription, NOT a fake trial, and NOT a new identity -- the same
-- auth.users.id keeps every plan, session, split and Strava connection they
-- already have.
--
-- THEIR TRIAL IS UNTOUCHED. A tester who later subscribes still gets their
-- fourteen days. Being useful to us is not something we bill for later.
--
-- IDEMPOTENT. The partial unique index in STEP 3 permits one live grant per
-- source per account, so re-running this inserts nothing the second time.
--
-- ROLLBACK. Revoke rather than delete, which keeps the audit trail:
--   update public.entitlement_grants
--      set revoked_at = now(), revoked_by = null
--    where source = 'admin_beta' and revoked_at is null
--      and note = 'beta cohort migration -- commercial core phase 1';
-- ---------------------------------------------------------------------------
insert into public.entitlement_grants (account_id, source, product_code, note)
select u.id, 'admin_beta', 'VALHALLA_STANDARD',
       'beta cohort migration -- commercial core phase 1'
  from auth.users u
  join public.beta_allowlist b
    on b.email = lower(trim(u.email))
 where b.revoked_at is null
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- STEP 8 -- THE FOUNDER
--
-- Owner access must not become dependent on a subscription. The existing
-- architecture already gives it: entitlements.override = 'owner', which
-- _access.js honours ahead of every commercial rule, and which is seeded from
-- _vvv_owner_uid(). That mechanism is left exactly as it is -- this file adds
-- no second notion of "owner" and no owner-specific grant.
--
-- Verify after running, with the uid configured in supabase-entitlement.sql:
--   select override, override_expires_at from public.entitlements
--    where user_id = public._vvv_owner_uid()::uuid;
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- STEP 9 -- VERIFY
--
-- Run these after applying. Expected results are stated so a wrong number is
-- obvious rather than something to interpret.
--
--   -- every account has a commercial row, and NOBODY is on a trial
--   select count(*)                                as accounts,
--          count(*) filter (where trial_consumed_at is not null) as trials_used
--     from public.account_commercial;
--   -- expect: accounts = count(auth.users), trials_used = 0
--
--   -- the beta cohort, and only it
--   select count(*) from public.entitlement_grants
--    where source = 'admin_beta' and revoked_at is null;
--   -- expect: the number of live beta_allowlist addresses that have signed in
--
--   -- no fake commerce was created
--   select count(*) from public.subscriptions;
--   -- expect: 0
--
--   select count(*) from public.billing_events;
--   -- expect: 0
--
--   -- an athlete cannot write any of it (run as an authenticated user, not
--   -- as service_role): every one of these must be refused by RLS
--   -- insert into public.entitlement_grants (account_id, source) values (auth.uid(), 'admin_comp');
--   -- update public.account_commercial set trial_consumed_at = null;
--   -- insert into public.subscriptions (account_id, provider, provider_subscription_id, condition)
--   --   values (auth.uid(), 'web', 'x', 'active');
-- ---------------------------------------------------------------------------
