-- Velvet Viking -- purchases ledger and billing event log.
--
-- WHY THIS IS SEPARATE FROM entitlements. That table answers one question --
-- may this athlete use Valhalla -- with one row per athlete, which is the right
-- shape for the question and the wrong shape for evidence. It cannot express
-- "bought on the web in March, lapsed, bought again through Apple in June", and
-- it cannot say why access changed at 04:12 on a Tuesday.
--
-- PROVIDER-NEUTRAL FROM THE FIRST LINE. `provider` admits stripe, apple and
-- google today. Apple's originalTransactionId and Play's purchase token lineage
-- both land in provider_sub_id; no column here is Stripe-shaped, so adding a
-- store later is an adapter, not a migration.
--
-- SAFE TO APPLY BEFORE COMMERCE IS LIVE. Creating these tables grants nothing
-- and changes no access decision. resolveAccess() does not read them.

-- ---------------------------------------------------------------------------
-- purchases: one row per provider subscription
-- ---------------------------------------------------------------------------
create table if not exists public.purchases (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,
  provider              text        not null check (provider in ('stripe','apple','google')),
  provider_sub_id       text        not null,
  provider_customer_id  text,
  billing_period        text        check (billing_period in ('monthly','yearly')),
  tier                  text        not null default 'standard',
  -- The provider's own status string, mirrored verbatim and never interpreted
  -- here. Interpretation belongs to the adapter; storing it raw is what makes
  -- a disputed entitlement reconstructable months later.
  status                text,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean     not null default false,
  trial_end             timestamptz,
  linked_at             timestamptz not null default now(),
  unlinked_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- THE CONSTRAINT THAT MATTERS MOST. One provider subscription belongs to
-- exactly one Valhalla account, forever. This is what stops a store receipt
-- being replayed against a second account -- the commonest real abuse and the
-- commonest honest accident -- and it works identically for all three
-- providers.
create unique index if not exists purchases_provider_sub_uniq
  on public.purchases (provider, provider_sub_id);

create index if not exists purchases_user_idx on public.purchases (user_id);
create index if not exists purchases_period_end_idx on public.purchases (current_period_end);

alter table public.purchases enable row level security;
-- An athlete may read their own purchase history and nothing else. Writes are
-- service-role only: a purchase record is evidence about money, and evidence a
-- subject can edit is not evidence.
drop policy if exists "read own purchases" on public.purchases;
create policy "read own purchases" on public.purchases
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- billing_events: what the provider told us, and what we did about it
-- ---------------------------------------------------------------------------
create table if not exists public.billing_events (
  id                      uuid primary key default gen_random_uuid(),
  provider                text        not null check (provider in ('stripe','apple','google')),
  -- The provider's own event id. The UNIQUE index below is the whole
  -- idempotency mechanism: a duplicate delivery loses the insert race rather
  -- than being caught by a read-then-write, which two concurrent deliveries
  -- would both pass.
  provider_event_id       text        not null,
  event_type              text,
  user_id                 uuid        references auth.users(id) on delete set null,
  provider_sub_id         text,
  provider_customer_id    text,
  occurred_at             timestamptz,
  received_at             timestamptz not null default now(),
  applied                 boolean     not null default false,
  resulting_state         text,
  resulting_access_until  timestamptz,
  note                    text
);

create unique index if not exists billing_events_provider_event_uniq
  on public.billing_events (provider, provider_event_id);
create index if not exists billing_events_user_idx on public.billing_events (user_id);
create index if not exists billing_events_received_idx on public.billing_events (received_at);

alter table public.billing_events enable row level security;
-- No athlete-facing policy at all. This is an operational audit log; it is read
-- with the service key by us and by nobody else. Absence of a policy under RLS
-- means no row is selectable by anon or authenticated, which is the intent
-- stated positively rather than by omission.

-- ---------------------------------------------------------------------------
-- No card data is stored anywhere in this file, and no column exists that could
-- hold any: every provider reference above is an opaque id that is useless
-- outside its own API.
-- ---------------------------------------------------------------------------
