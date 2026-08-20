'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../api/_stripe.js');
const Prod = require('../api/_products.js');
const Checkout = require('../api/_checkout.js');

// STRIPE, AS THE WEB RAIL OF THE CANONICAL COMMERCIAL MODEL.
//
// Stripe is not a provider in this system. `web` is the provider -- the
// commercial rail an athlete arrived on -- and Stripe is the processor beneath
// it. That distinction is the whole point of these tests: if Stripe ever
// becomes a peer of `apple` in the data, every comparison between rails needs a
// translation, and the translations will drift.

const ROOT = path.join(__dirname, '..');
const PRICES = {
  VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_1Monthly',
  VVV_PRICE_WEB_STANDARD_YEARLY:  'price_1Yearly'
};

// ---------------------------------------------------------------------------
// PROVIDER VOCABULARY
// ---------------------------------------------------------------------------
test('the provider is web, and stripe is never a provider value', () => {
  assert.equal(P.PROVIDER, 'web');
  assert.ok(Prod.isProvider('web'));
  assert.equal(Prod.isProvider('stripe'), false,
    'stripe must not be a provider: it is the processor beneath the web rail');
});

test('no commercial module writes the string stripe as a provider', () => {
  for (const f of ['api/_stripe.js', 'api/_checkout.js', 'api/billing-webhook.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    assert.equal(/provider\s*[:=]\s*['"]stripe['"]/.test(src), false,
      f + ' assigns stripe as a provider value');
  }
});

// ---------------------------------------------------------------------------
// PRICE RESOLUTION — one convention, the catalogue's
// ---------------------------------------------------------------------------
test('prices resolve through the canonical catalogue convention', () => {
  assert.equal(Prod.providerRefEnvName('web', 'STANDARD_MONTHLY'), 'VVV_PRICE_WEB_STANDARD_MONTHLY');
  const r = P.priceFor('STANDARD_YEARLY', PRICES);
  assert.equal(r.ok, true);
  assert.equal(r.priceId, 'price_1Yearly');
  assert.equal(r.offer.code, 'STANDARD_YEARLY');
});

test('an unset or malformed price refuses rather than defaulting', () => {
  assert.equal(P.priceFor('STANDARD_MONTHLY', {}).code, 'price_not_configured');
  assert.equal(P.priceFor('NOT_AN_OFFER', PRICES).code, 'unknown_offer');
  // A product id or a dashboard URL pasted into the variable is the commonest
  // configuration mistake, and it must fail here rather than at Stripe.
  for (const bad of ['prod_123', 'https://dashboard.stripe.com/prices/price_1', 'price 1', '']) {
    const r = P.priceFor('STANDARD_MONTHLY', { VVV_PRICE_WEB_STANDARD_MONTHLY: bad });
    assert.equal(r.ok, false, JSON.stringify(bad) + ' must not be accepted');
  }
});

