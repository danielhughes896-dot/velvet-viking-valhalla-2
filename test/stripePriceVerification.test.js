'use strict';

// ===========================================================================
// THE PRICE STRIPE HOLDS IS THE PRICE WE ADVERTISED
//
// WHAT THIS FILE IS ABOUT. api/_products.js knows what SACORO sells: 1199 a
// month and 7999 a year, in GBP. Stripe knows what it will charge. Between the
// two sits a price id in an environment variable, set by hand, in a dashboard,
// at a different time by a different person — and nothing in the code can read
// it. priceFor() checks that the variable is SET and SHAPED like a price id.
// Neither of those tells you what Stripe will take off a card.
//
// THE FAILURE THIS WAS WRITTEN FOR IS REAL AND WAS LIVE. The account carried an
// active £89.99 annual price beside the £79.99 one that replaced it, both on
// the same product. A variable still naming the old one would have charged
// £89.99 while the site advertised £79.99, and every check that existed would
// have passed: the id was configured, well formed, active, and belonged to the
// right product. Only the amount was wrong, and nothing looked at the amount.
//
// AND THE LEDGER WOULD HAVE AGREED WITH THE SITE, NOT THE CARD. agreed_price_
// minor used to be read from the catalogue alone, so the row would have
// asserted the athlete agreed to 7999 while their card was debited 8999 — a
// confident false record, and the one an operator reaches for in a dispute.
// The last test here is about that, and it matters as much as the refusals.
//
// EVERY PRICE BELOW IS BUILT FROM THE CATALOGUE, never from a copied literal.
// A test that hard-codes 7999 passes when the catalogue changes and the code
// does not, which is the bug wearing a disguise.
// ===========================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'api', '_stripe.js'));
const Prod = require(path.join(ROOT, 'api', '_products.js'));

const KEY = 'sk_test_verification';
const ACC = 'acc_1';
const PRODUCT = 'prod_sacoro_standard';
const PRICE_ID = { STANDARD_MONTHLY: 'price_m1', STANDARD_YEARLY: 'price_y1' };
const ENV_NAME = {
  STANDARD_MONTHLY: 'VVV_PRICE_WEB_STANDARD_MONTHLY',
  STANDARD_YEARLY: 'VVV_PRICE_WEB_STANDARD_YEARLY'
};

/* The Price Stripe would return for an offer if everything were right. Derived
   from the catalogue, so these tests cannot drift from the thing they guard. */
function priceFor(offerCode, over){
  const o = Prod.offer(offerCode);
  return Object.assign({
    id: PRICE_ID[offerCode],
    object: 'price',
    active: true,
    type: 'recurring',
    currency: String(o.currency).toLowerCase(),
    unit_amount: o.priceMinor,
    recurring: { interval: o.billingPeriod === 'yearly' ? 'year' : 'month', interval_count: 1 },
    product: PRODUCT
  }, over || {});
}

/* Runs a checkout against a fake Stripe and reports BOTH the result and every
   request made. The request list is how the "no payment proceeds" assertions
   are made: refusing with the right code while still creating a Session would
   satisfy a result-only check and leave an athlete looking at a payment page. */
function checkout(offerCode, opts){
  const o = opts || {};
  const env = {};
  env[ENV_NAME[offerCode]] = o.priceId || PRICE_ID[offerCode];
  if (o.expectedProduct) env.VVV_STRIPE_PRODUCT_WEB = o.expectedProduct;

  const cfg = P.config(Object.assign({
    STRIPE_SECRET_KEY: KEY,
    VVV_SITE_ORIGIN: 'https://app.test',
    VVV_MARKETING_ORIGIN: 'https://site.test'
  }, env));

  const requests = [];
  const fetchFn = async function(url, init){
    const u = String(url);
    const method = (init && init.method) || 'GET';
    requests.push({ url: u, method: method });

    if (/\/prices\//.test(u)){
      if (o.priceHttp){
        return { ok: false, status: o.priceHttp.status,
                 text: async () => JSON.stringify({ error: { code: o.priceHttp.code } }) };
      }
      if (o.priceMissing){
        return { ok: false, status: 404,
                 text: async () => JSON.stringify({ error: { code: 'resource_missing' } }) };
      }
      return { ok: true, status: 200,
               text: async () => JSON.stringify(priceFor(offerCode, o.price)) };
    }
    return { ok: true, status: 200,
             text: async () => JSON.stringify({ id: 'cs_1', url: 'https://checkout.test/cs_1' }) };
  };

  return P.createCheckoutSession(cfg, {
    offerCode: offerCode, uid: ACC, accountId: ACC, customerId: 'cus_1', env: env
  }, { fetch: fetchFn }).then(function(r){
    return {
      r: r,
      requests: requests,
      sessionCreated: requests.some(function(q){
        return /\/checkout\/sessions$/.test(q.url) && q.method === 'POST';
      })
    };
  });
}

