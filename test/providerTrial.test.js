'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../api/_entitlement.js');
const P = require('../api/_products.js');
const Stripe = require('../api/_stripe.js');

// THE TRIAL, AS A REAL SUBSCRIPTION.
//
// It was card-free and needed a representation of its own. HQ replaced it with
// a trial that takes a payment method upfront and converts automatically to the
// interval the athlete chose. That makes it an ordinary provider subscription
// with fourteen free days, and the canonical model already handled those --
// so this change is a subtraction, and these tests guard the subtraction.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = new Date('2026-08-20T12:00:00Z');
const sub = (over) => Object.assign({
  id: 's1', account_id: 'acc-1', provider: 'web', product_code: P.STANDARD,
  condition: 'trialing', environment: 'production',
  trial_start: '2026-08-20T00:00:00Z', trial_end: '2026-09-03T00:00:00Z',
  current_period_end: '2026-09-03T00:00:00Z', cancel_at_period_end: false
}, over || {});

// ---------------------------------------------------------------------------
// THE CARD-FREE TRIAL IS GONE
// ---------------------------------------------------------------------------
test('no card-free trial authority remains anywhere', () => {
  assert.deepEqual(E.GRANT_SOURCES.slice().sort(), ['admin_beta', 'admin_comp']);
  assert.equal(fs.existsSync(path.join(ROOT, 'api/_trial.js')), false);
  const core = read('supabase-commercial-core.sql').replace(/--.*$/gm, ' ');
  const mig = read('supabase-trial-via-provider.sql');
  assert.match(mig, /drop function if exists public\.start_standard_trial/);
  assert.match(mig, /check \(source in \('admin_beta', 'admin_comp'\)\) not valid/);
});

test('a trial grant can no longer be written, but history survives', () => {
  // NOT VALID: existing rows stay readable -- they granted real access once and
  // deleting them would rewrite the record -- while nothing new may use it.
  const mig = read('supabase-trial-via-provider.sql');
  assert.match(mig, /not valid/);
  assert.equal(/delete from public\.entitlement_grants/.test(mig), false,
    'history must not be destroyed to narrow a vocabulary');
});

test('the migration refuses while anyone lives on a card-free trial', () => {
  const mig = read('supabase-trial-via-provider.sql');
  assert.match(mig, /ABORTED: .* live card-free trial grant/);
  assert.match(mig, /Nothing has been changed/);
  assert.ok(mig.indexOf('ABORTED') < mig.indexOf('drop function if exists public.start_standard_trial'),
    'the guard must precede the drop');
});

// ---------------------------------------------------------------------------
// THE TRIAL NOW RIDES THE SUBSCRIPTION PATH
// ---------------------------------------------------------------------------
test('a trialing subscription grants access until trial_end', () => {
  const a = E.subscriptionAccess(sub(), NOW);
  assert.equal(a.active, true);
  assert.equal(a.reason, 'trial');
  assert.equal(a.until, '2026-09-03T00:00:00.000Z');
});

test('cancelling during the trial keeps access and stops the renewal', () => {
  // The provider does not move the row to 'cancelled' merely because auto-renew
  // was switched off, so the trial branch runs and access continues.
  const a = E.subscriptionAccess(sub({ cancel_at_period_end: true }), NOW);
  assert.equal(a.active, true);
  assert.equal(a.reason, 'trial');
  // And once the trial ends, nothing renews it.
  const after = E.subscriptionAccess(sub({ cancel_at_period_end: true }), new Date('2026-09-04T00:00:00Z'));
  assert.equal(after.active, false);
  assert.equal(after.reason, 'expired');
});

test('a trial that has run out grants nothing', () => {
  const a = E.subscriptionAccess(sub(), new Date('2026-09-03T00:00:01Z'));
  assert.equal(a.active, false);
  assert.equal(a.reason, 'expired');
});

test('conversion to paid is a condition change, not a new relationship', () => {
  const converted = sub({ condition: 'active', current_period_end: '2026-10-03T00:00:00Z' });
  const a = E.subscriptionAccess(converted, new Date('2026-09-04T00:00:00Z'));
  assert.equal(a.active, true);
  assert.equal(a.reason, 'paid');
});

// ---------------------------------------------------------------------------
// THE ALLOWANCE
// ---------------------------------------------------------------------------
test('abandoning Checkout does not spend the trial', () => {
  // The allowance is stamped when a provider says a trialing subscription
  // EXISTS. Somebody who reaches the payment screen and changes their mind has
  // not used their trial, and charging them for that decision would be
  // indefensible.
  const hook = read('api/billing-webhook.js');
  const at = hook.indexOf('trial_consumed_at');
  assert.ok(at !== -1);
  const around = hook.slice(at - 900, at + 400);
  assert.match(around, /ev\.condition === 'trialing'/,
    'only a real trialing subscription may spend it');
  assert.match(around, /never\s*\n?\s*\*?\s*when somebody opens Checkout/i);
  // Checkout creation must not touch it at all.
  const checkout = read('api/_checkout.js');
  assert.equal(checkout.indexOf('trial_consumed_at'), -1);
});

