'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// VALHALLA COMMERCIAL CORE -- Phase 1.
//
// The three concepts this suite exists to keep apart:
//
//   ACCOUNT       an athlete. Immutable uuid. Survives an email change.
//   SUBSCRIPTION  a purchase, mirrored from whichever provider owns it.
//   ENTITLEMENT   whether access is granted right now. Derived, never stored
//                 as an authority.
//
// Most of what follows is boundary work, because every expensive mistake in
// subscription billing is a boundary: the minute a trial ends, the hour a
// provider's grace lapses, the second request that arrives while the first is
// still deciding. Those cases cannot be produced on demand from a live
// provider, which is exactly why the decisions are pure functions of
// (facts, now) and why this file can drive them.

const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'api', '_products.js'));
const E = require(path.join(ROOT, 'api', '_entitlement.js'));
const C = require(path.join(ROOT, 'api', '_commercial-store.js'));
const { createFakeSupabase } = require('./fakeSupabase.js');

/* Every SQL guard below scans EXECUTABLE statements, never comments. This
   file's own explanations legitimately contain the words a leak would --
   "never store a PAN", "the service_role key" -- and a guard that cannot tell
   a rule from a violation is a guard that has to be weakened later, which is
   how the rule ends up unenforced. */
function sqlCode(){
  return fs.readFileSync(path.join(ROOT, 'supabase-commercial-core.sql'), 'utf8')
    .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
}

const T0 = new Date('2026-06-01T12:00:00Z');
const at = h => new Date(T0.getTime() + h * 3600 * 1000);
const ACC = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function sub(over){
  return Object.assign({
    id: 'sub-1', account_id: ACC, provider: 'web',
    provider_subscription_id: 'p_1', product_code: P.STANDARD,
    offer_code: 'STANDARD_MONTHLY', billing_period: 'monthly',
    condition: 'active', auto_renew: true, cancel_at_period_end: false,
    trial_start: null, trial_end: null,
    current_period_start: at(-24 * 30), current_period_end: at(24 * 30),
    grace_period_end: null, environment: 'production'
  }, over || {});
}
function grant(over){
  return Object.assign({
    id: 'g-1', account_id: ACC, source: 'admin_beta',
    product_code: P.STANDARD, expires_at: null, revoked_at: null
  }, over || {});
}
const account = over => Object.assign({ account_id: ACC, trial_consumed_at: null }, over || {});
const resolve = (subs, grants, acct, now) => E.resolveStandardEntitlement({
  account: acct === undefined ? account() : acct,
  subscriptions: subs || [], grants: grants || [], now: now || T0
});

// ===========================================================================
// PRODUCT CATALOGUE
// ===========================================================================
test('there is one product, and entitlement is keyed on it rather than on a price', () => {
  assert.equal(Object.keys(P.PRODUCTS).length, 1);
  assert.equal(P.STANDARD, 'VALHALLA_STANDARD');
  const offers = P.offersFor(P.STANDARD);
  assert.equal(offers.length, 2);
  // Both offers grant the SAME product. That is the whole distinction.
  assert.ok(offers.every(o => o.product === P.STANDARD));
  assert.deepEqual(offers.map(o => o.billingPeriod).sort(), ['monthly', 'yearly']);
});

test('the approved UK commercial intent is recorded exactly once, in minor units', () => {
  assert.equal(P.offer('STANDARD_MONTHLY').priceMinor, 1199);
  assert.equal(P.offer('STANDARD_YEARLY').priceMinor, 8999);
  assert.equal(P.offer('STANDARD_MONTHLY').currency, 'GBP');
  assert.equal(P.TRIAL_DAYS, 14);
  // Integers, or money eventually goes through a float and is wrong on some
  // fraction of rows.
  P.offersFor(P.STANDARD).forEach(o => assert.equal(o.priceMinor, Math.trunc(o.priceMinor)));
});

test('no fake provider identifier is shipped, and an unconfigured offer is unpurchasable', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_products.js'), 'utf8');
  // The shapes a real one would have. None may appear.
  assert.doesNotMatch(src, /price_[A-Za-z0-9]{10,}/, 'a Stripe-shaped price id is hardcoded');
  assert.doesNotMatch(src, /co\.velvetviking\.[a-z.]+/, 'an Apple-shaped product id is hardcoded');
  const empty = {};
  assert.equal(P.providerRef('apple', 'STANDARD_MONTHLY', empty), null);
  assert.equal(P.purchasable('apple', 'STANDARD_MONTHLY', empty), false);
  assert.equal(P.purchasable('web', 'STANDARD_YEARLY', { VVV_PRICE_WEB_STANDARD_YEARLY: 'x' }), true);
});

test('the catalogue lists an unavailable offer rather than hiding it', () => {
  const c = P.catalogue('web', {});
  assert.equal(c.offers.length, 2);
  assert.ok(c.offers.every(o => o.available === false));
  assert.ok(c.offers.every(o => o.priceMinor > 0), 'price is still shown, so a screen can be honest');
});

// ===========================================================================
// ACCOUNT
// ===========================================================================
test('account creation alone grants nothing', () => {
  const r = resolve([], [], account());
  assert.equal(r.active, false);
  assert.equal(r.reason, 'none');
  assert.equal(r.commercialState, 'none');
  assert.equal(r.product, null);
});

test('account creation alone does not consume the trial', () => {
  const el = E.trialEligibility(account(), T0);
  assert.equal(el.eligible, true);
  assert.equal(el.consumedAt, null);
});

test('the signup trigger creates a commercial row and starts no trial', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-commercial-core.sql'), 'utf8');
  const fn = /create or replace function public\.seed_account_commercial\(\)[^]*?\$\$;/.exec(sql);
  assert.ok(fn, 'the signup seed function is missing');
  assert.doesNotMatch(fn[0], /trial_consumed_at/, 'the signup trigger writes a trial timestamp');
  assert.doesNotMatch(fn[0], /entitlement_grants|subscriptions/, 'the signup trigger grants access');
});

test('identity is the auth uuid, and email appears nowhere in the commercial schema', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-commercial-core.sql'), 'utf8');
  ['account_commercial', 'subscriptions', 'entitlement_grants', 'billing_events'].forEach(t => {
    const m = new RegExp('create table if not exists public\\.' + t + ' \\(([^;]*?)\\n\\);').exec(sql);
    assert.ok(m, t + ': table not found');
    assert.doesNotMatch(m[1], /\bemail\b/,
      t + ' has an email column — email is mutable and must never key a purchase');
    assert.match(m[1], /references auth\.users\(id\)/, t + ' is not anchored to the auth uuid');
  });
});