test('the offering is defined once, in the catalogue', () => {
  const monthly = Prod.offerForPeriod('monthly');
  const yearly = Prod.offerForPeriod('yearly');
  assert.equal(monthly.priceMinor, 1199);
  assert.equal(yearly.priceMinor, 8999);
  assert.equal(monthly.trialDays, 14);
  assert.equal(yearly.trialDays, 14);
  // And no commercial module keeps a second copy of those numbers.
  for (const f of ['api/_stripe.js', 'api/_checkout.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(/1199|8999/.test(src), false, f + ' restates a price');
  }
});

// ---------------------------------------------------------------------------
// CHECKOUT
// ---------------------------------------------------------------------------
const allow = { allowed: true };
test('checkout is refused while commerce is disabled', () => {
  const d = Checkout.decideCheckout({ commerceEnabled: false, stripeConfigured: true, uid: 'u1', period: 'monthly', purchaseCheck: allow });
  assert.equal(d.ok, false);
  assert.equal(d.code, 'commerce_disabled');
  assert.equal(d.status, 503);
});

test('a live key without the commercial flag is refused', () => {
  // A credential existing is not consent to charge anybody.
  const d = Checkout.decideCheckout({ commerceEnabled: true, isLiveKey: true, commercialRequired: false, stripeConfigured: true, uid: 'u1', period: 'monthly', purchaseCheck: allow });
  assert.equal(d.code, 'live_key_without_commercial_flag');
});

test('only the two approved periods are accepted', () => {
  const base = { commerceEnabled: true, stripeConfigured: true, uid: 'u1', purchaseCheck: allow };
  assert.equal(Checkout.decideCheckout(Object.assign({ period: 'monthly' }, base)).offerCode, 'STANDARD_MONTHLY');
  assert.equal(Checkout.decideCheckout(Object.assign({ period: 'yearly' }, base)).offerCode, 'STANDARD_YEARLY');
  for (const bad of ['weekly', 'MONTHLY', '', null, 'monthly ', 1, {}]) {
    const d = Checkout.decideCheckout(Object.assign({ period: bad }, base));
    assert.equal(d.ok, false, JSON.stringify(bad) + ' must be refused');
    assert.equal(d.code, 'unknown_billing_period');
  }
});

test('an unauthenticated caller cannot start a checkout', () => {
  const d = Checkout.decideCheckout({ commerceEnabled: true, stripeConfigured: true, uid: null, period: 'monthly', purchaseCheck: allow });
  assert.equal(d.code, 'not_signed_in');
  assert.equal(d.status, 401);
});

test('the canonical purchase rule decides, not a second opinion here', () => {
  const base = { commerceEnabled: true, stripeConfigured: true, uid: 'u1', period: 'monthly' };
  for (const [check, code] of [
    [{ allowed: false, reason: 'already_subscribed', existingProvider: 'apple' }, 'already_subscribed'],
    [{ allowed: false, reason: 'admin_grant_active' }, 'admin_grant_active'],
    [{ allowed: false, reason: 'unavailable' }, 'unavailable'],
    [null, 'purchase_not_permitted']
  ]) {
    const d = Checkout.decideCheckout(Object.assign({ purchaseCheck: check }, base));
    assert.equal(d.ok, false);
    assert.equal(d.code, code);
  }
  // An Apple subscriber is told which rail holds it, so support does not guess.
  const d = Checkout.decideCheckout(Object.assign({ purchaseCheck: { allowed: false, reason: 'already_subscribed', existingProvider: 'apple' } }, base));
  assert.equal(d.existingProvider, 'apple');
});

test('the request body may name a period and nothing else', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/_checkout.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  const reads = src.match(/body\s*&&\s*body\.[A-Za-z_]+|body\.[A-Za-z_]+/g) || [];
  const fields = Array.from(new Set(reads.map((m) => m.split('.').pop())));
  assert.deepEqual(fields.sort(), ['period'],
    'the body may name a period and nothing else, got: ' + fields.join(','));
});