test('a webhook replay cannot move the allowance forward', () => {
  // Conditional on the column being null, so a second trialing event -- a
  // replay, or a resumed subscription -- cannot quietly reset the lifetime
  // rule's reference point.
  const hook = read('api/billing-webhook.js');
  assert.match(hook, /trial_consumed_at=is\.null/);
});

test('the lifetime rule still lives on the account', () => {
  const consumed = { trial_consumed_at: '2026-08-06T00:00:00Z', trial_consumed_provider: 'web' };
  assert.equal(E.trialEligibility(consumed, NOW).eligible, false);
  assert.equal(E.trialEligibility(consumed, NOW).reason, 'already_used');
  assert.equal(E.trialEligibility({}, NOW).eligible, true);
});

// ---------------------------------------------------------------------------
// MONTHLY AND ANNUAL ARE THE ATHLETE'S CHOICE
// ---------------------------------------------------------------------------
test('both intervals carry the same fourteen days', () => {
  assert.equal(P.offerForPeriod('monthly').trialDays, 14);
  assert.equal(P.offerForPeriod('yearly').trialDays, 14);
  assert.equal(P.offerForPeriod('monthly').priceMinor, 1199);
  assert.equal(P.offerForPeriod('yearly').priceMinor, 8999);
});

test('the chosen interval survives into the subscription', () => {
  for (const [offer, period] of [['STANDARD_MONTHLY', 'monthly'], ['STANDARD_YEARLY', 'yearly']]) {
    const ev = Stripe.normaliseEvent({
      id: 'evt_1', type: 'customer.subscription.created', created: 1780000000,
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'trialing',
        metadata: { vvv_account_id: 'acc-1', vvv_offer: offer, vvv_period: period },
        trial_end: 1781209600, current_period_end: 1781209600 } }
    });
    assert.equal(ev.offer_code, offer);
    assert.equal(ev.billing_period, period);
    assert.equal(ev.condition, 'trialing');
  }
});

// ---------------------------------------------------------------------------
// FOUNDING PRICE
// ---------------------------------------------------------------------------
test('what the athlete agreed is recorded, not inferred from the catalogue', () => {
  // Reading a historic price off today's catalogue is wrong the first time
  // prices change. The catalogue says what we sell now; this says what THIS
  // athlete agreed to.
  const ev = Stripe.normaliseEvent({
    id: 'evt_1', type: 'customer.subscription.created', created: 1780000000,
    data: { object: { id: 'sub_1', customer: 'cus_1', status: 'trialing',
      metadata: { vvv_account_id: 'acc-1', vvv_offer: 'STANDARD_YEARLY', vvv_period: 'yearly' },
      trial_end: 1781209600, current_period_end: 1781209600 } }
  });
  assert.equal(ev.agreed_price_minor, 8999);
  assert.equal(ev.agreed_currency, 'GBP');
  assert.equal(ev.catalogue_version, P.CATALOGUE_VERSION);
});

test('the agreed price reaches the row, and is not merely handed to a writer', async () => {
  /* THIS TEST USED TO ASSERT THE SOURCE LINE. It matched
     `agreed_price_minor: ev.agreed_price_minor` in the webhook and passed --
     while the store dropped the value on the floor, because the column was
     not in SUBSCRIPTION_COLUMNS and the upsert copies nothing else. The
     founding-price promise was unimplemented behind a green test for as long
     as the test looked at the caller instead of the row.

     So it reads the row now. A grep can be satisfied by a line; a row cannot. */
  const { createFakeSupabase } = require('./fakeSupabase.js');
  const Store = require('../api/_commercial-store.js');
  const f = createFakeSupabase({ subscriptions: [] });

  await Store.upsertSubscription(f.S, f.cfg, {
    provider: 'web', provider_subscription_id: 'sub_1', account_id: 'acc-1',
    product_code: P.STANDARD, offer_code: 'STANDARD_YEARLY', billing_period: 'yearly',
    condition: 'trialing', environment: 'production'
  });
  const lock = await Store.lockAgreedPrice(f.S, f.cfg, {
    provider: 'web', provider_subscription_id: 'sub_1',
    offer_code: 'STANDARD_YEARLY', at: NOW
  });
  assert.equal(lock.ok, true);
  assert.equal(lock.locked, true);

  const row = f.rows('subscriptions')[0];
  assert.equal(row.agreed_price_minor, 8999);
  assert.equal(row.agreed_currency, 'GBP');
  assert.equal(row.catalogue_version, P.CATALOGUE_VERSION);
  assert.equal(row.price_locked_at, NOW.toISOString());
});

test('the price is recorded but never billed from', () => {
  const mig = read('supabase-trial-via-provider.sql');
  assert.match(mig, /Recorded, never billed/);
  // Stripe is handed a price id from the environment, never an amount.
  /* Comments stripped: the file's own documentation SAYS it never trusts an
     amount, and matching that sentence would fail the test on the reassurance
     it was written to give. */
  const stripe = read('api/_stripe.js')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  assert.equal(/unit_amount|price_data|amount:/.test(stripe), false,
    'the adapter must never construct a price');
});

test('a catalogue version exists so a cohort need not be inferred from a date', () => {
  assert.equal(typeof P.CATALOGUE_VERSION, 'string');
  assert.ok(P.CATALOGUE_VERSION.length > 0);
});