test('changing email changes no commercial fact, because no fact holds an email', async () => {
  const f = createFakeSupabase({
    account_commercial: [{ account_id: ACC }],
    subscriptions: [sub()],
    entitlement_grants: [grant()]
  });
  const before = await C.resolveStandardEntitlement(f.S, f.cfg, ACC, T0);
  // An email change is an auth.users UPDATE; it touches none of these tables.
  const after = await C.resolveStandardEntitlement(f.S, f.cfg, ACC, T0);
  assert.equal(before.active, true);
  assert.equal(JSON.stringify(E.publicEntitlement(before)),
               JSON.stringify(E.publicEntitlement(after)));
  // and the linkage is by uuid on every row
  assert.ok(f.rows('subscriptions').every(r => r.account_id === ACC));
});

// ===========================================================================
// ENTITLEMENT -- THE RESOLVER
// ===========================================================================
test('no source means inactive', () => {
  assert.equal(resolve([], []).active, false);
});

test('a running trial is active, and says so', () => {
  const r = resolve([sub({ condition: 'trialing', trial_end: at(48) })]);
  assert.equal(r.active, true);
  assert.equal(r.reason, 'trial');
  assert.equal(r.commercialState, 'trial');
  assert.equal(r.validUntil, at(48).toISOString());
});

test('a paid current period is active', () => {
  const r = resolve([sub()]);
  assert.equal(r.active, true);
  assert.equal(r.reason, 'paid');
  assert.equal(r.commercialState, 'paid');
});

test('CANCELLED BUT PAID THROUGH A FUTURE DATE IS ACTIVE', () => {
  /* The expensive one. Taking the product away when somebody clicks cancel is
     both wrong and the fastest route to a chargeback. */
  const r = resolve([sub({ condition: 'cancelled', auto_renew: false,
                           cancel_at_period_end: true, current_period_end: at(240) })]);
  assert.equal(r.active, true);
  assert.equal(r.reason, 'paid');
  assert.equal(r.commercialState, 'cancelled_active');
  assert.equal(r.validUntil, at(240).toISOString());
});

test('a trial cancelled before it ends stays active until the trial ends, then stops', () => {
  const s = sub({ condition: 'trialing', auto_renew: false, cancel_at_period_end: true,
                  trial_end: at(24) });
  assert.equal(resolve([s], [], undefined, at(23)).active, true);
  assert.equal(resolve([s], [], undefined, at(23)).reason, 'trial');
  const after = resolve([s], [], undefined, at(25));
  assert.equal(after.active, false);
  assert.equal(after.reason, 'expired');
});

test('access ends exactly at the boundary, not a moment after', () => {
  const s = sub({ current_period_end: at(10) });
  assert.equal(resolve([s], [], undefined, new Date(at(10).getTime() - 1)).active, true);
  assert.equal(resolve([s], [], undefined, at(10)).active, false,
    'the instant of expiry must not still grant access');
});

test('an expired period is inactive but the account and its history remain', () => {
  const r = resolve([sub({ condition: 'expired', current_period_end: at(-1) })]);
  assert.equal(r.active, false);
  assert.equal(r.commercialState, 'expired', 'the athlete is a lapsed customer, not a stranger');
});

test('a PROVIDER grace period keeps access, and ending it ends access', () => {
  const s = sub({ condition: 'past_due', current_period_end: at(-1), grace_period_end: at(72) });
  const during = resolve([s], [], undefined, at(24));
  assert.equal(during.active, true);
  assert.equal(during.reason, 'grace_period');
  assert.equal(during.validUntil, at(72).toISOString());

  const after = resolve([s], [], undefined, at(73));
  assert.equal(after.active, false);
  assert.equal(after.reason, 'payment_hold');
});

test('Valhalla invents no grace of its own: past_due with no provider window is inactive', () => {
  /* The rule is "honour the provider's grace, add none". A past_due row with
     no grace_period_end is missing information, and missing information must
     not hand out a product. */
  const r = resolve([sub({ condition: 'past_due', current_period_end: at(-1),
                           grace_period_end: null })]);
  assert.equal(r.active, false);
  assert.equal(r.reason, 'payment_hold');
  const src = fs.readFileSync(path.join(ROOT, 'api', '_entitlement.js'), 'utf8');
  assert.doesNotMatch(src, /GRACE_DAYS|graceDays\s*=/,
    'a Valhalla-invented grace length has appeared in the resolver');
});

test('a failed payment inside an already-paid period does not end the period', () => {
  const r = resolve([sub({ condition: 'past_due', current_period_end: at(240),
                           grace_period_end: null })]);
  assert.equal(r.active, true);
  assert.equal(r.reason, 'paid');
});

test('REVOKED beats every date on the row', () => {
  const r = resolve([sub({ condition: 'revoked', current_period_end: at(24 * 365) })]);
  assert.equal(r.active, false);
  assert.equal(r.reason, 'revoked');
});

test('an admin beta grant is active, and is not a subscription', () => {
  const r = resolve([], [grant({ source: 'admin_beta' })]);
  assert.equal(r.active, true);
  assert.equal(r.reason, 'admin_beta');
  assert.equal(r.validUntil, null, 'an indefinite grant has no end');
  assert.equal(r.commercialState, 'none', 'a tester has bought nothing');
  assert.equal(r.managementProvider, null, 'there is no provider portal to send them to');
});

test('an admin comp grant is active, and an expired one is not', () => {
  assert.equal(resolve([], [grant({ source: 'admin_comp', expires_at: at(24) })]).active, true);
  assert.equal(resolve([], [grant({ source: 'admin_comp', expires_at: at(-1) })]).active, false);
});

test('a revoked grant grants nothing', () => {
  assert.equal(resolve([], [grant({ revoked_at: at(-1) })]).active, false);
});

// ===========================================================================
// MULTIPLE SOURCES
// ===========================================================================
test('removing one valid source does not revoke access while another remains', () => {
  const both = resolve([sub()], [grant()]);
  assert.equal(both.active, true);
  // the beta grant goes
  const subOnly = resolve([sub()], []);
  assert.equal(subOnly.active, true, 'losing the grant took the subscription away too');
  // the subscription goes instead
  const grantOnly = resolve([], [grant()]);
  assert.equal(grantOnly.active, true, 'losing the subscription took the grant away too');
});

