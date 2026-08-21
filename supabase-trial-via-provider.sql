-- ===========================================================================
-- THE TRIAL BECOMES A REAL SUBSCRIPTION
--
-- WHAT CHANGED, AND WHY THIS IS A SUBTRACTION. The trial was card-free, so it
-- had no provider behind it and needed a representation of its own: a third
-- entitlement_grants source with its own activation RPC. HQ has since decided
-- the trial takes a payment method upfront and converts automatically to the
-- interval the athlete chose.
--
-- That makes it a real Stripe subscription with trial_period_days = 14, and the
-- canonical model already handles those completely:
--
--   subscriptionAccess() grants on condition='trialing' until trial_end;
--   cancelling during a trial keeps condition='trialing', so access continues
--   to trial_end and simply does not renew;
--   the reason reported is 'trial', because that is what the athlete is in.
--
-- So nothing is added. The standalone trial architecture is removed, and the
-- trial rides the path that already existed for provider subscriptions.
--
-- WHAT SURVIVES. account_commercial.trial_consumed_at remains the lifetime
-- one-trial rule. It moves from an RPC to the webhook: it is stamped when a
-- provider tells us a trialing subscription EXISTS, never when somebody merely
-- opens Checkout. Abandoning Checkout must not spend an athlete's trial.
--
-- Safe to re-run. Refuses rather than destroy.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 -- REFUSE IF ANYONE IS LIVING ON A CARD-FREE TRIAL
--
-- Narrowing the source vocabulary while a live trial grant exists would revoke
-- somebody's access. There are only beta accounts today and public commerce is
-- closed, so this should find nothing -- but "should" is not a migration
-- strategy.
-- ---------------------------------------------------------------------------
do $$
declare n integer;
begin
  select count(*) into n
    from public.entitlement_grants
   where source = 'trial' and revoked_at is null
     and (expires_at is null or expires_at > now());
  if n > 0 then
    raise exception using
      errcode = 'raise_exception',
      message = 'ABORTED: ' || n || ' athlete(s) hold a live card-free trial grant',
      hint    = 'Let them lapse, or migrate them to a provider subscription, before '
                'narrowing the vocabulary. Nothing has been changed.';
  end if;
  raise notice 'No live card-free trial grants. Safe to retire.';
end $$;


-- ---------------------------------------------------------------------------
-- STEP 2 -- REMOVE THE STANDALONE TRIAL
--
-- The RPC first: a function nothing calls is still a function somebody can
-- call. Expired trial grants are left in place as history -- they granted real
-- access once and deleting them would rewrite the record -- but the vocabulary
-- narrows so no new one can be written.
-- ---------------------------------------------------------------------------
drop function if exists public.start_standard_trial(uuid, integer);

do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.entitlement_grants'::regclass
                and conname  = 'entitlement_grants_source_check') then
    alter table public.entitlement_grants drop constraint entitlement_grants_source_check;
  end if;
end $$;

-- NOT VALID: historical trial grants stay readable, and nothing new may use it.
alter table public.entitlement_grants
  add constraint entitlement_grants_source_check
  check (source in ('admin_beta', 'admin_comp')) not valid;


-- ---------------------------------------------------------------------------
-- STEP 3 -- FOUNDING PRICE LOCK
--
-- WHAT PROBLEM THIS SOLVES. A founding athlete keeps the price they joined on
-- for as long as the relationship stays continuously active. Reading that off
-- today's catalogue is wrong the first time prices change: the catalogue says
-- what we sell NOW, and this says what THIS athlete agreed to.
--
-- WHY IT LIVES ON subscriptions. It is a fact about one commercial
-- relationship, it begins and ends with that relationship, and a separate table
-- would need the same ownership, the same cascade and the same lifetime
-- restated. A new subscription is a new agreement and gets its own row -- which
-- is exactly the behaviour wanted when somebody cancels and returns later.
--
-- WE DO NOT BILL FROM THESE COLUMNS. Stripe bills from its own Price object.
-- These record what was agreed so support can answer "what am I paying and
-- why", and so a catalogue change cannot silently rewrite history.
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists agreed_price_minor  integer,
  add column if not exists agreed_currency     text,
  add column if not exists price_locked_at     timestamptz,
  add column if not exists catalogue_version   text;

comment on column public.subscriptions.agreed_price_minor is
  'Minor units agreed at the start of THIS relationship. Recorded, never billed '
  'from -- the provider bills from its own price object. Exists so a catalogue '
  'change cannot rewrite what an athlete was told.';
comment on column public.subscriptions.catalogue_version is
  'Which published catalogue this relationship was sold from, so a founding '
  'cohort can be identified without inferring it from a date.';

create index if not exists subscriptions_catalogue_idx
  on public.subscriptions (catalogue_version)
  where catalogue_version is not null;


-- ---------------------------------------------------------------------------
-- STEP 4 -- PAUSE
--
-- Monthly subscribers may pause up to 3 months, once per rolling year. The
-- provider stops collecting; access is governed by the same period boundary as
-- always, so no new entitlement state is invented.
--
-- The rolling-year rule needs to survive a pause ending, so the START is
-- recorded permanently rather than cleared on resume: "when did you last
-- pause" cannot be answered by a column that resume wipes.
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists paused_at            timestamptz,
  add column if not exists pause_resumes_at     timestamptz,
  add column if not exists last_pause_started_at timestamptz;

comment on column public.subscriptions.last_pause_started_at is
  'Kept after a pause ends. Clearing it on resume would make the '
  'once-per-rolling-year rule unenforceable.';


-- ---------------------------------------------------------------------------
-- STEP 5 -- VERIFY. Read-only.
-- ---------------------------------------------------------------------------
select
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname='public' and p.proname='start_standard_trial')    as trial_rpc_gone,
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid='public.entitlement_grants'::regclass
      and conname='entitlement_grants_source_check')                             as grant_sources,
  (select count(*) from public.entitlement_grants
    where source='trial' and revoked_at is null
      and (expires_at is null or expires_at > now()))                            as live_trial_grants_expect_0,
  (select count(*) from public.entitlement_grants
    where source='admin_beta' and revoked_at is null)                            as admin_beta_grants,
  (select count(*) from public.account_commercial where trial_consumed_at is not null) as trials_consumed,
  (select count(*) from public.subscriptions)                                    as subscriptions;
