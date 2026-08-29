'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Ck = require('../api/_checkout.js');
const A = require('../api/_access.js');
const E = require('../api/_entitlement.js');
const Prod = require('../api/_products.js');

/* UNITED KINGDOM ONLY — THE COMMERCIAL BOUNDARY FOR THIS LAUNCH
 * ===========================================================================
 * WHY THE GATE IS WHERE IT IS, because the obvious place does not work.
 *
 * A Stripe Checkout Session cannot be restricted by billing country. There is
 * no allowed_countries for billing -- that parameter exists only under
 * shipping_address_collection, and this is a digital subscription with nothing
 * to ship. Borrowing the shipping dropdown to get a country picker would put a
 * fictional address on every customer record to enforce something it does not
 * mean, and would still not bind the billing address.
 *
 * So the refusal happens BEFORE a session is created, from the platform's own
 * edge-derived country header, which no caller can set. A refusal here leaves
 * nothing behind to tamper with, because nothing was made.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM. It is a location gate, not a
 * payment-instrument gate: a VPN presents a UK address, and a UK athlete may
 * hold a foreign card. Closing that needs a Stripe Radar rule on the card's
 * issuing country, which is dashboard configuration. The tests below assert
 * what the code actually does and no more.
 */

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const NOW = new Date('2026-09-01T09:00:00Z');
const UID = 'a1111111-1111-1111-1111-111111111111';

/* Everything a purchase needs, in order, so a refusal below is unambiguously
   the country and not something else that happens to also be missing. */
const ok = (over) => Object.assign({
  commerceEnabled: true,
  commercialRequired: true,
  stripeConfigured: true,
  isLiveKey: true,
  uid: UID,
  country: 'GB',
  period: 'monthly',
  purchaseCheck: { allowed: true, reason: 'ok' },
  /* The real shape purchaseEvidence() returns: the gate keys on `ok`, and the
     individual flags are only what a screen renders. A fixture that set the
     flags without `ok` refused as agreements_not_recorded -- correctly, which
     is why it is worth getting right rather than working around. */
  evidence: { ok: true, terms: true, immediateStart: true, published: true },
  now: NOW
}, over || {});

// ---------------------------------------------------------------------------
// 1. THE GATE ITSELF
// ---------------------------------------------------------------------------

test('a UK athlete can still buy, monthly and yearly', () => {
  ['monthly', 'yearly'].forEach((period) => {
    const d = Ck.decideCheckout(ok({ period }));
    assert.equal(d.ok, true, 'a UK purchase was refused: ' + period + ' -> ' + d.code);
    assert.equal(d.period, period);
    assert.equal(d.offerCode, period === 'monthly' ? 'STANDARD_MONTHLY' : 'STANDARD_YEARLY');
  });
});

test('a non-UK athlete cannot complete a purchase', () => {
  ['US', 'IE', 'FR', 'DE', 'AU', 'NZ', 'ES', 'CA'].forEach((country) => {
    const d = Ck.decideCheckout(ok({ country }));
    assert.equal(d.ok, false, country + ' was allowed to purchase');
    assert.equal(d.code, 'country_not_supported');
    assert.equal(d.status, 403);
  });
});

test('an unknown country fails CLOSED, and says which fault it is', () => {
  /* A deployment that stops supplying the header must never quietly become
     "sell to everybody", and it must be diagnosable as a deployment fault
     rather than looking like a customer in the wrong country. */
  [null, undefined, '', '   '].forEach((country) => {
    const d = Ck.decideCheckout(ok({ country }));
    assert.equal(d.ok, false, JSON.stringify(country) + ' was allowed to purchase');
    assert.equal(d.code, 'country_unavailable');
    assert.equal(d.status, 503);
  });
});