test('an expired subscription alongside a live grant still leaves access intact', () => {
  const r = resolve([sub({ condition: 'expired', current_period_end: at(-100) })], [grant()]);
  assert.equal(r.active, true);
  assert.equal(r.reason, 'admin_beta');
  assert.equal(r.commercialState, 'expired', 'the commercial story and the access story differ');
});

test('a revoked subscription does not poison a valid grant', () => {
  const r = resolve([sub({ condition: 'revoked' })], [grant()]);
  assert.equal(r.active, true, 'a refund on a purchase removed a beta tester’s access');
});

test('validUntil is the furthest-reaching source, and open-ended wins', () => {
  const dated = resolve([sub({ current_period_end: at(100) })], []);
  assert.equal(dated.validUntil, at(100).toISOString());
  const openEnded = resolve([sub({ current_period_end: at(100) })], [grant()]);
  assert.equal(openEnded.validUntil, null, 'an indefinite grant was expired by a dated subscription');
});

test('the reported reason belongs to the source that reaches furthest', () => {
  const r = resolve([sub({ current_period_end: at(10) })],
                    [grant({ source: 'admin_comp', expires_at: at(1000) })]);
  assert.equal(r.reason, 'admin_comp');
  assert.equal(r.validUntil, at(1000).toISOString());
});

// ===========================================================================
// FAIL CLOSED
// ===========================================================================
test('an unknown provider fails closed', () => {
  assert.equal(resolve([sub({ provider: 'paypal' })]).active, false);
  assert.equal(resolve([sub({ provider: null })]).active, false);
});

test('an unknown lifecycle condition fails closed', () => {
  assert.equal(resolve([sub({ condition: 'incomplete_expired' })]).active, false);
  assert.equal(resolve([sub({ condition: undefined })]).active, false);
});

test('an unknown product fails closed', () => {
  assert.equal(resolve([sub({ product_code: 'VALHALLA_PRO' })]).active, false);
});

test('malformed dates fail safely rather than granting access', () => {
  ['not-a-date', '', 'NaN', '2026-13-45T99:99:99Z', {}].forEach(bad => {
    assert.equal(resolve([sub({ current_period_end: bad })]).active, false,
      JSON.stringify(bad) + ' as a period end granted access');
    assert.equal(resolve([sub({ condition: 'trialing', trial_end: bad })]).active, false,
      JSON.stringify(bad) + ' as a trial end granted access');
    assert.equal(resolve([], [grant({ expires_at: bad })]).active, false,
      JSON.stringify(bad) + ' as a grant expiry granted access');
  });
});

test('a grant with an unknown source grants nothing', () => {
  assert.equal(resolve([], [grant({ source: 'admin_free_forever' })]).active, false);
});

test('a datastore read failure resolves to no access, never to access-by-default', async () => {
  const broken = { sb: async () => ({ ok: false, status: 500, json: async () => null }) };
  const r = await C.resolveStandardEntitlement(broken, {}, ACC, T0);
  assert.equal(r.active, false);
  assert.equal(r.reason, 'invalid');
  assert.equal(r.ok, false);
});

// ===========================================================================
// DERIVED STATE -- AUTHORITY ORDERING
// ===========================================================================
test('the product-facing state is derived, never stored, so it cannot contradict', () => {
  const src = fs.readFileSync(path.join(ROOT, 'supabase-commercial-core.sql'), 'utf8');
  assert.doesNotMatch(src, /user_status|subscription_status\s+text|commercial_state\s+text/,
    'a stored status column has appeared and can now disagree with the rows');
});

test('authority ordering: a live subscription decides the state', () => {
  const cases = [
    [{ condition: 'trialing', trial_end: at(24) }, 'trial'],
    [{ condition: 'active' }, 'paid'],
    [{ condition: 'cancelled', auto_renew: false, current_period_end: at(24) }, 'cancelled_active'],
    [{ condition: 'past_due', grace_period_end: at(24), current_period_end: at(-1) }, 'paid'],
    [{ condition: 'expired', current_period_end: at(-1) }, 'expired'],
    [{ condition: 'revoked' }, 'expired']
  ];
  cases.forEach(([over, want]) =>
    assert.equal(E.derivedCommercialState([sub(over)], T0), want,
      JSON.stringify(over) + ' -> expected ' + want));
});

test('authority ordering: no subscription rows at all is "none", not "expired"', () => {
  assert.equal(E.derivedCommercialState([], T0), 'none');
  assert.equal(E.derivedCommercialState(null, T0), 'none');
});

test('a beta tester has an active entitlement and no commercial state', () => {
  const r = resolve([], [grant()]);
  assert.equal(r.active, true);
  assert.equal(r.commercialState, 'none');
  /* This pair is exactly what a single user_status column cannot represent
     without lying about one half of it. */
});

test('managementProvider names the provider that actually sold the live subscription', () => {
  assert.equal(resolve([sub({ provider: 'apple' })]).managementProvider, 'apple');
  assert.equal(resolve([sub({ condition: 'expired', current_period_end: at(-1) })]).managementProvider, null);
});

// ===========================================================================
// TRIAL ELIGIBILITY
// ===========================================================================
test('an athlete can be eligible without any trial being started', () => {
  const el = E.trialEligibility(account(), T0);
  assert.equal(el.eligible, true);
  assert.equal(el.trialDays, 14);
  // eligibility is a question, not a grant
  assert.equal(resolve([], []).active, false);
});

test('a missing account row fails closed rather than reading as unused', () => {
  const el = E.trialEligibility(null, T0);
  assert.equal(el.eligible, false);
  assert.equal(el.reason, 'unknown_account');
});

test('ONE TRIAL PER ATHLETE: a web trial blocks an Apple trial and a Google trial', () => {
  const used = account({ trial_consumed_at: T0.toISOString(), trial_consumed_provider: 'web' });
  ['apple', 'google', 'web'].forEach(provider => {
    const d = E.consumeTrial(used, { provider: provider, subscriptionId: 'other', now: at(1) });
    assert.equal(d.consume, false, provider + ' was handed a second introductory trial');
    assert.equal(d.reason, 'already_used');
  });
  assert.equal(E.trialEligibility(used, at(1)).consumedProvider, 'web',
    'which channel consumed it must stay answerable');
});

test('a beta grant does not consume the trial', async () => {
  const f = createFakeSupabase({ account_commercial: [{ account_id: ACC }] });
  const g = await C.grantEntitlement(f.S, f.cfg, { account_id: ACC, source: 'admin_beta' });
  assert.equal(g.ok, true);
  assert.equal(g.granted, true);
  const acct = f.rows('account_commercial')[0];
  assert.equal(acct.trial_consumed_at, null, 'being a tester cost the athlete their free trial');
  assert.equal(E.trialEligibility(acct, T0).eligible, true);
});

