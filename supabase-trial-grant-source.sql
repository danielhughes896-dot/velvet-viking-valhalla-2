-- ===========================================================================
-- PHASE 1 EXTENSION -- THE CARD-FREE TRIAL
--
-- WHY THIS EXISTS. The commissioned model grants access from two things:
-- subscriptions, which require a real provider_subscription_id, and
-- entitlement_grants, whose source could only be admin_beta or admin_comp.
-- A card-free trial is neither: it has no provider behind it, and it is not an
-- administrative favour. It had no representation at all, and the honest
-- options were to fabricate a provider subscription -- which would put a lie in
-- the table reserved for real commercial relationships -- or to widen the grant
-- vocabulary by one. This does the latter.
--
-- RESPONSIBILITIES STAY SEPARATE, and this is the point of the design:
--
--   account_commercial.trial_consumed_at
--       "has this account EVER consumed its Standard trial?"  -- permanent
--   entitlement_grants where source = 'trial'
--       "does this account have trial access RIGHT NOW?"      -- expiring
--   subscriptions
--       real provider-backed relationships only               -- untouched
--
-- Those answer different questions and must not be merged. The first is why a
-- trial cannot be farmed; the second is why it ends.
--
-- Safe to re-run. Grants nothing to anybody on its own.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 -- WIDEN THE GRANT VOCABULARY BY EXACTLY ONE
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.entitlement_grants'::regclass
                and conname  = 'entitlement_grants_source_check') then
    alter table public.entitlement_grants drop constraint entitlement_grants_source_check;
  end if;
end $$;

alter table public.entitlement_grants
  add constraint entitlement_grants_source_check
  check (source in ('admin_beta', 'admin_comp', 'trial'));


-- ---------------------------------------------------------------------------
-- STEP 2 -- STARTING A TRIAL IS ONE OPERATION, NOT TWO
--
-- Consuming the allowance and granting the access must succeed together. Done
-- as two round trips from the application, a failure between them leaves the
-- worst possible state: the athlete's one trial spent and no access to show for
-- it, unrecoverable without an operator. A plpgsql function is one implicit
-- transaction, so either both rows land or neither does.
--
-- THE ONE-TIME GUARANTEE IS THE WHERE CLAUSE, not a prior read. Two concurrent
-- callers both pass a `select trial_consumed_at is null` check; only one can
-- win `update ... where trial_consumed_at is null`, because the row is locked
-- for the duration. The loser sees zero updated rows and raises, which rolls
-- back its own grant insert.
--
-- WHAT THE CALLER MAY DECIDE: the account (already verified by the server) and
-- the duration in days (read from _products.js, the one place the offering is
-- defined). WHAT IT MAY NOT: the source, the product, the expiry instant, or
-- anything about another account. Duration is bounded here as well as there --
-- a compromised caller must not be able to ask for a ten-year trial.
-- ---------------------------------------------------------------------------
create or replace function public.start_standard_trial(
  p_account_id uuid,
  p_trial_days integer
)
returns table (
  started        boolean,
  reason         text,
  trial_ends_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now      timestamptz := now();
  v_expires  timestamptz;
  v_updated  integer;
begin
  if p_account_id is null then
    return query select false, 'no_account'::text, null::timestamptz; return;
  end if;

  -- Bounded independently of the caller. 1..60 is wide enough for any offer
  -- the business might run and narrow enough that a mistake is not a giveaway.
  if p_trial_days is null or p_trial_days < 1 or p_trial_days > 60 then
    return query select false, 'bad_trial_days'::text, null::timestamptz; return;
  end if;

  -- The account must exist commercially. Phase 1's signup trigger creates this
  -- row; its absence means something is wrong upstream, and inventing one here
  -- would paper over it.
  if not exists (select 1 from public.account_commercial where account_id = p_account_id) then
    return query select false, 'no_commercial_account'::text, null::timestamptz; return;
  end if;

  -- An account we have deliberately barred from trials is barred here too.
  if exists (select 1 from public.account_commercial
              where account_id = p_account_id and trial_blocked_at is not null) then
    return query select false, 'trial_blocked'::text, null::timestamptz; return;
  end if;

  v_expires := v_now + make_interval(days => p_trial_days);

  -- THE RACE IS DECIDED HERE. Conditional, row-locking, and the only place the
  -- allowance is spent.
  update public.account_commercial
     set trial_consumed_at       = v_now,
         trial_consumed_provider = 'web',
         updated_at              = v_now
   where account_id = p_account_id
     and trial_consumed_at is null;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return query select false, 'already_used'::text, null::timestamptz; return;
  end if;

  -- Same transaction. If this fails, the consumption above is rolled back with
  -- it and the athlete still has their trial.
  insert into public.entitlement_grants (account_id, source, product_code, expires_at, note)
  values (p_account_id, 'trial', 'VALHALLA_STANDARD', v_expires,
          'card-free standard trial, started by the athlete');

  return query select true, 'started'::text, v_expires;
end;
$$;

-- SERVER ONLY. The athlete's browser never calls this: the application
-- authenticates the bearer token, resolves the account itself, and calls with
-- the service key. A function that authenticated clients could execute would be
-- a function whose p_account_id argument is worth attacking.
revoke all on function public.start_standard_trial(uuid, integer) from public, anon, authenticated;
grant execute on function public.start_standard_trial(uuid, integer) to postgres, service_role;


-- ---------------------------------------------------------------------------
-- STEP 3 -- VERIFY. Read-only.
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_constraint
    where conrelid = 'public.entitlement_grants'::regclass
      and conname  = 'entitlement_grants_source_check'
      and pg_get_constraintdef(oid) like '%trial%')                     as trial_source_permitted,
  (select count(*) from public.entitlement_grants
    where source = 'admin_beta' and revoked_at is null)                 as live_admin_beta_grants,
  (select count(*) from public.entitlement_grants where source = 'trial') as trial_grants,
  (select count(*) from public.account_commercial
    where trial_consumed_at is not null)                                as trials_consumed,
  (select count(*) from public.subscriptions)                           as subscriptions,
  (select count(*) from public.billing_events)                          as billing_events,
  has_function_privilege('authenticated', 'public.start_standard_trial(uuid, integer)', 'EXECUTE')
                                                                        as trial_fn_client_callable;
