'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const C = require('../api/_commerce.js');
const P = require('../api/_stripe.js');
const A = require('../api/_access.js');
const B = require('../api/_billing.js');
const { decideCheckout } = require('../api/_checkout.js');

// THE STRIPE FOUNDATION.
//
// Two properties carry most of the weight here, and both are about what the
// browser is NOT allowed to decide: it may name a billing period and nothing
// else, and it may never cause a charge while commerce is switched off.
//
// The third is that none of this reached the access model. Stripe's vocabulary
// stops at _stripe.js; what crosses into _billing.js is Velvet Viking's own.

const ROOT = path.join(__dirname, '..');
const PRICES = {
  STRIPE_PRICE_STANDARD_MONTHLY: 'price_monthly123',
  STRIPE_PRICE_STANDARD_YEARLY: 'price_yearly456'
};

// ---------------------------------------------------------------------------
// THE OFFERING
// ---------------------------------------------------------------------------
test('the two approved periods exist and nothing else is a period', () => {
  assert.deepEqual(C.PERIODS.slice().sort(), ['monthly', 'yearly']);
  assert.equal(C.OFFERING.monthly.amountMinor, 1199);
  assert.equal(C.OFFERING.yearly.amountMinor, 8999);
  assert.equal(C.OFFERING.monthly.trialDays, 14);
  assert.equal(C.OFFERING.yearly.trialDays, 14);
  assert.equal(C.OFFERING.monthly.currency, 'GBP');
});

test('an unknown period is refused, never coerced into a known one', () => {
  for (const bad of ['weekly', 'MONTHLY', ' monthly', 'month', '', null, undefined, 0, {}, ['monthly']]) {
    assert.equal(C.isPeriod(bad), false, JSON.stringify(bad) + ' must not be a period');
    assert.equal(C.planFor(bad), null, 'and must not resolve to a plan');
  }
});

test('an unconfigured price refuses rather than defaulting', () => {
  assert.equal(P.priceFor('monthly', {}).code, 'price_not_configured');
  assert.equal(P.priceFor('yearly', {}).code, 'price_not_configured');
  assert.equal(P.priceFor('weekly', PRICES).code, 'unknown_billing_period');
});

test('a malformed price id is caught before Stripe sees it', () => {
  // The commonest configuration mistake is pasting a product id, a lookup key
  // or a whole dashboard URL into the variable.
  for (const bad of ['prod_123', 'plan_123', 'https://dashboard.stripe.com/prices/price_1', 'price_']) {
    const r = P.priceFor('monthly', { STRIPE_PRICE_STANDARD_MONTHLY: bad });
    assert.equal(r.ok, false, JSON.stringify(bad) + ' must not be accepted');
  }
  assert.equal(P.priceFor('monthly', PRICES).priceId, 'price_monthly123');
  assert.equal(P.priceFor('yearly', PRICES).priceId, 'price_yearly456');
  // Surrounding whitespace IS trimmed, deliberately: a value pasted from a
  // dashboard usually arrives with a trailing newline, and refusing that would
  // be pedantry rather than safety.
  assert.equal(P.priceFor('monthly', { STRIPE_PRICE_STANDARD_MONTHLY: ' price_x \n' }).priceId, 'price_x');
});

test('the public offering never leaks a price id', () => {
  const blob = JSON.stringify(C.publicOffering(function(p){ return P.priceFor(p, PRICES).ok; }));
  assert.equal(blob.indexOf('price_monthly123'), -1);
  assert.equal(blob.indexOf('price_yearly456'), -1);
  assert.match(blob, /"configured":true/);
});

// ---------------------------------------------------------------------------
// THE CHECKOUT DECISION
// ---------------------------------------------------------------------------
const base = (over) => Object.assign({
  commerceEnabled: true, commercialRequired: true, stripeConfigured: true,
  isLiveKey: false, uid: 'u1', period: 'monthly', entitlement: null, now: new Date('2026-08-20T12:00:00Z')
}, over || {});

test('monthly and yearly are both selectable server-side', () => {
  assert.equal(decideCheckout(base({ period: 'monthly' })).period, 'monthly');
  assert.equal(decideCheckout(base({ period: 'yearly' })).period, 'yearly');
});

test('an invalid billing period is rejected', () => {
  for (const bad of ['weekly', 'lifetime', '', null, 'MONTHLY', 'monthly ']) {
    const d = decideCheckout(base({ period: bad }));
    assert.equal(d.ok, false, JSON.stringify(bad));
    assert.equal(d.code, 'unknown_billing_period');
    assert.equal(d.status, 400);
  }
});