test('the beta migration leaves every migrated athlete their trial', () => {
  const backfill = /insert into public\.entitlement_grants[^;]*;/.exec(sqlCode());
  assert.ok(backfill, 'the beta backfill is missing');
  assert.doesNotMatch(backfill[0], /trial/i, 'the beta backfill touches trial state');
  // and no EXECUTABLE statement in the migration consumes one
  assert.doesNotMatch(sqlCode(), /set\s+trial_consumed_at|trial_consumed_at\s*=\s*(now\(\)|')/i,
    'the migration consumes somebody’s trial');
});

test('consuming the trial is idempotent for the same subscription', () => {
  const used = account({ trial_consumed_at: T0.toISOString(), trial_consumed_provider: 'web',
                         trial_consumed_subscription_id: 'sub-A' });
  const again = E.consumeTrial(used, { provider: 'web', subscriptionId: 'sub-A', now: at(1) });
  assert.equal(again.consume, false);
  assert.equal(again.idempotent, true, 'a redelivered activation looked like a clash');
  const different = E.consumeTrial(used, { provider: 'web', subscriptionId: 'sub-B', now: at(1) });
  assert.equal(different.idempotent, false, 'a different purchase must not look idempotent');
});

test('consuming the trial writes the fact and computes the trial end', async () => {
  const f = createFakeSupabase({ account_commercial: [{ account_id: ACC }] });
  const r = await C.consumeTrialForAccount(f.S, f.cfg, ACC,
    { provider: 'apple', subscriptionId: 'sub-A', now: T0 });
  assert.equal(r.consumed, true);
  assert.equal(r.trialEnd, new Date(T0.getTime() + 14 * 86400000).toISOString());
  const row = f.rows('account_commercial')[0];
  assert.equal(row.trial_consumed_provider, 'apple');
  assert.equal(row.trial_consumed_at, T0.toISOString());
});

test('a repeated activation request consumes nothing further', async () => {
  const f = createFakeSupabase({ account_commercial: [{ account_id: ACC }] });
  const first = await C.consumeTrialForAccount(f.S, f.cfg, ACC, { provider: 'web', subscriptionId: 'A', now: T0 });
  const second = await C.consumeTrialForAccount(f.S, f.cfg, ACC, { provider: 'web', subscriptionId: 'A', now: at(1) });
  assert.equal(first.consumed, true);
  assert.equal(second.consumed, false);
  assert.equal(second.idempotent, true);
  assert.equal(f.rows('account_commercial')[0].trial_consumed_at, T0.toISOString(),
    'the second call moved the consumption timestamp');
});

test('TWO SIMULTANEOUS ACTIVATIONS: exactly one consumes the allowance', async () => {
  /* Both read "eligible" before either writes -- the case a read-then-write in
     JavaScript cannot survive and the conditional UPDATE can. The hook holds
     the first writer at the moment of its write while the second runs to
     completion behind it. */
  const f = createFakeSupabase({ account_commercial: [{ account_id: ACC }] });
  let release, held = false;
  const gate = new Promise(r => { release = r; });
  f.onBeforeWrite(async (table) => {
    if (table !== 'account_commercial' || held) return;
    held = true;
    await gate;
  });

  const a = C.consumeTrialForAccount(f.S, f.cfg, ACC, { provider: 'web', subscriptionId: 'A', now: T0 });
  await new Promise(r => setImmediate(r));
  const b = C.consumeTrialForAccount(f.S, f.cfg, ACC, { provider: 'apple', subscriptionId: 'B', now: T0 });
  await new Promise(r => setImmediate(r));
  release();

  const [ra, rb] = await Promise.all([a, b]);
  const winners = [ra, rb].filter(x => x.consumed);
  assert.equal(winners.length, 1, 'the introductory trial was handed out twice');
  const losers = [ra, rb].filter(x => !x.consumed);
  assert.equal(losers[0].reason, 'already_used');
  assert.equal(f.rows('account_commercial').length, 1);
});

test('there is no trial reset anywhere in the application', () => {
  ['_entitlement.js', '_commercial-store.js', '_products.js'].forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, 'api', f), 'utf8');
    assert.doesNotMatch(src, /trial_consumed_at\s*:\s*null/,
      f + ' writes a null trial_consumed_at — that is a trial reset');
  });
});

// ===========================================================================
// DUPLICATE PURCHASE
// ===========================================================================
const mayBuy = (subs, provider, acct) => E.mayStartStandardPurchase({
  account: acct === undefined ? account() : acct,
  subscriptions: subs || [], provider: provider, now: T0
});

test('an active web subscription blocks an Apple purchase', () => {
  const r = mayBuy([sub({ provider: 'web' })], 'apple');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'already_subscribed_elsewhere');
  assert.equal(r.existingProvider, 'web');
});

test('an active Apple subscription blocks a web purchase', () => {
  const r = mayBuy([sub({ provider: 'apple' })], 'web');
  assert.equal(r.allowed, false);
  assert.equal(r.existingProvider, 'apple');
});

test('an active Google subscription blocks a web purchase', () => {
  const r = mayBuy([sub({ provider: 'google' })], 'web');
  assert.equal(r.allowed, false);
  assert.equal(r.existingProvider, 'google');
});

test('subscribing again on the same provider is named differently, so the screen can be right', () => {
  const r = mayBuy([sub({ provider: 'web' })], 'web');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'already_subscribed_here');
});

test('a subscription in provider grace still blocks a second purchase', () => {
  const r = mayBuy([sub({ condition: 'past_due', current_period_end: at(-1),
                          grace_period_end: at(48), provider: 'web' })], 'apple');
  assert.equal(r.allowed, false, 'a customer mid-retry was allowed to buy a second subscription');
});

test('an EXPIRED subscription does not block legitimate reactivation', () => {
  const r = mayBuy([sub({ condition: 'expired', current_period_end: at(-1) })], 'web');
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'ok');
});

test('a revoked subscription does not block reactivation either', () => {
  assert.equal(mayBuy([sub({ condition: 'revoked' })], 'web').allowed, true);
});

test('an admin beta grant alone does not count as an existing commercial subscription', () => {
  const r = E.mayStartStandardPurchase({
    account: account(), subscriptions: [], grants: [grant()], provider: 'web', now: T0
  });
  assert.equal(r.allowed, true, 'a beta tester was blocked from ever becoming a customer');
});