/* The assertion every refusal shares. Stated once so a new case cannot be
   added that checks the code and forgets the session. */
function assertRefused(out, code){
  assert.equal(out.r.ok, false, 'checkout must refuse');
  assert.equal(out.r.code, code, 'refusal must say ' + code + ', not ' + out.r.code);
  assert.equal(out.sessionCreated, false,
    'NO PAYMENT MAY PROCEED: a Checkout Session was created despite ' + code);
}

// ---------------------------------------------------------------------------
// 1. THE HAPPY PATH, SO THE REFUSALS BELOW MEAN SOMETHING
// ---------------------------------------------------------------------------

test('a price that matches the catalogue is verified, and checkout proceeds', async () => {
  for (const offerCode of ['STANDARD_MONTHLY', 'STANDARD_YEARLY']){
    const out = await checkout(offerCode);
    assert.equal(out.r.ok, true, offerCode + ' must be accepted');
    assert.equal(out.sessionCreated, true, offerCode + ' must reach session creation');
    /* The verified amount is reported back, and it is the catalogue's — which
       is the point: the same number, established rather than assumed. */
    assert.equal(out.r.verifiedAmountMinor, Prod.offer(offerCode).priceMinor);
    assert.equal(out.r.verifiedCurrency, 'GBP');
  }
});

