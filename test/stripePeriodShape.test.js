'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const P = require('../api/_stripe.js');
const E = require('../api/_entitlement.js');
const Prod = require('../api/_products.js');

/* WHERE STRIPE PUTS THE BILLING PERIOD, AND WHY IT NEARLY COST US EVERY PAYING
 * CUSTOMER FOURTEEN DAYS AFTER THEY PAID.
 *
 * Stripe used to render current_period_start / current_period_end on the
 * SUBSCRIPTION. Newer API versions render them on each subscription ITEM. Which
 * shape arrives depends on the API version in play, and that is two separate
 * settings neither of which this repository controls: the account default
 * governs our REST calls, the endpoint pin governs webhook payloads.
 *
 * The adapter read only the top level. The failure that produces is the worst
 * shape a failure can take:
 *
 *   trial_end is top-level in EVERY version, so a fourteen-day trial resolved
 *   perfectly and every test anybody ran on the day passed;
 *
 *   the period fields came back undefined, so the row was written with a null
 *   current_period_end;
 *
 *   and _entitlement.js reads a null period on an `active` subscription as
 *   EXPIRED -- so the athlete was refused the instant their trial converted.
 *
 * A fortnight of silence, then every paying customer locked out at once. This
 * file is the proof that both shapes now reach the same answer, and the
 * regression that would catch it coming back.
 */

const ROOT = path.join(__dirname, '..');
const ACC = '11111111-1111-4111-8111-111111111111';
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const secs = ms => Math.floor(ms / 1000);
const days = n => n * 24 * 3600 * 1000;
const META = { vvv_account_id: ACC, vvv_offer: 'STANDARD_MONTHLY', vvv_period: 'monthly' };
const MEfromEvent = { type: 'customer.subscription.updated', eventId: 'evt_1',
                      occurredAt: new Date(T0).toISOString() };

/* The same subscription, told the two ways Stripe tells it. Everything outside
   the period fields is identical on purpose: the only variable under test is
   WHERE the period lives. */
function topLevelShape(over){
  return Object.assign({
    id: 'sub_1', customer: 'cus_1', status: 'active', metadata: META,
    trial_start: null, trial_end: null,
    current_period_start: secs(T0), current_period_end: secs(T0 + days(30)),
    cancel_at_period_end: false, canceled_at: null,
    items: { data: [{ price: { recurring: { interval: 'month' } } }] }
  }, over || {});
}
function itemLevelShape(over){
  const o = Object.assign({
    id: 'sub_1', customer: 'cus_1', status: 'active', metadata: META,
    trial_start: null, trial_end: null,
    cancel_at_period_end: false, canceled_at: null,
    items: { data: [{ current_period_start: secs(T0),
                      current_period_end: secs(T0 + days(30)),
                      price: { recurring: { interval: 'month' } } }] }
  }, over || {});
  /* An over-ride naming the top-level period would defeat the point of the
     fixture, so the item carries any period the caller asked for instead. */
  if (over && over.current_period_start !== undefined){
    o.items.data[0].current_period_start = over.current_period_start;
    delete o.current_period_start;
  }
  if (over && over.current_period_end !== undefined){
    o.items.data[0].current_period_end = over.current_period_end;
    delete o.current_period_end;
  }
  return o;
}

// ===========================================================================
// THE TWO SHAPES
// ===========================================================================
test('the legacy top-level period shape still translates exactly as it did', () => {
  const f = P.subscriptionFacts(topLevelShape(), MEfromEvent);
  assert.equal(f.period_start, new Date(T0).toISOString());
  assert.equal(f.period_end, new Date(T0 + days(30)).toISOString());
  assert.equal(f.invoiced_through, new Date(T0 + days(30)).toISOString());
  assert.equal(f.condition, 'active');
});

test('the item-level period shape translates to the same instants', () => {
  const f = P.subscriptionFacts(itemLevelShape(), MEfromEvent);
  assert.equal(f.period_start, new Date(T0).toISOString());
  assert.equal(f.period_end, new Date(T0 + days(30)).toISOString());
  assert.equal(f.invoiced_through, new Date(T0 + days(30)).toISOString());
});