test('the purchase answer carries the trial verdict, so a client cannot offer a second one', () => {
  const fresh = mayBuy([], 'web');
  assert.equal(fresh.trial.eligible, true);
  const used = mayBuy([], 'web', account({ trial_consumed_at: T0.toISOString(),
                                           trial_consumed_provider: 'apple' }));
  assert.equal(used.allowed, true, 'having used a trial is not a reason to refuse a purchase');
  assert.equal(used.trial.eligible, false);
});

test('an unknown provider or offer cannot begin a purchase', () => {
  assert.equal(mayBuy([], 'paypal').allowed, false);
  assert.equal(mayBuy([], null).allowed, false);
  assert.equal(E.mayStartStandardPurchase({ account: account(), subscriptions: [],
    provider: 'web', offerCode: 'STANDARD_LIFETIME', now: T0 }).allowed, false);
});

test('the duplicate check fails closed when the datastore cannot be read', async () => {
  const broken = { sb: async () => ({ ok: false, status: 503, json: async () => null }) };
  const r = await C.mayStartStandardPurchase(broken, {}, ACC, { provider: 'apple' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'unavailable');
});

test('the migration door exists but is closed by default', () => {
  const blocked = mayBuy([sub({ provider: 'web' })], 'apple');
  assert.equal(blocked.allowed, false);
  const exceptional = E.mayStartStandardPurchase({
    account: account(), subscriptions: [sub({ provider: 'web' })],
    provider: 'apple', allowExceptional: true, now: T0
  });
  assert.equal(exceptional.allowed, true);
  assert.equal(exceptional.reason, 'exceptional_override');
});

// ===========================================================================
// PROVIDER EVENT IDEMPOTENCY
// ===========================================================================
test('a duplicate provider event cannot be applied twice', async () => {
  const f = createFakeSupabase({});
  const ev = { provider: 'apple', provider_event_id: 'NOTIF-1', event_type: 'DID_RENEW' };
  const first = await C.claimBillingEvent(f.S, f.cfg, ev);
  const second = await C.claimBillingEvent(f.S, f.cfg, ev);
  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.ok, true, 'a duplicate must be a 200 outcome, or the provider retries forever');
  assert.equal(f.rows('billing_events').length, 1);
});

test('the same event id from two different providers is two events', async () => {
  const f = createFakeSupabase({});
  const a = await C.claimBillingEvent(f.S, f.cfg, { provider: 'apple', provider_event_id: 'E1' });
  const b = await C.claimBillingEvent(f.S, f.cfg, { provider: 'google', provider_event_id: 'E1' });
  assert.equal(a.claimed, true);
  assert.equal(b.claimed, true);
});

test('sandbox and production events are distinguishable', async () => {
  const f = createFakeSupabase({});
  await C.claimBillingEvent(f.S, f.cfg, { provider: 'apple', provider_event_id: 'E1', environment: 'sandbox' });
  assert.equal(f.rows('billing_events')[0].environment, 'sandbox');
  const bad = await C.claimBillingEvent(f.S, f.cfg, { provider: 'apple', provider_event_id: 'E2', environment: 'staging' });
  assert.equal(bad.ok, false, 'an unknown billing environment was accepted');
});

test('an event with no id, or an unknown provider, is refused rather than stored', async () => {
  const f = createFakeSupabase({});
  assert.equal((await C.claimBillingEvent(f.S, f.cfg, { provider: 'apple' })).ok, false);
  assert.equal((await C.claimBillingEvent(f.S, f.cfg, { provider: 'paypal', provider_event_id: 'x' })).ok, false);
  assert.equal(f.rows('billing_events').length, 0);
});

test('processing is recorded separately from receipt', async () => {
  const f = createFakeSupabase({});
  await C.claimBillingEvent(f.S, f.cfg, { provider: 'web', provider_event_id: 'evt_1' });
  assert.equal(f.rows('billing_events')[0].processed_at, null);
  await C.markBillingEventProcessed(f.S, f.cfg, { provider: 'web', provider_event_id: 'evt_1', result: 'processed' });
  const row = f.rows('billing_events')[0];
  assert.ok(row.processed_at, 'processing was never recorded');
  assert.equal(row.result, 'processed');
});