test('the supported set is exactly the United Kingdom', () => {
  assert.deepEqual(Ck.SUPPORTED_COUNTRIES, ['GB']);
  assert.equal(Ck.countrySupported('GB'), true);
  assert.equal(Ck.countrySupported('gb'), true, 'a lowercase header must still be the UK');
  ['UK', 'GBR', 'G', '', null, undefined, 'US'].forEach((v) =>
    assert.equal(Ck.countrySupported(v), false, JSON.stringify(v) + ' was treated as the UK'));
});

// ---------------------------------------------------------------------------
// 2. IT CANNOT BE BYPASSED BY ANYTHING A CALLER SENDS
// ---------------------------------------------------------------------------

test('the country is read from the platform header and from nowhere else', () => {
  /* THE WHOLE SECURITY ARGUMENT. A body field or query parameter named
     `country` would be exactly the bypass this exists to prevent, so the
     reader takes a request and looks at one header. */
  assert.equal(Ck.countryOf({ headers: { 'x-vercel-ip-country': 'GB' } }), 'GB');
  assert.equal(Ck.countryOf({ headers: { 'x-vercel-ip-country': 'gb' } }), 'GB');
  assert.equal(Ck.countryOf({ headers: {} }), null);
  assert.equal(Ck.countryOf({}), null);
  /* Nothing the caller controls contributes. */
  assert.equal(Ck.countryOf({ headers: {}, body: { country: 'GB' } }), null,
    'a body field set the country');
  assert.equal(Ck.countryOf({ headers: {}, query: { country: 'GB' } }), null,
    'a query parameter set the country');
  const src = code(read('api/_checkout.js'));
  const fn = src.slice(src.indexOf('function countryOf'), src.indexOf('function countrySupported'));
  assert.ok(!/body/.test(fn), 'countryOf() reads the request body');
  assert.ok(!/query/.test(fn), 'countryOf() reads the query string');
});