// ---------------------------------------------------------------------------
// CHECKOUT SESSION — trial and redirects
// ---------------------------------------------------------------------------
async function sessionBody(over) {
  const cfg = P.config(Object.assign({
    STRIPE_SECRET_KEY: 'sk_test_1', VVV_SITE_ORIGIN: 'https://app.velvetviking.co.uk'
  }, over || {}));
  let sent = null;
  const r = await P.createCheckoutSession(cfg, {
    uid: 'u1', accountId: 'acc-1', customerId: 'cus_1', offerCode: 'STANDARD_MONTHLY', env: PRICES
  }, { fetch: async (u, i) => { sent = decodeURIComponent(String(i.body)); return { ok: true, text: async () => JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/x' }) }; } });
  return { sent, r, cfg };
}

test('the trial is set on the session, for both periods, never on the Price', async () => {
  for (const offerCode of ['STANDARD_MONTHLY', 'STANDARD_YEARLY']) {
    const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_1', VVV_SITE_ORIGIN: 'https://app.test' });
    let sent = null;
    await P.createCheckoutSession(cfg, { uid: 'u1', accountId: 'a', customerId: 'c', offerCode, env: PRICES }, {
      fetch: async (u, i) => { sent = decodeURIComponent(String(i.body)); return { ok: true, text: async () => JSON.stringify({ id: 'cs', url: 'u' }) }; }
    });
    assert.ok(sent.indexOf('subscription_data[trial_period_days]=14') !== -1, offerCode + ': ' + sent);
  }
});

test('success returns to the backend and cancel to the marketing site', async () => {
  const { sent } = await sessionBody({ VVV_MARKETING_ORIGIN: 'https://velvetviking.co.uk' });
  assert.ok(sent.indexOf('success_url=https://app.velvetviking.co.uk/account') !== -1, sent);
  assert.ok(sent.indexOf('cancel_url=https://velvetviking.co.uk/pricing') !== -1, sent);
});

test('checkout refuses rather than guessing the backend origin', async () => {
  const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_1' });
  const r = await P.createCheckoutSession(cfg, { uid: 'u1', accountId: 'a', customerId: 'c', offerCode: 'STANDARD_MONTHLY', env: PRICES }, {});
  assert.equal(r.code, 'app_origin_not_configured');
});

test('the session carries what a webhook needs to reconstruct the purchase', async () => {
  const { sent } = await sessionBody();
  // A webhook may arrive before, after, or instead of the browser returning.
  for (const k of ['vvv_account_id]=acc-1', 'vvv_offer]=STANDARD_MONTHLY', 'vvv_period]=monthly']) {
    assert.ok(sent.indexOf(k) !== -1, 'missing ' + k + ' in ' + sent);
  }
});

// ---------------------------------------------------------------------------
// SIGNATURE
// ---------------------------------------------------------------------------
const crypto = require('crypto');
function signed(body, secret, ts) {
  const sig = crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex');
  return 't=' + ts + ',v1=' + sig;
}

test('an unsigned, missigned or stale event cannot be accepted', () => {
  const body = '{"id":"evt_1"}';
  const now = 1780000000;
  assert.equal(P.verifySignature(body, signed(body, 'whsec', now), 'whsec', now).ok, true);
  assert.equal(P.verifySignature(body, '', 'whsec', now).reason, 'unsigned');
  assert.equal(P.verifySignature(body, signed(body, 'wrong', now), 'whsec', now).reason, 'bad_signature');
  assert.equal(P.verifySignature(body, signed(body, 'whsec', now - 3600), 'whsec', now).reason, 'stale_timestamp');
  assert.equal(P.verifySignature(body, signed(body, 'whsec', now), '', now).reason, 'not_configured');
  // A tampered body invalidates a signature computed over the original.
  assert.equal(P.verifySignature('{"id":"evt_2"}', signed(body, 'whsec', now), 'whsec', now).reason, 'bad_signature');
});

test('a rotating secret is honoured when several v1 signatures are sent', () => {
  const body = '{"id":"evt_1"}', now = 1780000000;
  const good = crypto.createHmac('sha256', 'new').update(now + '.' + body).digest('hex');
  const header = 't=' + now + ',v1=' + 'a'.repeat(64) + ',v1=' + good;
  assert.equal(P.verifySignature(body, header, 'new', now).ok, true);
});

// ---------------------------------------------------------------------------
// EVENT TRANSLATION — facts, not verbs
// ---------------------------------------------------------------------------
const evt = (type, obj, created) => ({ id: 'evt_1', type, created: created || 1780000000, data: { object: obj } });
const sub = (over) => Object.assign({
  id: 'sub_1', customer: 'cus_1',
  metadata: { vvv_account_id: 'acc-1', vvv_offer: 'STANDARD_MONTHLY', vvv_period: 'monthly' },
  current_period_end: 1790000000
}, over || {});

test('subscription status maps to a canonical condition', () => {
  const cases = [['trialing', 'trialing'], ['active', 'active'], ['past_due', 'past_due'],
                 ['unpaid', 'past_due'], ['canceled', 'expired'], ['incomplete_expired', 'expired']];
  for (const [status, condition] of cases) {
    const n = P.normaliseEvent(evt('customer.subscription.updated', sub({ status })));
    assert.equal(n.condition, condition, status + ' -> ' + condition);
  }
});

test('an unrecognised status is refused, never guessed', () => {
  // Guessing here would be guessing whether somebody may use the product.
  for (const status of ['zzz', '', null, 'trialling']) {
    assert.equal(P.normaliseEvent(evt('customer.subscription.updated', sub({ status }))), null, String(status));
  }
});

test('a deleted subscription is expired even if the status lags', () => {
  const n = P.normaliseEvent(evt('customer.subscription.deleted', sub({ status: 'active' })));
  assert.equal(n.condition, 'expired');
});

test('cancellation at period end is a flag, not a condition', () => {
  // The subscription is still active; access runs to the period end. Expressing
  // this as a state would create a state that can contradict the timestamp.
  const n = P.normaliseEvent(evt('customer.subscription.updated', sub({ status: 'active', cancel_at_period_end: true })));
  assert.equal(n.condition, 'active');
  assert.equal(n.cancel_at_period_end, true);
});

test('events carrying no subscription are ignored', () => {
  for (const t of ['invoice.payment_failed', 'charge.refunded', 'customer.updated', 'ping']) {
    assert.equal(P.normaliseEvent(evt(t, { customer: 'cus_1' })), null, t);
  }
});

test('the offer is recovered from metadata, or from the price interval', () => {
  const fromMeta = P.normaliseEvent(evt('customer.subscription.updated', sub({ status: 'active' })));
  assert.equal(fromMeta.offer_code, 'STANDARD_MONTHLY');
  // A subscription created outside our checkout still classifies.
  const bare = { id: 'sub_2', customer: 'cus_2', status: 'active', metadata: { vvv_account_id: 'acc-2' },
                 items: { data: [{ price: { recurring: { interval: 'year' } } }] } };
  const fromPrice = P.normaliseEvent(evt('customer.subscription.updated', bare));
  assert.equal(fromPrice.offer_code, 'STANDARD_YEARLY');
  assert.equal(fromPrice.billing_period, 'yearly');
});

test('an event carrying no account is not attributable', () => {
  const n = P.normaliseEvent(evt('customer.subscription.updated', { id: 'sub_3', status: 'active', metadata: {} }));
  assert.equal(n.account_id, null, 'the webhook must refuse this rather than attach it to someone');
});

test('the event is translated to facts, never to a verb', () => {
  // The old design emitted trial_started / payment_failed and let a reducer
  // move a second state machine. Two state machines can disagree after a
  // reordered delivery; one set of facts cannot.
  const n = P.normaliseEvent(evt('customer.subscription.updated', sub({ status: 'active' })));
  for (const verb of ['trial_started', 'subscription_renewed', 'payment_failed', 'subscription_ended']) {
    assert.equal(JSON.stringify(n).indexOf(verb), -1, 'still emitting a verb: ' + verb);
  }
  assert.ok(n.condition && n.subscription_ref && n.provider_event_id);
});

// ---------------------------------------------------------------------------
// SECRETS
// ---------------------------------------------------------------------------
test('no Stripe secret can reach a browser', () => {
  const clientFiles = ['account.html', 'get.html', 'admin.html', 'privacy.html', 'terms.html'];
  for (const f of clientFiles) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    assert.equal(/STRIPE_|sk_live|sk_test|whsec_/.test(src), false, f + ' references a Stripe secret');
  }
  const runtime = fs.readFileSync(path.join(ROOT, 'protected/velvet-viking-valhalla.html'), 'utf8');
  assert.equal(/STRIPE_|sk_live|whsec_/.test(runtime), false, 'the app runtime references a Stripe secret');
});

test('secrets are getters, so a stringify cannot serialise one', () => {
  /* Canaries that are deliberately NOT credential-shaped. The repository has a
     scanner that fails the build on anything resembling a real key, and a test
     fixture that trips it teaches people to silence the scanner. */
  const cfg = P.config({ STRIPE_SECRET_KEY: 'canary-secret-must-not-serialise',
                         STRIPE_WEBHOOK_SECRET: 'canary-webhook-must-not-serialise' });
  const blob = JSON.stringify(cfg);
  assert.equal(blob.indexOf('canary-secret-must-not-serialise'), -1);
  assert.equal(blob.indexOf('canary-webhook-must-not-serialise'), -1);
  assert.equal(cfg.hasSecret, true);
});

test('a Stripe error is reduced to a code, never echoed', async () => {
  const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_1' });
  const r = await P.call(cfg, 'POST', '/x', {}, {
    fetch: async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { code: 'resource_missing', message: 'No such price: price_secret', param: 'line_items[0][price]' } }) })
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'stripe_resource_missing');
  assert.equal(JSON.stringify(r).indexOf('price_secret'), -1, 'a Stripe message echoes the request');
});

test('the environment is derived from the key, so sandbox is never production', () => {
  assert.equal(P.config({ STRIPE_SECRET_KEY: 'sk_test_1' }).environment, 'sandbox');
  assert.equal(P.config({ STRIPE_SECRET_KEY: 'sk_live_1' }).environment, 'production');
  assert.ok(Prod.isEnvironment('sandbox') && Prod.isEnvironment('production'));
});