test('no provider payload is stored, and none may be', () => {
  const t = /create table if not exists public\.billing_events \(([^;]*?)\n\);/.exec(sqlCode());
  assert.ok(t);
  assert.doesNotMatch(t[1], /payload|raw_body|body\s+(text|jsonb)|jsonb/,
    'the raw provider payload is being stored — it carries customer identifiers');
  const src = fs.readFileSync(path.join(ROOT, 'api', '_commercial-store.js'), 'utf8');
  assert.doesNotMatch(src, /console\.log\([^)]*JSON\.stringify\(ev/,
    'a provider event is being sprayed into the logs');
});

// ===========================================================================
// SUBSCRIPTION MIRRORING
// ===========================================================================
test('a subscription is validated at the boundary, not stored and puzzled over later', () => {
  const bad = [
    [{ provider: 'paypal' }, 'unknown_provider'],
    [{ provider_subscription_id: null }, 'no_provider_subscription_id'],
    [{ account_id: null }, 'no_account_id'],
    [{ condition: 'incomplete' }, 'unknown_condition'],
    [{ product_code: 'VALHALLA_PRO' }, 'unknown_product'],
    [{ offer_code: 'STANDARD_LIFETIME' }, 'unknown_offer'],
    [{ billing_period: 'weekly' }, 'unknown_billing_period'],
    [{ environment: 'staging' }, 'unknown_environment'],
    [{ current_period_end: 'soon' }, 'malformed_date_current_period_end']
  ];
  bad.forEach(([over, reason]) => {
    const r = C.normaliseSubscription(sub(over));
    assert.equal(r.ok, false, JSON.stringify(over) + ' was accepted');
    assert.equal(r.reason, reason);
  });
});

test('a redelivered subscription update lands on the same row, not a second subscription', async () => {
  const f = createFakeSupabase({});
  const base = sub({ id: undefined });
  await C.upsertSubscription(f.S, f.cfg, base);
  await C.upsertSubscription(f.S, f.cfg, Object.assign({}, base, { current_period_end: at(500) }));
  assert.equal(f.rows('subscriptions').length, 1, 'a redelivery created a duplicate subscription');
  assert.equal(f.rows('subscriptions')[0].current_period_end, at(500).toISOString());
});

test('account_id is ours and is never among the columns a provider payload owns', () => {
  assert.equal(C.SUBSCRIPTION_COLUMNS.indexOf('account_id'), -1,
    'a provider payload could re-point a purchase at another athlete');
});

test('EMAIL CANNOT HIJACK ANOTHER ATHLETE’S PURCHASE', async () => {
  /* A subscription belongs to an account uuid. There is no lookup by email
     anywhere in the commercial path, so knowing an address buys nothing. */
  const f = createFakeSupabase({});
  await C.upsertSubscription(f.S, f.cfg, sub({ id: undefined, account_id: ACC }));
  const victim = await C.resolveStandardEntitlement(f.S, f.cfg, ACC, T0);
  const attacker = await C.resolveStandardEntitlement(f.S, f.cfg, OTHER, T0);
  assert.equal(victim.active, true);
  assert.equal(attacker.active, false, 'another account resolved to somebody else’s subscription');

  ['_entitlement.js', '_commercial-store.js', '_products.js'].forEach(m => {
    const src = fs.readFileSync(path.join(ROOT, 'api', m), 'utf8');
    assert.doesNotMatch(src, /email=eq\.|by_email|findByEmail/i,
      m + ' resolves commercial state by email');
  });
});

// ===========================================================================
// GRANTS -- IDEMPOTENCE AND REVOCATION
// ===========================================================================
test('a repeated grant does not create a second one', async () => {
  const f = createFakeSupabase({});
  const a = await C.grantEntitlement(f.S, f.cfg, { account_id: ACC, source: 'admin_beta' });
  const b = await C.grantEntitlement(f.S, f.cfg, { account_id: ACC, source: 'admin_beta' });
  assert.equal(a.granted, true);
  assert.equal(b.granted, false);
  assert.equal(b.reason, 'already_granted');
  assert.equal(f.rows('entitlement_grants').length, 1);
});

test('a repeated grant is idempotent whichever way the constraint reports it', async () => {
  /* PostgREST's ignore-duplicates targets the PRIMARY KEY, which here is a
     generated id and never collides. The constraint that actually refuses a
     second live grant is the PARTIAL unique index, and Postgres reports that
     as a 23505 -> 409. Both shapes must read as "already granted", or a rerun
     of the beta migration looks like a failure. */
  const four09 = { sb: async () => ({ ok: false, status: 409, json: async () => ({ code: '23505' }) }) };
  const r = await C.grantEntitlement(four09, {}, { account_id: ACC, source: 'admin_beta' });
  assert.equal(r.ok, true);
  assert.equal(r.granted, false);
  assert.equal(r.reason, 'already_granted');
  // and a genuine failure is still a failure
  const five03 = { sb: async () => ({ ok: false, status: 503, json: async () => null }) };
  assert.equal((await C.grantEntitlement(five03, {}, { account_id: ACC, source: 'admin_beta' })).ok, false);
});

test('ensuring the commercial row tolerates it already existing', async () => {
  const four09 = { sb: async () => ({ ok: false, status: 409, json: async () => null }) };
  assert.equal((await C.ensureAccountCommercial(four09, {}, ACC)).ok, true);
});

test('revoking is a timestamp, and leaves any other source alone', async () => {
  const f = createFakeSupabase({
    entitlement_grants: [grant({ id: 'g1', source: 'admin_beta' }),
                         grant({ id: 'g2', source: 'admin_comp' })],
    subscriptions: [sub()]
  });
  const r = await C.revokeGrant(f.S, f.cfg, { account_id: ACC, source: 'admin_beta' });
  assert.equal(r.revoked, 1);
  const rows = f.rows('entitlement_grants');
  assert.equal(rows.length, 2, 'revocation deleted the audit trail');
  assert.ok(rows.find(g => g.source === 'admin_beta').revoked_at);
  assert.equal(rows.find(g => g.source === 'admin_comp').revoked_at, null);
  const after = await C.resolveStandardEntitlement(f.S, f.cfg, ACC, T0);
  assert.equal(after.active, true, 'revoking one source took access away from the others');
});

test('a grant may be reissued after being revoked', async () => {
  const f = createFakeSupabase({});
  await C.grantEntitlement(f.S, f.cfg, { account_id: ACC, source: 'admin_comp' });
  await C.revokeGrant(f.S, f.cfg, { account_id: ACC, source: 'admin_comp' });
  const again = await C.grantEntitlement(f.S, f.cfg, { account_id: ACC, source: 'admin_comp' });
  assert.equal(again.granted, true, 'the partial index should have freed the slot');
});

// ===========================================================================
// BETA MIGRATION
// ===========================================================================
test('the beta cohort is the allowlist, never every account', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-commercial-core.sql'), 'utf8');
  const backfill = /insert into public\.entitlement_grants[^;]*;/.exec(sql)[0];
  assert.match(backfill, /join public\.beta_allowlist/,
    'the cohort is not drawn from the allowlist');
  assert.match(backfill, /b\.revoked_at is null/, 'revoked testers are being re-granted');
  assert.doesNotMatch(backfill, /from auth\.users\s+u\s*(where|on conflict)/i,
    'the backfill grants Standard to every account that ever signed in');
  assert.match(backfill, /on conflict do nothing/, 'the backfill is not rerun-safe');
});

test('the migration creates no fake subscription and no fake trial', () => {
  /* sqlCode(), because the verify block at the end of the migration quotes an
     `insert into public.subscriptions` as an example of something RLS must
     REFUSE. A guard that cannot tell that from a real insert is one somebody
     will eventually delete. */
  assert.doesNotMatch(sqlCode(), /insert into public\.subscriptions/i,
    'the migration fabricates subscriptions for beta athletes');
  assert.doesNotMatch(sqlCode(), /insert into public\.billing_events/i);
  /* 'trialing' appears legitimately in the subscriptions CHECK constraint --
     the model has to be able to express a trial. What must not exist is a
     statement that puts a real athlete into one. */
  const inserts = sqlCode().match(/insert into[^;]*;/gi) || [];
  inserts.forEach(i => assert.doesNotMatch(i, /trialing|trial_consumed/i,
    'a migration INSERT puts somebody into a trial:\n' + i));
});

test('the migration is additive and destroys nothing', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-commercial-core.sql'), 'utf8');
  assert.doesNotMatch(sql, /drop table|truncate|delete from|drop column/i,
    'the migration destroys existing data');
  // the live gate's own table and the tester record are not touched
  assert.doesNotMatch(sql, /alter table public\.entitlements/i);
  assert.doesNotMatch(sql, /(insert|update|delete)[\s\S]{0,40}public\.beta_allowlist/i);
  assert.doesNotMatch(sql, /(alter|drop)[\s\S]{0,20}public\.plans/i);
});

