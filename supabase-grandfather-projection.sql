-- ===========================================================================
-- FIX: MAKE THE GRANDFATHERED COHORT'S ACCESS REACH THE GATE
--
-- WHAT WENT WRONG, AND IT IS WORTH STATING PLAINLY.
--
-- supabase-commercial-cutover.sql wrote every grandfathered athlete an
-- admin_comp grant and verified that the grants existed. They do. What it did
-- not verify is the only thing that decides whether anybody gets in.
--
-- entitlement_grants is the SOURCE OF TRUTH. public.entitlements is a
-- PROJECTION of it, and api/app.js -> resolveAccess() reads the projection and
-- nothing else. The projection is written by exactly one function,
-- Store.syncEntitlementRow(), called from exactly one place: _billing-apply.js,
-- which runs on a Stripe webhook.
--
-- A grandfathered athlete has no Stripe activity. No webhook will ever fire for
-- them. Their projection would therefore never be written, and the gate would
-- go on reading either no row at all or a stale row that says override 'beta'
-- -- which is refused, correctly, because beta was retired.
--
-- NET EFFECT WITHOUT THIS FILE: all four grandfathered athletes are denied the
-- product the moment VVV_COMMERCIAL_REQUIRED is armed, despite holding a valid
-- complimentary grant and despite the cutover reporting success.
--
-- WHAT THIS WRITES is exactly what projectToEntitlementRow() in
-- api/_entitlement.js produces for an athlete whose only active source is an
-- open-ended admin_comp grant. Verified against that function rather than
-- invented here:
--
--   state         'expired'   a grant is not a commercial state and must not
--                             masquerade as one
--   tier          'standard'
--   access_until  null        the commercial window only; a grant's own expiry
--                             lives in override_expires_at
--   override      'promo'     the value _access.js honours (ACCESS_OVERRIDES)
--   override_expires_at  null open-ended, matching the grant
--
-- override_note is left alone where one exists: it is an operator's sentence
-- about a human being and no automated write should overwrite one.
--
-- SAFE TO RE-RUN. Idempotent by construction, and it touches only accounts that
-- hold a grandfathered grant.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- STEP 0 -- REFUSE TO RUN IF THE CUTOVER HAS NOT HAPPENED
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.entitlement_grants
                  where source='admin_comp' and note like 'grandfathered-beta:%') then
    raise exception 'refusing to project: no grandfathered grants exist, run the cutover first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 1 -- PROJECT THE COHORT ONTO THE ROW THE GATE ACTUALLY READS
--
-- Only accounts with a LIVE grandfathered grant, and never the owner: owner
-- access is a separate permanent thing and overwriting that row with 'promo'
-- would demote the operator into a complimentary athlete.
-- ---------------------------------------------------------------------------
insert into public.entitlements
  (user_id, state, tier, access_until, cancel_at_period_end,
   override, override_expires_at, updated_at)
select g.account_id, 'expired', 'standard', null, false,
       'promo', null, now()
  from (select distinct account_id from public.entitlement_grants
         where source = 'admin_comp'
           and revoked_at is null
           and note like 'grandfathered-beta:%') g
 where not exists (select 1 from public.entitlements e
                    where e.user_id = g.account_id and e.override = 'owner')
on conflict (user_id) do update
   set override            = 'promo',
       override_expires_at = null,
       tier                = 'standard',
       updated_at          = now()
 where public.entitlements.override is distinct from 'owner';

-- ---------------------------------------------------------------------------
-- STEP 2 -- PROVE THE GATE WOULD NOW ADMIT THEM
--
-- This is the check the cutover should have made: not "does a grant exist" but
-- "would resolveAccess() let them in". The condition below is that function's
-- override branch, restated in SQL -- an override present, in ACCESS_OVERRIDES,
-- and not expired.
-- ---------------------------------------------------------------------------
do $$
declare n_cohort int; n_admitted int; n_owner int;
begin
  select count(distinct account_id) into n_cohort
    from public.entitlement_grants
   where source='admin_comp' and revoked_at is null and note like 'grandfathered-beta:%';

  select count(*) into n_admitted
    from public.entitlements e
   where e.user_id in (select distinct account_id from public.entitlement_grants
                        where source='admin_comp' and revoked_at is null
                          and note like 'grandfathered-beta:%')
     and e.override in ('owner','promo')
     and (e.override_expires_at is null or e.override_expires_at > now());

  if n_admitted <> n_cohort then
    raise exception 'projection incomplete: % of % grandfathered athletes would be admitted',
      n_admitted, n_cohort;
  end if;

  -- The owner is untouched and still owner.
  select count(*) into n_owner from public.entitlements where override='owner';
  if n_owner < 1 then
    raise exception 'the owner override was overwritten';
  end if;

  -- No stale beta override survives anywhere.
  if exists (select 1 from public.entitlements where override='beta') then
    raise exception 'a stale beta override is still on an entitlements row';
  end if;

  raise notice 'projection complete: % grandfathered athletes admitted, owner intact', n_cohort;
end $$;

commit;