test('checkout is refused while commerce is switched off', () => {
  // A Stripe key existing is not consent to charge anybody.
  const d = decideCheckout(base({ commerceEnabled: false }));
  assert.equal(d.ok, false);
  assert.equal(d.code, 'commerce_disabled');
  assert.equal(d.status, 503);
});

test('a live key in an uncommissioned deployment refuses', () => {
  const d = decideCheckout(base({ isLiveKey: true, commercialRequired: false }));
  assert.equal(d.ok, false);
  assert.equal(d.code, 'live_key_without_commercial_flag');
});

test('an unauthenticated caller cannot start a checkout', () => {
  const d = decideCheckout(base({ uid: null }));
  assert.equal(d.code, 'not_signed_in');
  assert.equal(d.status, 401);
});

test('an already-entitled athlete cannot silently buy twice', () => {
  for (const state of ['trial', 'active', 'grace']) {
    const d = decideCheckout(base({
      entitlement: { state: state, access_until: '2026-12-01T00:00:00Z' }
    }));
    assert.equal(d.ok, false, state + ' must not create a second subscription');
    assert.equal(d.code, 'already_entitled');
    assert.equal(d.status, 409);
  }
});

test('a lapsed athlete CAN buy again', () => {
  const d = decideCheckout(base({
    entitlement: { state: 'expired', access_until: '2026-01-01T00:00:00Z' }
  }));
  assert.equal(d.ok, true, 'expiry is exactly when resubscribing must work');
});

test('a comped athlete is refused rather than converted', () => {
  const d = decideCheckout(base({ entitlement: { state: 'expired', override: 'beta' } }));
  assert.equal(d.code, 'comped_access');
  assert.equal(d.override, 'beta');
});

// ---------------------------------------------------------------------------
// EVENT TRANSLATION
// ---------------------------------------------------------------------------
const evt = (type, object, previous, created) => ({
  id: 'evt_' + type, type: type, created: created || 1780000000,
  data: { object: object, previous_attributes: previous }
});
const sub = (o) => Object.assign({
  id: 'sub_1', customer: 'cus_1', status: 'active',
  metadata: { vvv_user_id: 'u1', vvv_period: 'monthly', vvv_tier: 'standard' },
  current_period_end: 1790000000
}, o || {});

test('a Stripe trial becomes our trial_started', () => {
  const n = P.normaliseEvent(evt('customer.subscription.created', sub({ status: 'trialing' })));
  assert.equal(n.type, 'trial_started');
  assert.equal(n.user_id, 'u1');
  assert.equal(n.billing_period, 'monthly');
  assert.ok(n.period_end);
});

test('cancel-at-period-end maps to a flag, not to a new state', () => {
  const n = P.normaliseEvent(evt('customer.subscription.updated',
    sub({ cancel_at_period_end: true }), { cancel_at_period_end: false }));
  assert.equal(n.type, 'subscription_cancelled');
  // And the reducer keeps access running to the period end.
  const out = B.applyBillingEvent(
    { user_id: 'u1', state: 'active', access_until: '2026-12-01T00:00:00Z' },
    Object.assign({}, n, { user_id: 'u1' }), new Date('2026-08-20T12:00:00Z'));
  assert.equal(out.applied, true);
  assert.equal(out.next.state, 'active', 'cancelled is not a state');
  assert.equal(out.next.cancel_at_period_end, true);
});

test('an undone cancellation resumes', () => {
  const n = P.normaliseEvent(evt('customer.subscription.updated',
    sub({ cancel_at_period_end: false }), { cancel_at_period_end: true }));
  assert.equal(n.type, 'subscription_resumed');
});

test('payment failure and recovery map to grace and back', () => {
  assert.equal(P.normaliseEvent(evt('customer.subscription.updated',
    sub({ status: 'past_due' }), { status: 'active' })).type, 'payment_failed');
  assert.equal(P.normaliseEvent(evt('invoice.payment_failed',
    { customer: 'cus_1', subscription: 'sub_1', metadata: { vvv_user_id: 'u1' } })).type, 'payment_failed');
  assert.equal(P.normaliseEvent(evt('customer.subscription.updated',
    sub({ status: 'active' }), { status: 'past_due' })).type, 'payment_recovered');
});

test('deletion, refund and dispute all end access without inventing a state', () => {
  for (const [type, obj] of [
    ['customer.subscription.deleted', sub({ status: 'canceled' })],
    ['charge.refunded', { customer: 'cus_1', metadata: { vvv_user_id: 'u1' } }],
    ['charge.dispute.created', { customer: 'cus_1', metadata: { vvv_user_id: 'u1' } }]
  ]) {
    const n = P.normaliseEvent(evt(type, obj));
    assert.equal(n.type, 'subscription_ended', type);
    assert.ok(B.EVENTS.indexOf(n.type) !== -1, 'must be one of OUR events');
  }
});