test('the migration is rerunnable: every create is guarded', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-commercial-core.sql'), 'utf8');
  const creates = sql.match(/^create (table|index|unique index)[^\n]*/gmi) || [];
  assert.ok(creates.length >= 4);
  creates.forEach(c => assert.match(c, /if not exists/i, 'not rerun-safe: ' + c));
});

test('a migrated beta athlete keeps their identity and their history', async () => {
  /* Nothing about the grant path touches a plan, a session or an identifier:
     the grant is a new row that references the SAME auth uuid. */
  const f = createFakeSupabase({ account_commercial: [{ account_id: ACC }] });
  await C.grantEntitlement(f.S, f.cfg, { account_id: ACC, source: 'admin_beta',
                                         note: 'beta cohort migration' });
  assert.equal(f.rows('entitlement_grants')[0].account_id, ACC);
  assert.equal(f.rows('subscriptions').length, 0, 'a fake subscription was created');
  const r = await C.resolveStandardEntitlement(f.S, f.cfg, ACC, T0);
  assert.equal(r.active, true);
  assert.equal(r.reason, 'admin_beta');
  assert.equal(r.commercialState, 'none');
});

test('founder access does not become dependent on a subscription', () => {
  const gate = fs.readFileSync(path.join(ROOT, 'api', '_access.js'), 'utf8');
  // the override branch still runs BEFORE any commercial rule
  const body = /function resolveAccess\(input\)\{([^]*?)\n\}/.exec(gate)[1];
  /* The CALL, against the first commercial RULE -- not against the variable
     declarations at the top of the function, which say nothing about order. */
  const ovAt = body.indexOf('const ov = overrideOf(');
  const commAt = body.search(/if \(!commReq\)/);
  assert.ok(ovAt > -1, 'the override branch has gone');
  assert.ok(commAt > -1, 'the commercial branch has gone');
  assert.ok(ovAt < commAt, 'a commercial rule now runs before the owner override');
  assert.doesNotMatch(sqlCode(), /update public\.entitlements|delete from public\.entitlements/i,
    'the migration disturbs the owner override');
});

// ===========================================================================
// SECURITY
// ===========================================================================
test('no commercial table grants an athlete any write policy', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-commercial-core.sql'), 'utf8');
  const policies = sql.match(/create policy[^;]*;/gi) || [];
  assert.ok(policies.length >= 3, 'expected the read-own policies');
  policies.forEach(p => {
    assert.match(p, /\bfor select\b/i,
      'a non-select policy exists on a commercial table:\n' + p);
    assert.doesNotMatch(p, /with check/i, 'a write path was opened:\n' + p);
  });
  ['account_commercial', 'subscriptions', 'entitlement_grants', 'billing_events'].forEach(t => {
    assert.match(sql, new RegExp('alter table public\\.' + t + ' enable row level security'),
      t + ' does not have RLS enabled');
  });
});

test('the production hardening is in the repository, or the schema has drifted', () => {
  /* These four were flagged by Supabase's linter after the first production
     run and corrected in the live database. The repository SQL is the thing a
     fresh environment is built from, so it has to carry them too -- otherwise
     staging is built without them and the drift is discovered by the linter a
     second time. */
  const sql = sqlCode();

  // 1. both functions pin their search_path
  ['touch_updated_at', 'seed_account_commercial'].forEach(fn => {
    const m = new RegExp('create or replace function public\\.' + fn +
                         '\\(\\)[^]*?\\bas \\$\\$').exec(sql);
    assert.ok(m, fn + ': function not found');
    assert.match(m[0], /set search_path\s*=/,
      fn + ' has a mutable search_path (function_search_path_mutable)');
  });

  // 2. the SECURITY DEFINER trigger function is not executable by an athlete
  assert.match(sql, /revoke all on function public\.seed_account_commercial\(\)\s*from[^;]*\bpublic\b[^;]*\banon\b[^;]*\bauthenticated\b/i,
    'a signed-in athlete can invoke the SECURITY DEFINER seed function directly');
  assert.match(sql, /grant execute on function public\.seed_account_commercial\(\)[^;]*service_role/i,
    'the trigger function was revoked from everyone, including the roles that fire it');

  // 3. every commercial policy hoists auth.uid() out of the per-row path
  const policies = sql.match(/create policy[^;]*;/gi) || [];
  assert.equal(policies.length, 3);
  policies.forEach(p => {
    assert.match(p, /\(\s*select auth\.uid\(\)\s*\)/i,
      'a policy still calls auth.uid() per row (auth_rls_initplan):\n' + p);
    assert.doesNotMatch(p, /(?<!select\s)(?<!\()auth\.uid\(\)\s*=/i,
      'a bare auth.uid() remains in:\n' + p);
  });

  // 4. the foreign key from billing_events to subscriptions is covered
  assert.match(sql, /create index if not exists billing_events_subscription_idx\s*\n?\s*on public\.billing_events \(subscription_id\)/i,
    'billing_events.subscription_id is an unindexed foreign key');
});

test('billing_events denies the athlete outright, even for their own rows', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-commercial-core.sql'), 'utf8');
  const policies = sql.match(/create policy[^;]*on public\.billing_events[^;]*;/gi) || [];
  assert.equal(policies.length, 0, 'the provider event stream is readable by athletes');
});

test('an ordinary client cannot grant itself entitlement or reset its trial', () => {
  /* Structural, because it is the only honest way to assert it: every write in
     the commercial path goes through cfg.serviceKey, and the athlete's token
     is never used to write. */
  const src = fs.readFileSync(path.join(ROOT, 'api', '_commercial-store.js'), 'utf8');
  assert.doesNotMatch(src, /Authorization[^\n]*accessToken|userToken|req\.headers/i,
    'a caller-supplied token reaches the commercial writer');
  const app = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  ['account_commercial', 'entitlement_grants', 'billing_events', 'subscriptions']
    .forEach(t => assert.ok(app.indexOf(t) === -1,
      'the browser bundle references ' + t + ' — commercial tables must be server-only'));
});

test('no billing secret is exposed to the client bundle', () => {
  const app = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  [/NEXT_PUBLIC[A-Z_]*(STRIPE|BILLING|PRICE)/, /sk_live/, /sk_test/, /whsec_/,
   /rk_live/, /VVV_PRICE_/].forEach(re =>
    assert.doesNotMatch(app, re, 'a billing secret shape appears in the client bundle'));
  /* The word "service_role" appears in a comment stating that the key must
     never be shipped. What must not appear is a KEY: a JWT whose payload
     claims that role. */
  assert.doesNotMatch(app, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}/,
    'a JWT-shaped credential is embedded in the client bundle');
});