test('the price is fetched BEFORE the session is created, not after', async () => {
  const out = await checkout('STANDARD_YEARLY');
  const priceAt = out.requests.findIndex(q => /\/prices\//.test(q.url));
  const sessionAt = out.requests.findIndex(q => /\/checkout\/sessions$/.test(q.url) && q.method === 'POST');
  assert.ok(priceAt !== -1, 'the price must actually be fetched');
  assert.ok(sessionAt !== -1, 'the session must still be created on the happy path');
  /* Order is the whole mitigation. Verifying after creation would leave an
     athlete holding a payment page for an amount we then decided was wrong. */
  assert.ok(priceAt < sessionAt, 'verification must happen before the session exists');
});

// ---------------------------------------------------------------------------
// 2. THE £89.99 THAT WAS ACTUALLY SITTING IN THE ACCOUNT
// ---------------------------------------------------------------------------

test('the superseded £89.99 annual price is refused, and nothing is charged', async () => {
  /* The exact live hazard: an active, well-formed, correctly-shaped price on
     the right product, for last month's amount. Everything about it is right
     except the number, which is the only thing that reaches the card. */
  const out = await checkout('STANDARD_YEARLY', { price: { unit_amount: 8999 } });
  assertRefused(out, 'price_amount_mismatch');
});

test('a price cheaper than advertised is refused too, not quietly allowed', async () => {
  /* UNDERCHARGING IS ALSO A MISMATCH, and the temptation is to wave it through
     because nobody complains about paying less. They complain about the
     renewal, and the ledger is wrong either way. */
  const out = await checkout('STANDARD_YEARLY', { price: { unit_amount: 1 } });
  assertRefused(out, 'price_amount_mismatch');
});

test('the monthly price is held to the monthly amount', async () => {
  const yearly = Prod.offer('STANDARD_YEARLY').priceMinor;
  const out = await checkout('STANDARD_MONTHLY', { price: { unit_amount: yearly } });
  assertRefused(out, 'price_amount_mismatch');
});

// ---------------------------------------------------------------------------
// 3. CURRENCY
// ---------------------------------------------------------------------------

test('a price in the wrong currency is refused', async () => {
  const out = await checkout('STANDARD_MONTHLY', { price: { currency: 'usd' } });
  assertRefused(out, 'price_currency_mismatch');
});

test('currency comparison ignores case, because Stripe lowercases and we do not', async () => {
  /* Stripe returns 'gbp'; the catalogue says 'GBP'. A strict comparison would
     refuse every correct price, which is the kind of guard that gets deleted
     in a hurry rather than fixed. */
  const out = await checkout('STANDARD_MONTHLY', { price: { currency: 'GBP' } });
  assert.equal(out.r.ok, true);
  assert.equal(out.sessionCreated, true);
});

// ---------------------------------------------------------------------------
// 4. BILLING INTERVAL
// ---------------------------------------------------------------------------

test('a monthly-interval price configured as the yearly offer is refused', async () => {
  /* The amount could be right and the subscription still wrong: £79.99 every
     month is not the annual plan, it is twelve times the price of one. */
  const out = await checkout('STANDARD_YEARLY', { price: { recurring: { interval: 'month', interval_count: 1 } } });
  assertRefused(out, 'price_interval_mismatch');
});

test('a yearly-interval price configured as the monthly offer is refused', async () => {
  const out = await checkout('STANDARD_MONTHLY', { price: { recurring: { interval: 'year', interval_count: 1 } } });
  assertRefused(out, 'price_interval_mismatch');
});

test('an interval count other than one is refused', async () => {
  /* 'year' x 2 is a two-year subscription wearing a yearly label. The count is
     as much a part of the period as the unit is. */
  const out = await checkout('STANDARD_YEARLY', { price: { recurring: { interval: 'year', interval_count: 2 } } });
  assertRefused(out, 'price_interval_count_mismatch');
});

test('a one-off price is refused rather than sold as a subscription', async () => {
  const out = await checkout('STANDARD_MONTHLY', { price: { type: 'one_time', recurring: null } });
  assertRefused(out, 'price_not_recurring');
});

// ---------------------------------------------------------------------------
// 5. INACTIVE AND MISSING
// ---------------------------------------------------------------------------

test('an archived price is refused', async () => {
  /* Archiving the old £89.99 price is the right housekeeping, and this is what
     happens if a variable still names it afterwards: a clear refusal rather
     than a Stripe error nobody can read. */
  const out = await checkout('STANDARD_YEARLY', { price: { active: false } });
  assertRefused(out, 'price_inactive');
});

test('a price id that no longer exists is refused, and no session is created', async () => {
  const out = await checkout('STANDARD_MONTHLY', { priceMissing: true });
  assert.equal(out.r.ok, false);
  assert.equal(out.r.code, 'stripe_resource_missing');
  assert.equal(out.sessionCreated, false, 'NO PAYMENT MAY PROCEED on a missing price');
});

test('Stripe echoing a different price than the one asked for is refused', async () => {
  const out = await checkout('STANDARD_MONTHLY', { price: { id: 'price_somethingelse' } });
  assertRefused(out, 'price_id_mismatch');
});

// ---------------------------------------------------------------------------
// 6. STRIPE ITSELF FAILING
// ---------------------------------------------------------------------------

test('a Stripe outage refuses checkout but is NOT reported as a price mismatch', async () => {
  /* THE DISTINCTION MATTERS OPERATIONALLY. Both refuse, and both must. But a
     mismatch sends somebody to edit a dashboard, and an outage sends them to
     wait — telling them the price is wrong when Stripe is down costs an hour
     of looking at a configuration that was always fine. */
  const out = await checkout('STANDARD_YEARLY', { priceHttp: { status: 503, code: null } });
  assert.equal(out.r.ok, false);
  assert.equal(out.r.code, 'stripe_http_503');
  assert.equal(out.r.transient, true, 'a 5xx must be marked transient');
  assert.equal(out.sessionCreated, false, 'NO PAYMENT MAY PROCEED while Stripe is unreachable');
});

test('a rate limit is transient too, and still refuses', async () => {
  const out = await checkout('STANDARD_MONTHLY', { priceHttp: { status: 429, code: null } });
  assert.equal(out.r.ok, false);
  assert.equal(out.r.transient, true);
  assert.equal(out.sessionCreated, false);
});

test('an auth failure refuses and is NOT transient', async () => {
  /* A bad key will still be bad in five minutes. Marking it transient would
     invite a retry loop against a wall. */
  const out = await checkout('STANDARD_MONTHLY', { priceHttp: { status: 401, code: 'authentication_required' } });
  assert.equal(out.r.ok, false);
  assert.equal(out.r.transient, false);
  assert.equal(out.sessionCreated, false);
});

// ---------------------------------------------------------------------------
// 7. THE PRODUCT
// ---------------------------------------------------------------------------

test('the product is enforced when an operator has named one', async () => {
  const out = await checkout('STANDARD_MONTHLY', { expectedProduct: 'prod_something_else' });
  assertRefused(out, 'price_product_mismatch');
});

test('the matching product passes', async () => {
  const out = await checkout('STANDARD_MONTHLY', { expectedProduct: PRODUCT });
  assert.equal(out.r.ok, true);
  assert.equal(out.sessionCreated, true);
});

test('with no product configured, every other check still runs', async () => {
  /* OPTIONAL BY DESIGN. Making the product a hard requirement would turn
     "nobody has set the new variable yet" into "nobody can buy anything",
     which is a worse outage than the misconfiguration it guards against. The
     amount check is what carries the weight, and it does not depend on it. */
  const fine = await checkout('STANDARD_YEARLY');
  assert.equal(fine.r.ok, true, 'an unset product variable must not block a correct price');

  const wrong = await checkout('STANDARD_YEARLY', { price: { unit_amount: 8999 } });
  assertRefused(wrong, 'price_amount_mismatch');
});

test('a price with no product at all is refused', async () => {
  const out = await checkout('STANDARD_MONTHLY', { price: { product: null } });
  assertRefused(out, 'price_product_missing');
});

// ---------------------------------------------------------------------------
// 8. THE RECORD, WHICH IS THE OTHER HALF OF THE DEFECT
// ---------------------------------------------------------------------------

test('the agreed price is what Stripe charged, not what the catalogue said', async () => {
  /* THE ROW THAT WOULD HAVE LIED. If a superseded price ever reaches a
     subscription — through a rail without this check, a reconciliation pull,
     or a subscription older than this guard — the ledger must record the
     amount actually taken. Recording the catalogue's number instead produces
     evidence that contradicts the customer's bank statement while looking
     authoritative. */
  const facts = P.subscriptionFacts({
    id: 'sub_1', customer: 'cus_1', status: 'active',
    metadata: { vvv_account_id: ACC, vvv_offer: 'STANDARD_YEARLY', vvv_period: 'yearly' },
    items: { data: [{ price: { unit_amount: 8999, currency: 'gbp', recurring: { interval: 'year' } } }] }
  }, { eventId: 'evt_1', occurredAt: new Date().toISOString() });

  assert.equal(facts.agreed_price_minor, 8999,
    'the ledger must record what was charged, not what was advertised');
  assert.equal(facts.agreed_currency, 'GBP');
});

test('a correct subscription records the same number either way', async () => {
  const o = Prod.offer('STANDARD_YEARLY');
  const facts = P.subscriptionFacts({
    id: 'sub_2', customer: 'cus_1', status: 'active',
    metadata: { vvv_account_id: ACC, vvv_offer: 'STANDARD_YEARLY', vvv_period: 'yearly' },
    items: { data: [{ price: { unit_amount: o.priceMinor, currency: 'gbp', recurring: { interval: 'year' } } }] }
  }, { eventId: 'evt_2', occurredAt: new Date().toISOString() });

  assert.equal(facts.agreed_price_minor, o.priceMinor);
  assert.equal(facts.agreed_currency, o.currency);
});

test('a payload with no item falls back to the catalogue rather than recording nothing', async () => {
  /* A reconciliation pull may not expand items. A null here would be a row
     that says the athlete agreed to no price, which is worse than the
     catalogue's answer — and the catalogue is right whenever checkout did its
     job, which on the web rail it now always does. */
  const o = Prod.offer('STANDARD_MONTHLY');
  const facts = P.subscriptionFacts({
    id: 'sub_3', customer: 'cus_1', status: 'active',
    metadata: { vvv_account_id: ACC, vvv_offer: 'STANDARD_MONTHLY', vvv_period: 'monthly' },
    items: { data: [{ price: { recurring: { interval: 'month' } } }] }
  }, { eventId: 'evt_3', occurredAt: new Date().toISOString() });

  assert.equal(facts.agreed_price_minor, o.priceMinor);
  assert.equal(facts.agreed_currency, o.currency);
});

// ---------------------------------------------------------------------------
// 9. THE GUARD ITSELF STAYS WIRED IN
// ---------------------------------------------------------------------------

test('createCheckoutSession cannot stop calling verifyPrice without this failing', async () => {
  /* The cheapest way for this protection to disappear is for somebody to drop
     the call while refactoring, leaving every test above passing against a
     function nobody invokes. This asserts the request is actually made. */
  const out = await checkout('STANDARD_MONTHLY');
  assert.ok(out.requests.some(q => /\/prices\/price_m1$/.test(q.url) && q.method === 'GET'),
    'checkout must fetch the Price it is about to sell');
});