test('an irrelevant Stripe event produces nothing at all', () => {
  for (const type of ['customer.updated', 'payment_intent.created', 'invoice.created',
                      'customer.source.expiring', 'ping']) {
    assert.equal(P.normaliseEvent(evt(type, {})), null, type + ' must not move an entitlement');
  }
});

test('checkout completion is recorded but moves nothing on its own', () => {
  const n = P.normaliseEvent(evt('checkout.session.completed',
    { id: 'cs_1', customer: 'cus_1', subscription: 'sub_1', client_reference_id: 'u1',
      metadata: { vvv_user_id: 'u1', vvv_period: 'yearly' } }));
  assert.equal(n.type, null, 'the subscription object carries the authoritative dates');
  assert.equal(n.ledger_only, true);
  assert.equal(n.billing_period, 'yearly');
});

test('every event we emit is in the existing vocabulary', () => {
  // The whole point of the adapter: nothing Stripe-shaped reaches _billing.js.
  const all = [
    evt('customer.subscription.created', sub({ status: 'trialing' })),
    evt('customer.subscription.created', sub({ status: 'active' })),
    evt('customer.subscription.updated', sub({ cancel_at_period_end: true }), { cancel_at_period_end: false }),
    evt('customer.subscription.updated', sub({ status: 'past_due' }), { status: 'active' }),
    evt('customer.subscription.deleted', sub({ status: 'canceled' })),
    evt('invoice.payment_succeeded', { customer: 'cus_1', metadata: { vvv_user_id: 'u1' } })
  ];
  for (const e of all) {
    const n = P.normaliseEvent(e);
    if (n && n.type) assert.ok(B.EVENTS.indexOf(n.type) !== -1, e.type + ' -> ' + n.type);
  }
});

test('an event with no resolvable athlete is dropped', () => {
  assert.equal(P.normaliseEvent(evt('customer.subscription.created',
    sub({ metadata: {} }))), null, 'no user id means nothing to apply it to');
});

// ---------------------------------------------------------------------------
// SIGNATURES
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const signed = (body, secret, ts) => 't=' + ts + ',v1=' +
  crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex');

test('a valid Stripe signature verifies', () => {
  const body = '{"id":"evt_1"}';
  const now = 1780000000;
  assert.equal(P.verifySignature(body, signed(body, 'whsec_x', now), 'whsec_x', now).ok, true);
});

test('an unsigned, forged, stale or unconfigured request is refused', () => {
  const body = '{"id":"evt_1"}';
  const now = 1780000000;
  assert.equal(P.verifySignature(body, signed(body, 'whsec_x', now), '', now).reason, 'not_configured');
  assert.equal(P.verifySignature(body, '', 'whsec_x', now).reason, 'unsigned');
  assert.equal(P.verifySignature(body, 't=' + now + ',v1=deadbeef', 'whsec_x', now).reason, 'bad_signature');
  assert.equal(P.verifySignature(body, signed(body, 'whsec_other', now), 'whsec_x', now).reason, 'bad_signature');
  assert.equal(P.verifySignature(body, signed(body, 'whsec_x', now - 3600), 'whsec_x', now).reason, 'stale_timestamp');
  // A body edited after signing must not verify.
  assert.equal(P.verifySignature('{"id":"evt_2"}', signed(body, 'whsec_x', now), 'whsec_x', now).reason, 'bad_signature');
});

test('a rotating secret with several v1 signatures still verifies', () => {
  const body = '{"id":"evt_1"}';
  const now = 1780000000;
  const good = crypto.createHmac('sha256', 'whsec_new').update(now + '.' + body).digest('hex');
  const header = 't=' + now + ',v1=deadbeef,v1=' + good;
  assert.equal(P.verifySignature(body, header, 'whsec_new', now).ok, true);
});

// ---------------------------------------------------------------------------
// CONFIGURATION AND FAIL-CLOSED POSTURE
// ---------------------------------------------------------------------------
test('commerce is off unless a deployment says otherwise in so many words', () => {
  const saved = process.env.VVV_COMMERCE_ENABLED;
  try {
    delete process.env.VVV_COMMERCE_ENABLED;
    assert.equal(A.commerceEnabled(), false, 'unset must mean off');
    // 'TRUE ' is absent deliberately: flagOn trims, so it enables. That is the
    // existing convention for every flag and is correct.
    for (const v of ['', '0', 'false', 'no', 'off', 'maybe']) {
      process.env.VVV_COMMERCE_ENABLED = v;
      assert.equal(A.commerceEnabled(), false, JSON.stringify(v) + ' must not enable charging');
    }
    for (const v of ['1', 'true', 'on', 'yes', 'TRUE', 'TRUE ']) {
      process.env.VVV_COMMERCE_ENABLED = v;
      assert.equal(A.commerceEnabled(), true, v);
    }
  } finally {
    if (saved === undefined) delete process.env.VVV_COMMERCE_ENABLED;
    else process.env.VVV_COMMERCE_ENABLED = saved;
  }
});