test('both shapes produce byte-equivalent canonical facts', () => {
  /* Not "equivalent enough" -- identical. The whole point of an adapter is that
     what leaves it carries no trace of which wire format arrived, and a
     stringify comparison is the only assertion that cannot be satisfied by a
     near miss. */
  const a = P.subscriptionFacts(topLevelShape(), MEfromEvent);
  const b = P.subscriptionFacts(itemLevelShape(), MEfromEvent);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('the subscription wins when Stripe sends the period in both places', () => {
  /* Order of authority, stated rather than incidental: the subscription's own
     period governs the subscription. The item is a fallback for the versions
     that no longer render it above. */
  const both = topLevelShape();
  both.items.data[0].current_period_end = secs(T0 + days(999));
  const f = P.subscriptionFacts(both, MEfromEvent);
  assert.equal(f.period_end, new Date(T0 + days(30)).toISOString(),
    'the item must not override the subscription');
});

test('absent from both places still fails closed, exactly as before', () => {
  const none = itemLevelShape({ current_period_start: null, current_period_end: null });
  const f = P.subscriptionFacts(none, MEfromEvent);
  assert.equal(f.period_start, null);
  assert.equal(f.period_end, null);
  assert.equal(f.invoiced_through, null);
  /* And the row that produces is refused by the resolver rather than granted --
     the pre-existing behaviour, deliberately unchanged. Missing information
     does not grant a product. */
  const access = E.subscriptionAccess({
    provider: 'web', product_code: Prod.STANDARD, condition: 'active',
    current_period_end: f.period_end, trial_end: f.trial_end
  }, new Date(T0 + days(1)));
  assert.equal(access.active, false);
  assert.equal(access.reason, 'expired');
});

// ===========================================================================
// THE REGRESSION THAT MATTERS
// ===========================================================================
test('trialing → active with the period only on the item does NOT resolve expired', () => {
  /* THE EXACT DEFECT, MODELLED END TO END.
   *
   * Fourteen days of trial that worked, then conversion to paid, with Stripe
   * rendering the period on the item throughout. Before the fallback the second
   * half of this test failed: the athlete was refused on the day their money
   * was taken. */
  const trialing = itemLevelShape({
    status: 'trialing',
    trial_start: secs(T0), trial_end: secs(T0 + days(14)),
    current_period_start: secs(T0), current_period_end: secs(T0 + days(14))
  });
  const ft = P.subscriptionFacts(trialing, MEfromEvent);
  assert.equal(ft.condition, 'trialing');
  const inTrial = E.subscriptionAccess({
    provider: 'web', product_code: Prod.STANDARD, condition: ft.condition,
    trial_end: ft.trial_end, current_period_end: ft.period_end
  }, new Date(T0 + days(3)));
  assert.equal(inTrial.active, true);
  assert.equal(inTrial.reason, 'trial');

  // The trial converts. Stripe moves the period on; the trial window is over.
  const converted = itemLevelShape({
    status: 'active',
    trial_start: secs(T0), trial_end: secs(T0 + days(14)),
    current_period_start: secs(T0 + days(14)), current_period_end: secs(T0 + days(44))
  });
  const fa = P.subscriptionFacts(converted, {
    type: 'customer.subscription.updated', eventId: 'evt_2',
    occurredAt: new Date(T0 + days(14)).toISOString()
  });
  assert.equal(fa.condition, 'active');
  assert.equal(fa.period_end, new Date(T0 + days(44)).toISOString(),
    'the paid period must survive the translation');

  const paid = E.subscriptionAccess({
    provider: 'web', product_code: Prod.STANDARD, condition: fa.condition,
    trial_end: fa.trial_end, current_period_end: fa.period_end
  }, new Date(T0 + days(20)));
  assert.equal(paid.active, true, 'a paying subscriber must not be locked out');
  assert.equal(paid.reason, 'paid');
  assert.equal(paid.until, new Date(T0 + days(44)).toISOString());
});

test('paid-through on a failed renewal reads the item too', () => {
  /* paidThroughOf() reads current_period_START on a past_due subscription, so
     it needed the same fallback as the end. Missing it would have produced a
     null paid-through and refused an athlete mid-paid-month. */
  const dunning = itemLevelShape({
    status: 'past_due',
    current_period_start: secs(T0 + days(30)), current_period_end: secs(T0 + days(60))
  });
  const f = P.subscriptionFacts(dunning, MEfromEvent);
  assert.equal(f.condition, 'past_due');
  assert.equal(f.period_end, new Date(T0 + days(30)).toISOString(),
    'paid-through is the start of the unpaid period, read from the item');
  assert.equal(f.invoiced_through, new Date(T0 + days(60)).toISOString());
  assert.equal(f.grace_period_end, null, 'and still no grace Valhalla invented');
});

// ===========================================================================
// UNCHANGED BEHAVIOUR
// ===========================================================================
test('trial, cancellation and reactivation semantics are untouched', () => {
  const cancelled = itemLevelShape({ cancel_at_period_end: true });
  const fc = P.subscriptionFacts(cancelled, MEfromEvent);
  assert.equal(fc.cancel_at_period_end, true);
  assert.equal(fc.condition, 'active', 'cancelling stops the renewal, it does not end the subscription');
  const stillIn = E.subscriptionAccess({
    provider: 'web', product_code: Prod.STANDARD, condition: fc.condition,
    current_period_end: fc.period_end, trial_end: null
  }, new Date(T0 + days(20)));
  assert.equal(stillIn.active, true, 'the paid period is not confiscated');

  const reactivated = P.subscriptionFacts(itemLevelShape({ cancel_at_period_end: false }), MEfromEvent);
  assert.equal(reactivated.cancel_at_period_end, false);

  const deleted = P.subscriptionFacts(
    itemLevelShape({ status: 'canceled', cancellation_details: { reason: 'cancellation_requested' } }),
    { type: 'customer.subscription.deleted', eventId: 'evt_3', occurredAt: new Date(T0).toISOString() });
  assert.equal(deleted.condition, 'expired');

  const disputed = P.subscriptionFacts(
    itemLevelShape({ status: 'canceled', cancellation_details: { reason: 'payment_disputed' } }),
    { type: 'customer.subscription.deleted', eventId: 'evt_4', occurredAt: new Date(T0).toISOString() });
  assert.equal(disputed.condition, 'revoked', 'a dispute still outranks every date');
});

test('the pushed and pulled routes consume the identical translation', () => {
  /* normaliseEvent (webhook) and a direct subscriptionFacts (reconcile, cancel,
     reactivate) must not be two translations. They differ only in the metadata
     an event carries and a fetched object does not. */
  const sub = itemLevelShape();
  const pushed = P.normaliseEvent({
    id: 'evt_9', type: 'customer.subscription.updated',
    created: secs(T0), data: { object: sub }
  });
  const pulled = P.subscriptionFacts(sub, { type: 'reconcile', occurredAt: new Date(T0).toISOString() });

  ['period_start', 'period_end', 'invoiced_through', 'condition', 'offer_code',
   'billing_period', 'trial_start', 'trial_end', 'account_id', 'subscription_ref',
   'customer_ref', 'grace_period_end', 'cancel_at_period_end', 'agreed_price_minor']
    .forEach(k => assert.deepEqual(pushed[k], pulled[k], k + ' differs between the two routes'));

  assert.equal(pushed.stripe_type, 'customer.subscription.updated');
  assert.equal(pulled.stripe_type, 'reconcile');
  assert.equal(pushed.provider_event_id, 'evt_9');
  assert.equal(pulled.provider_event_id, null);
});

// ===========================================================================
// THE VERSION PIN
// ===========================================================================
test('no API version is invented, and none is sent unless configured', () => {
  /* An unpinned version is a known gap, not an oversight -- and pinning the
     WRONG one is worse than pinning none, because it silently changes the shape
     of every object the adapter parses. The repository therefore ships the
     mechanism and no value. */
  assert.equal(P.config({ STRIPE_SECRET_KEY: 'sk_test_1' }).apiVersion, '');
  const src = fs.readFileSync(path.join(ROOT, 'api', '_stripe.js'), 'utf8');
  assert.ok(!/['"]20\d\d-\d\d-\d\d/.test(src),
    'a hardcoded Stripe API version has appeared in the adapter');
});

test('when configured, the version is pinned once, in the shared transport', async () => {
  let sent = null;
  const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_API_VERSION: '2026-07-29.dahlia' });
  await P.call(cfg, 'GET', '/prices', null, {
    fetch: async (u, i) => { sent = i.headers; return { ok: true, text: async () => '{}' }; }
  });
  assert.equal(sent['Stripe-Version'], '2026-07-29.dahlia');

  const bare = P.config({ STRIPE_SECRET_KEY: 'sk_test_1' });
  await P.call(bare, 'GET', '/prices', null, {
    fetch: async (u, i) => { sent = i.headers; return { ok: true, text: async () => '{}' }; }
  });
  assert.ok(!('Stripe-Version' in sent),
    'an empty Stripe-Version is a malformed request, not "the default"');

  /* One place. A header repeated at each call site is a header that will
     eventually be missing from one of them. Comments stripped first: the
     transport explains itself right above the line, and a test that cannot
     tell an explanation from a header punishes the explanation. */
  const stripComments = x => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const src = stripComments(fs.readFileSync(path.join(ROOT, 'api', '_stripe.js'), 'utf8'));
  assert.equal((src.match(/Stripe-Version/g) || []).length, 1);
});