test('the handler passes the header value, never the body', () => {
  const src = code(read('api/_checkout.js'));
  assert.match(src, /country:\s*countryOf\(req\)/,
    'the decision is not fed from the platform header');
  assert.ok(!/country:\s*\(?body/.test(src), 'the decision is fed from the request body');
});

test('a forged period or price still cannot pick what is charged', () => {
  /* Unchanged by this pass, asserted because a country gate that let a price
     through would be a strange trade. */
  ['price_1Abc', 'weekly', 'MONTHLY', '', null, 0].forEach((period) => {
    const d = Ck.decideCheckout(ok({ period }));
    assert.equal(d.ok, false, JSON.stringify(period) + ' resolved to an offer');
    assert.equal(d.code, 'unknown_billing_period');
  });
  assert.ok(!/price_[A-Za-z0-9]{6,}/.test(read('api/_checkout.js')),
    'a provider price id is hard-coded in the checkout path');
});

test('the country gate runs before eligibility, agreements and the offer', () => {
  /* Recording an agreement acceptance for a purchase that was never going to
     be permitted would put a misleading row in the one table whose value is
     that it is accurate. */
  const d = Ck.decideCheckout(ok({ country: 'US', period: 'nonsense',
    purchaseCheck: { allowed: false, reason: 'already_subscribed' },
    evidence: { ok: false, terms: false, immediateStart: false, published: true } }));
  assert.equal(d.code, 'country_not_supported', 'another refusal answered first');
});

// ---------------------------------------------------------------------------
// 3. NOTHING ELSE MOVED
// ---------------------------------------------------------------------------

test('the existing production safety gates still answer first', () => {
  /* Commerce off, and an uncommissioned live key, are configuration faults and
     outrank a customer's location -- they were here before this pass and must
     keep their order. */
  assert.equal(Ck.decideCheckout(ok({ commerceEnabled: false, country: 'GB' })).code,
    'commerce_disabled');
  assert.equal(Ck.decideCheckout(ok({ isLiveKey: true, commercialRequired: false })).code,
    'live_key_without_commercial_flag');
  assert.equal(Ck.decideCheckout(ok({ stripeConfigured: false })).code, 'provider_not_configured');
  assert.equal(Ck.decideCheckout(ok({ uid: null })).code, 'not_signed_in');
});

test('the prices and the trial are exactly what was approved', () => {
  const m = Prod.offer('STANDARD_MONTHLY');
  const y = Prod.offer('STANDARD_YEARLY');
  assert.equal(m.priceMinor, 1199);
  assert.equal(y.priceMinor, 8999);
  assert.equal(m.currency, 'GBP');
  assert.equal(y.currency, 'GBP');
  assert.equal(m.trialDays, 14);
  assert.equal(y.trialDays, 14);
  /* And the server still resolves the period itself. */
  assert.equal(Prod.offerForPeriod('monthly').code, 'STANDARD_MONTHLY');
  assert.equal(Prod.offerForPeriod('yearly').code, 'STANDARD_YEARLY');
});

test('the trial is not something this change could have moved', () => {
  const src = code(read('api/_stripe.js'));
  assert.match(src, /trial_period_days:\s*price\.offer\.trialDays/,
    'the trial length is no longer read from the catalogue');
  assert.match(src, /payment_method_collection:\s*'always'/);
});

// ---------------------------------------------------------------------------
// 4. ACCESS IS UNTOUCHED — THIS GATE IS ABOUT BUYING, NOT ABOUT ENTERING
// ---------------------------------------------------------------------------

const LIVE = { accountRequired: true, commercialRequired: true };
const row = (o) => Object.assign({ state: 'expired', tier: 'standard', access_until: null,
  cancel_at_period_end: false, override: null, override_expires_at: null }, o || {});
const decide = (ent) => A.resolveAccess(Object.assign({ now: NOW, uid: UID, entitlement: ent }, LIVE));

test('owner access is permanent and has nothing to do with a country', () => {
  assert.equal(decide(row({ override: 'owner' })).allow, true);
  assert.equal(decide(row({ override: 'owner' })).reason, 'override_owner');
  /* The gate lives in the purchase path; the access path never reads a
     country, and this asserts it rather than assuming it. */
  ['api/_access.js', 'api/app.js'].forEach((f) => {
    assert.ok(!/vercel-ip-country/i.test(read(f)), f + ' now reads a country to decide access');
  });
});

test('the grandfathered complimentary cohort is unaffected', () => {
  /* The production rows, exactly as they stand: state expired, no commercial
     window, open-ended promo override. They are admitted by the override and
     never reach checkout at all. */
  const d = decide(row({ override: 'promo' }));
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'override_promo');
  assert.deepEqual(A.ACCESS_OVERRIDES.slice().sort(), ['owner', 'promo']);
  /* And the complimentary grant still resolves. */
  assert.equal(E.grantAccess({ id: 'g', account_id: UID, source: 'admin_comp',
    product_code: Prod.STANDARD, expires_at: null, revoked_at: null }, NOW).active, true);
});

test('an ordinary unentitled athlete is still gated, wherever they are', () => {
  assert.equal(decide(null).allow, false);
  assert.equal(decide(null).reason, 'no_entitlement');
});

test('beta is still retired and the allowlist still grants nothing', () => {
  assert.equal(E.grantAccess({ id: 'g', account_id: UID, source: 'admin_beta',
    product_code: Prod.STANDARD, expires_at: null, revoked_at: null }, NOW).active, false);
  assert.equal(decide(row({ override: 'beta' })).allow, false);
  assert.ok(!/beta_allowlist/.test(code(read('api/_checkout.js'))));
});

test('the webhook and portal were not touched by a purchase-country change', () => {
  ['api/billing-webhook.js', 'api/_billing-apply.js', 'api/_portal.js', 'api/_subscription.js']
    .forEach((f) => assert.ok(!/vercel-ip-country|SUPPORTED_COUNTRIES/.test(read(f)),
      f + ' gained country logic; entitlement semantics must not depend on location'));
});