test('a clean main with no Stripe credentials behaves', () => {
  const cfg = P.config({});
  assert.equal(cfg.hasSecret, false);
  assert.equal(cfg.hasWebhookSecret, false);
  assert.equal(cfg.isLiveKey, false);
  assert.equal(cfg.siteOrigin, 'https://velvetviking.co.uk', 'the .co.uk domain is the default, not a Vercel URL');
  assert.equal(decideCheckout(base({ stripeConfigured: false })).code, 'provider_not_configured');
});

test('a test key is not a live key, and neither implies consent to charge', () => {
  assert.equal(P.config({ STRIPE_SECRET_KEY: 'sk_test_1' }).isLiveKey, false);
  assert.equal(P.config({ STRIPE_SECRET_KEY: 'sk_live_1' }).isLiveKey, true);
});

// ---------------------------------------------------------------------------
// ACCESS PRECEDENCE — the beta athletes must not be disturbed
// ---------------------------------------------------------------------------
test('an override still outranks everything, including a dead subscription', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  const d = A.resolveAccess({
    uid: 'u1', accountRequired: true, commercialRequired: true, now: now,
    entitlement: { state: 'expired', access_until: '2026-01-01T00:00:00Z', override: 'beta' }
  });
  assert.equal(d.allow, true, 'a beta athlete whose card fails must not stop being a beta athlete');
  assert.match(d.reason, /override_beta/);
});

test('billingPatch still cannot touch an override', () => {
  const patch = B.billingPatch({
    user_id: 'u1', state: 'expired', access_until: null, override: 'owner', tier: 'standard'
  });
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'override'), false,
    'a webhook must never be able to revoke a comp');
});

// ---------------------------------------------------------------------------
// SECRETS
// ---------------------------------------------------------------------------
test('no Stripe secret can reach a browser', () => {
  // The runtime is one inline script served to the client; the account and
  // marketing pages are static. None may name a Stripe key or price variable.
  const client = ['protected/velvet-viking-valhalla.html', 'account.html', 'get.html', 'admin.html'];
  for (const f of client) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const forbidden of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
                             'sk_live_', 'sk_test_', 'whsec_',
                             'STRIPE_PRICE_STANDARD_MONTHLY', 'STRIPE_PRICE_STANDARD_YEARLY']) {
      assert.equal(src.indexOf(forbidden), -1, f + ' names ' + forbidden);
    }
  }
});

test('no secret is committed in the repository', () => {
  for (const f of ['api/_stripe.js', 'api/_commerce.js', 'api/_checkout.js', 'api/_ledger.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(/sk_live_[A-Za-z0-9]/.test(src), false, f);
    assert.equal(/whsec_[A-Za-z0-9]/.test(src), false, f);
    assert.equal(/price_[A-Za-z0-9]{10,}/.test(src), false, f + ' hardcodes a price id');
  }
});

test('the adapter never puts a caller-supplied amount on the wire', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/_stripe.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Checkout passes a price ID resolved from the environment. If these appear,
  // somebody has started letting a client name a sum of money.
  for (const forbidden of ['unit_amount', 'price_data', 'amount:']) {
    assert.equal(src.indexOf(forbidden), -1,
      '_stripe.js references ' + forbidden + ' — price must come from configuration');
  }
});

// ---------------------------------------------------------------------------
// PROVIDER NEUTRALITY
// ---------------------------------------------------------------------------
test('nothing outside the adapter learns that Stripe exists', () => {
  const neutral = ['api/_access.js', 'api/_billing.js', 'api/_subscription.js', 'api/_commerce.js'];
  for (const f of neutral) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    assert.equal(/\bstripe\b/i.test(code.replace(/STRIPE_PRICE_STANDARD_(MONTHLY|YEARLY)/g, '')), false,
      f + ' has learned a provider name — the access model must stay provider-neutral');
  }
});

test('the ledger admits Apple and Google without a redesign', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase-purchases.sql'), 'utf8');
  assert.match(sql, /provider in \('stripe','apple','google'\)/);
  assert.match(sql, /purchases_provider_sub_uniq/, 'one subscription, one account, all providers');
  assert.match(sql, /billing_events_provider_event_uniq/, 'idempotency is a constraint, not a read');
  // And no card data column can exist.
  for (const forbidden of ['card_number', 'pan', 'cvv', 'cvc', 'card_last4']) {
    assert.equal(sql.indexOf(forbidden), -1, 'schema names ' + forbidden);
  }
});