test('no card data is modelled anywhere', () => {
  const sql = sqlCode();
  [/\bpan\b/i, /card_number/i, /last4|last_four/i, /\bcvv\b/i, /\bcvc\b/i,
   /exp_month|exp_year/i].forEach(re =>
    assert.doesNotMatch(sql, re, 'payment instrument data is being stored'));
});

test('the resolver is pure: no clock, no environment, no network', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_entitlement.js'), 'utf8');
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'the resolver makes network calls');
  assert.doesNotMatch(src, /process\.env/, 'the resolver reads the environment');
  /* Date.now()/new Date() appear only as the LAST-RESORT fallback inside
     asDate helpers; every decision takes `now` as an argument. */
  const decisions = ['subscriptionAccess', 'grantAccess', 'resolveStandardEntitlement',
                     'trialEligibility', 'mayStartStandardPurchase'];
  decisions.forEach(fn => {
    const m = new RegExp('function ' + fn + '\\(([^)]*)\\)').exec(src);
    assert.ok(m, fn + ' is missing');
    assert.match(m[1], /now|input|sub|grant|account/, fn + ' takes no injectable clock');
  });
});

// ===========================================================================
// THE BRIDGE TO THE LIVE GATE
// ===========================================================================
const A = require(path.join(ROOT, 'api', '_access.js'));

test('the projection keeps the deployed gate agreeing with the resolver', () => {
  const cases = [
    [[], [], false],
    [[sub()], [], true],
    [[sub({ condition: 'trialing', trial_end: at(24) })], [], true],
    [[sub({ condition: 'expired', current_period_end: at(-1) })], [], false],
    [[sub({ condition: 'past_due', current_period_end: at(-1), grace_period_end: at(24) })], [], true],
    [[], [grant()], true],
    [[], [grant({ source: 'admin_comp', expires_at: at(24) })], true],
    [[], [grant({ revoked_at: at(-1) })], false],
    [[sub({ condition: 'revoked' })], [grant()], true]
  ];
  cases.forEach(([subs, grants, wantActive], i) => {
    const r = resolve(subs, grants);
    const row = E.projectToEntitlementRow(r, null);
    const gate = A.resolveAccess({
      uid: ACC, entitlement: row, accountRequired: true, commercialRequired: true, now: T0
    });
    assert.equal(r.active, wantActive, 'case ' + i + ': resolver');
    assert.equal(gate.allow, wantActive,
      'case ' + i + ': the gate and the resolver disagree — ' + JSON.stringify(row));
  });
});

test('an administrative grant projects as an override, never as a fake subscription', () => {
  const row = E.projectToEntitlementRow(resolve([], [grant()]), null);
  assert.equal(row.override, 'beta');
  assert.equal(row.state, 'expired', 'a tester was given a commercial state they never bought');
  assert.equal(row.access_until, null, 'a grant leaked into the commercial access window');
});

test('the projection never invents a commercial window from a grant', () => {
  const row = E.projectToEntitlementRow(
    resolve([], [grant({ source: 'admin_comp', expires_at: at(100) })]), null);
  assert.equal(row.access_until, null);
  assert.equal(row.override_expires_at, at(100).toISOString());
});

test('the projection preserves an operator’s note rather than overwriting it', () => {
  const row = E.projectToEntitlementRow(resolve([sub()], []),
    { override_note: 'refunded manually, see ticket 41' });
  assert.equal(row.override_note, 'refunded manually, see ticket 41');
});

test('the arrow only points one way: the resolver never reads the entitlements row', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_commercial-store.js'), 'utf8');
  const resolveFn = /async function resolveStandardEntitlement\(([^]*?)\n\}/.exec(src)[0];
  assert.doesNotMatch(resolveFn, /\/entitlements/,
    'the projection has become an input to the decision it projects');
});

test('syncing the gate row writes the projection and nothing else', async () => {
  const f = createFakeSupabase({
    account_commercial: [{ account_id: ACC }],
    subscriptions: [sub({ id: undefined })],
    entitlements: [{ user_id: ACC, override_note: 'keep me' }]
  });
  const r = await C.syncEntitlementRow(f.S, f.cfg, ACC, T0);
  assert.equal(r.ok, true);
  const row = f.rows('entitlements')[0];
  assert.equal(row.state, 'active');
  assert.equal(row.access_until, at(24 * 30).toISOString());
  assert.equal(row.override_note, 'keep me');
});

// ===========================================================================
// PUBLIC SHAPE
// ===========================================================================
test('the client answer carries an access decision and no provider identifiers', () => {
  const v = E.publicEntitlement(resolve([sub({ provider_customer_id: 'cus_123',
                                               provider_subscription_id: 'sub_abc' })]));
  assert.deepEqual(Object.keys(v).sort(),
    ['active', 'commercial_state', 'management_provider', 'product', 'reason', 'valid_until']);
  const json = JSON.stringify(v);
  assert.ok(json.indexOf('cus_123') === -1, 'a provider customer id reached the client');
  assert.ok(json.indexOf('sub_abc') === -1, 'a provider subscription id reached the client');
});

// ===========================================================================
// COACHING BOUNDARY
// ===========================================================================
test('no provider vocabulary reaches the coaching runtime', () => {
  const app = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  [/stripe/i, /storekit/i, /play\s*billing/i, /\bRTDN\b/, /app\s*store\s*connect/i]
    .forEach(re => assert.doesNotMatch(app, re,
      'a payment provider is named inside the coaching runtime'));
});

test('the commercial core imports nothing from the coaching domain', () => {
  ['_products.js', '_entitlement.js', '_commercial-store.js'].forEach(m => {
    const src = fs.readFileSync(path.join(ROOT, 'api', m), 'utf8');
    const reqs = [...src.matchAll(/require\('([^']+)'\)/g)].map(x => x[1]);
    reqs.forEach(r => assert.ok(/^\.\/_[a-z-]+\.js$/.test(r),
      m + ' requires ' + r + ' — the commercial core must stay self-contained'));
  });
});

test('the shared modules stay underscored, so no serverless function was added', () => {
  ['_products.js', '_entitlement.js', '_commercial-store.js'].forEach(m =>
    assert.ok(fs.existsSync(path.join(ROOT, 'api', m)), m + ' is missing'));
  const fns = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.ok(fns.length <= 12, 'the commercial core added a serverless function');
});
