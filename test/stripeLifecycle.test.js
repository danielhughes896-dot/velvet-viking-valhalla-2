'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

// THE WHOLE COMMERCIAL LIFE OF ONE ATHLETE, DRIVEN THROUGH THE REAL ENDPOINT.
//
// WHY END TO END RATHER THAN UNIT BY UNIT. Every piece of this had unit tests
// and they all passed, and the pipeline was still broken in three places: the
// webhook handed the store a product code the store rejected, so every Stripe
// subscription failed to write and Stripe would have retried the delivery until
// it gave up; the ledger recorded which account paid but never which
// subscription, because it read a property the writer does not return; and the
// founding price -- the one commercial promise with a number in it -- was
// passed to a function that silently dropped it, since the column was not in
// the list of columns that function copies.
//
// None of those are subtle. All three survived because no test ever sent a
// signed Stripe event at the endpoint and then looked at the rows. This one
// does, so a future refactor that reconnects the same pipes in the wrong order
// fails here rather than in production at the first real payment.
//
// The Supabase side is test/fakeSupabase.js, which enforces the two constraints
// the correctness actually rests on: the unique index that makes a replay a
// duplicate, and the conditional update that makes an allowance spendable once.

const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'api', '_strava.js'));
const P = require(path.join(ROOT, 'api', '_stripe.js'));
const Prod = require(path.join(ROOT, 'api', '_products.js'));
const E = require(path.join(ROOT, 'api', '_entitlement.js'));
const Store = require(path.join(ROOT, 'api', '_commercial-store.js'));
const webhook = require(path.join(ROOT, 'api', 'billing-webhook.js'));
const { createFakeSupabase } = require('./fakeSupabase.js');

/* Fixtures, not credentials. Shaped like the shortest thing the code accepts
   rather than like a real key, so the repository's own secret scanners have
   nothing to find and nothing to be taught to ignore. */
const KEY = 'sk_test_1';
const SIGNING = 'whsec';

const ACC = '11111111-1111-4111-8111-111111111111';
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);          // 2026-09-01T12:00:00Z
const secs = (ms) => Math.floor(ms / 1000);
const days = (n) => n * 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// HARNESS
// ---------------------------------------------------------------------------
function fakeRes(){
  const out = { statusCode: null, headers: {}, body: null };
  return {
    setHeader(k, v){ out.headers[k.toLowerCase()] = v; },
    status(c){ out.statusCode = c; return this; },
    send(b){ out.body = b; return this; },
    result(){ return { status: out.statusCode, json: JSON.parse(out.body || 'null') }; }
  };
}

/* A Stripe subscription object, in Stripe's shape and Stripe's units. Seconds,
   not milliseconds, because that is what arrives and translating it is the
   adapter's job -- a fixture in our units would test the fixture. */
function stripeSub(over){
  return Object.assign({
    id: 'sub_live_1',
    customer: 'cus_live_1',
    status: 'trialing',
    metadata: { vvv_account_id: ACC, vvv_offer: 'STANDARD_MONTHLY', vvv_period: 'monthly' },
    trial_start: secs(T0),
    trial_end: secs(T0 + days(14)),
    current_period_start: secs(T0),
    current_period_end: secs(T0 + days(14)),
    cancel_at_period_end: false,
    canceled_at: null,
    items: { data: [{ price: { recurring: { interval: 'month' } } }] }
  }, over || {});
}

function stripeEvent(id, type, object, createdMs){
  return { id: id, type: type, created: secs(createdMs == null ? T0 : createdMs),
           data: { object: object } };
}

/* Sign exactly the way Stripe does, over exactly the bytes that will be sent.
   `signWith` is separate so the rotation test can sign with the old secret. */
function deliver(evt, opts){
  const o = opts || {};
  const raw = JSON.stringify(evt);
  const t = o.t == null ? Math.floor(Date.now() / 1000) : o.t;
  const sigs = (o.secrets || [SIGNING]).map(function(sec){
    return 'v1=' + crypto.createHmac('sha256', sec).update(t + '.' + raw).digest('hex');
  });
  const header = o.header !== undefined ? o.header : ('t=' + t + ',' + sigs.join(','));
  return {
    method: 'POST',
    headers: { 'stripe-signature': header },
    rawBody: raw,
    body: JSON.parse(raw)
  };
}

/* One environment, one fake database, restored afterwards. The handler reads
   both through module functions rather than captured constants, which is what
   makes this patchable without a loader shim. */
async function withStripe(seed, run){
  const f = createFakeSupabase(Object.assign({
    account_commercial: [{ account_id: ACC }],
    subscriptions: [], entitlement_grants: [], billing_events: [], entitlements: []
  }, seed || {}));

  const realSb = S.sb, realConfig = S.config;
  const realKey = process.env.STRIPE_SECRET_KEY;
  const realSec = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = KEY;
  process.env.STRIPE_WEBHOOK_SECRET = SIGNING;
  S.sb = f.S.sb;
  S.config = function(){ return f.cfg; };
  try{
    return await run(f, async function(evt, opts){
      const res = fakeRes();
      await webhook(deliver(evt, opts), res);
      return res.result();
    });
  } finally {
    S.sb = realSb; S.config = realConfig;
    if (realKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = realKey;
    if (realSec === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = realSec;
  }
}

const subRow = (f) => f.rows('subscriptions')[0];
const account = (f) => f.rows('account_commercial')[0];
const resolve = (f, atMs) => E.resolveStandardEntitlement({
  account: account(f), subscriptions: f.rows('subscriptions'),
  grants: f.rows('entitlement_grants'), now: new Date(atMs)
});

// ===========================================================================
// THE TRIAL BEGINS
// ===========================================================================
test('a trialing subscription writes a row, and the row is the one the resolver reads', async () => {
  await withStripe(null, async (f, post) => {
    const r = await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()));
    assert.equal(r.status, 200);
    assert.equal(r.json.applied, true, 'the delivery must apply, not 503 into a retry loop');

    const row = subRow(f);
    assert.ok(row, 'no subscription row was written at all');
    assert.equal(row.account_id, ACC);
    assert.equal(row.provider, 'web', 'the provider is the rail, never the processor');
    assert.equal(row.product_code, Prod.STANDARD,
      'the store rejects anything else, so a literal here fails every write');
    assert.equal(row.offer_code, 'STANDARD_MONTHLY');
    assert.equal(row.billing_period, 'monthly');
    assert.equal(row.condition, 'trialing');
    assert.equal(row.environment, 'sandbox', 'a test key must never write production rows');
    assert.equal(row.provider_customer_id, 'cus_live_1', 'the customer mapping must be kept');

    const ent = resolve(f, T0 + days(3));
    assert.equal(ent.active, true);
    assert.equal(ent.reason, 'trial');
    assert.equal(ent.validUntil, new Date(T0 + days(14)).toISOString());
  });
});

test('the trial is exactly fourteen days, and the number comes from the catalogue', async () => {
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()));
    const row = subRow(f);
    const span = (new Date(row.trial_end) - new Date(row.trial_start)) / days(1);
    assert.equal(span, Prod.TRIAL_DAYS);
    assert.equal(Prod.TRIAL_DAYS, 14);
  });
});

test('the webhook spends the allowance; nothing else may', async () => {
  await withStripe(null, async (f, post) => {
    assert.equal(account(f).trial_consumed_at, null);
    await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()));
    const a = account(f);
    assert.equal(a.trial_consumed_at, new Date(T0).toISOString(),
      'stamped from the provider trial start, not from our clock');
    assert.equal(a.trial_consumed_provider, 'web');
  });
});

test('an abandoned Checkout does not spend the trial', async () => {
  // Opening a payment screen and changing your mind is not using a trial, and
  // charging somebody their one allowance for that decision is indefensible.
  await withStripe(null, async (f) => {
    const cfg = P.config({ STRIPE_SECRET_KEY: KEY, VVV_SITE_ORIGIN: 'https://app.test',
                           VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_abc123' });
    const created = await P.createCheckoutSession(cfg, {
      offerCode: 'STANDARD_MONTHLY', uid: ACC, accountId: ACC, customerId: 'cus_live_1',
      env: { VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_abc123' }
    }, { fetch: async () => ({ ok: true, status: 200,
          text: async () => JSON.stringify({ id: 'cs_1', url: 'https://checkout.test/cs_1' }) }) });
    assert.equal(created.ok, true);
    // The athlete now closes the tab. No webhook arrives, because no
    // subscription was ever created.
    assert.equal(account(f).trial_consumed_at, null);
    assert.equal(f.rows('subscriptions').length, 0);
    assert.equal(E.trialEligibility(account(f), new Date(T0)).eligible, true);
  });
});

test('a redelivered trial event cannot move the allowance forward', async () => {
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()));
    const first = account(f).trial_consumed_at;
    // A different event id, so it is not caught as a duplicate -- this is the
    // second trialing telling, which the conditional update must refuse.
    const r = await post(stripeEvent('evt_2', 'customer.subscription.updated',
      stripeSub({ trial_start: secs(T0 + days(5)) }), T0 + days(5)));
    assert.equal(r.status, 200);
    assert.equal(account(f).trial_consumed_at, first,
      'a later telling must not extend the lifetime rule\'s reference point');
  });
});

// ===========================================================================
// THE AGREEMENT
// ===========================================================================
test('the founding price is written once and never rewritten', async () => {
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()));
    const locked = subRow(f);
    assert.equal(locked.agreed_price_minor, 1199);
    assert.equal(locked.agreed_currency, 'GBP');
    assert.equal(locked.catalogue_version, Prod.CATALOGUE_VERSION);
    assert.ok(locked.price_locked_at, 'an agreement with no locked-at is not an agreement');

    /* Now the catalogue rises. A renewal arrives -- the single event nobody
       inspects -- and it must not carry the new price into an old agreement. */
    const realPrice = Prod.OFFERS.STANDARD_MONTHLY.priceMinor;
    Prod.OFFERS.STANDARD_MONTHLY.priceMinor = 1499;
    try{
      await post(stripeEvent('evt_2', 'customer.subscription.updated',
        stripeSub({ status: 'active', current_period_end: secs(T0 + days(45)) }), T0 + days(14)));
    } finally { Prod.OFFERS.STANDARD_MONTHLY.priceMinor = realPrice; }

    const after = subRow(f);
    assert.equal(after.condition, 'active', 'the renewal itself must still apply');
    assert.equal(after.agreed_price_minor, 1199, 'the founding price was rewritten');
    assert.equal(after.price_locked_at, locked.price_locked_at,
      'the agreement was re-dated, which is the same defect wearing a hat');
  });
});

test('a subscription we cannot price gets no agreement rather than a guessed one', async () => {
  await withStripe(null, async (f, post) => {
    // No offer metadata and no recognisable interval: classifiable as nothing.
    await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub({
      metadata: { vvv_account_id: ACC }, items: { data: [{ price: { recurring: { interval: 'week' } } }] }
    })));
    const row = subRow(f);
    assert.ok(row, 'the subscription itself is still recorded');
    assert.equal(row.agreed_price_minor, null);
    assert.equal(row.price_locked_at, null);
  });
});

// ===========================================================================
// CONVERSION, RENEWAL, CANCELLATION
// ===========================================================================
test('the trial converts to paid without a second decision anywhere', async () => {
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()));
    await post(stripeEvent('evt_2', 'customer.subscription.updated', stripeSub({
      status: 'active', trial_end: secs(T0 + days(14)),
      current_period_start: secs(T0 + days(14)), current_period_end: secs(T0 + days(45))
    }), T0 + days(14)));

    assert.equal(subRow(f).condition, 'active');
    const ent = resolve(f, T0 + days(20));
    assert.equal(ent.active, true);
    assert.equal(ent.reason, 'paid');
    assert.equal(ent.commercialState, 'paid');
    // And the athlete's one allowance is still spent exactly once.
    assert.equal(account(f).trial_consumed_at, new Date(T0).toISOString());
  });
});

test('a renewal moves the period and nothing else', async () => {
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.created',
      stripeSub({ status: 'active', trial_start: null, trial_end: null,
                  current_period_end: secs(T0 + days(30)) })));
    const before = subRow(f);
    await post(stripeEvent('evt_2', 'customer.subscription.updated',
      stripeSub({ status: 'active', trial_start: null, trial_end: null,
                  current_period_start: secs(T0 + days(30)),
                  current_period_end: secs(T0 + days(60)) }), T0 + days(30)));
    const after = subRow(f);
    assert.equal(after.id, before.id, 'a renewal must not create a second subscription');
    assert.equal(new Date(after.current_period_end).toISOString(),
                 new Date(T0 + days(60)).toISOString());
    assert.equal(after.agreed_price_minor, before.agreed_price_minor);
    assert.equal(resolve(f, T0 + days(45)).reason, 'paid');
  });
});

test('cancelling during the trial keeps the trial and stops the renewal', async () => {
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()));
    await post(stripeEvent('evt_2', 'customer.subscription.updated',
      stripeSub({ cancel_at_period_end: true }), T0 + days(3)));

    const row = subRow(f);
    assert.equal(row.condition, 'trialing', 'Stripe does not leave the trial merely because auto-renew is off');
    assert.equal(row.cancel_at_period_end, true);
    assert.equal(row.auto_renew, false);

    // Access runs to the end of the fourteen days they were promised.
    const during = resolve(f, T0 + days(10));
    assert.equal(during.active, true);
    assert.equal(during.reason, 'trial');
    // And then stops, without anyone charging them.
    const after = resolve(f, T0 + days(15));
    assert.equal(after.active, false);
  });
});

test('cancelling after conversion runs to the end of the paid period', async () => {
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.created',
      stripeSub({ status: 'active', trial_start: null, trial_end: null,
                  current_period_end: secs(T0 + days(30)) })));
    await post(stripeEvent('evt_2', 'customer.subscription.updated',
      stripeSub({ status: 'active', trial_start: null, trial_end: null,
                  current_period_end: secs(T0 + days(30)), cancel_at_period_end: true }),
      T0 + days(5)));

    // Paid until the end of the month they bought. Cancelled is not ended.
    const mid = resolve(f, T0 + days(20));
    assert.equal(mid.active, true);
    assert.equal(mid.reason, 'paid');
    assert.equal(mid.commercialState, 'paid');

    // The period ends and Stripe deletes the subscription.
    await post(stripeEvent('evt_3', 'customer.subscription.deleted',
      stripeSub({ status: 'canceled', trial_start: null, trial_end: null,
                  current_period_end: secs(T0 + days(30)), canceled_at: secs(T0 + days(30)),
                  cancellation_details: { reason: 'cancellation_requested' } }), T0 + days(30)));
    assert.equal(subRow(f).condition, 'expired');
    assert.equal(subRow(f).cancelled_at, new Date(T0 + days(30)).toISOString());
    assert.equal(resolve(f, T0 + days(31)).active, false);
  });
});

// ===========================================================================
// THINGS GOING WRONG
// ===========================================================================
test('a failed renewal does not buy an unpaid month', async () => {
  /* THE DEFECT THIS REPLACED.
   *
   * Stripe defines current_period_end as the end of the period the subscription
   * has been INVOICED for -- not the one it has been PAID for. At renewal it
   * raises the next invoice, ADVANCES the period, attempts the card, and moves
   * the subscription to past_due when the attempt fails. A row mirrored
   * verbatim then carries a period end a month in the future that nobody has
   * paid for, and _entitlement.js's "the month you already paid for still
   * counts" branch reads it as paid.
   *
   * That is Valhalla inventing grace again, arriving through the mirror instead
   * of through a constant. The architecture recovery deleted seven invented
   * days; this would have been thirty.
   *
   * _stripe.js's paidThroughOf() is the translation that stops it: a past_due
   * subscription reports the START of the unpaid period as its end, because the
   * last period anybody actually paid for ended when this one began. */
  await withStripe(null, async (f, post) => {
    // A paid month, running T0 -> T0+30.
    await post(stripeEvent('evt_1', 'customer.subscription.created',
      stripeSub({ status: 'active', trial_start: null, trial_end: null,
                  current_period_start: secs(T0), current_period_end: secs(T0 + days(30)) })));
    assert.equal(resolve(f, T0 + days(10)).active, true);
    assert.equal(resolve(f, T0 + days(10)).reason, 'paid');

    // The renewal fails. Stripe has invoiced T0+30 -> T0+60 and been refused.
    await post(stripeEvent('evt_2', 'customer.subscription.updated',
      stripeSub({ status: 'past_due', trial_start: null, trial_end: null,
                  current_period_start: secs(T0 + days(30)),
                  current_period_end: secs(T0 + days(60)) }), T0 + days(30)));

    assert.equal(subRow(f).condition, 'past_due');
    assert.equal(subRow(f).current_period_end, new Date(T0 + days(30)).toISOString(),
      'the row must record what was PAID through, not what was invoiced through');
    assert.equal(subRow(f).grace_period_end, null,
      'Stripe supplies no retry deadline on a subscription, so there is no grace');

    const after = resolve(f, T0 + days(31));
    assert.equal(after.active, false, 'a failed renewal must not buy a free month');
    assert.equal(after.reason, 'payment_hold');
  });
});

test('a card that recovers picks the subscription straight back up', async () => {
  /* The other half of the same rule. Refusing access on a failed renewal is
     only correct if the retry that succeeds restores it immediately -- an
     athlete whose card cleared on the second attempt must not have to do
     anything at all. */
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.updated',
      stripeSub({ status: 'past_due', trial_start: null, trial_end: null,
                  current_period_start: secs(T0 + days(30)),
                  current_period_end: secs(T0 + days(60)) }), T0 + days(30)));
    assert.equal(resolve(f, T0 + days(31)).active, false);

    await post(stripeEvent('evt_2', 'customer.subscription.updated',
      stripeSub({ status: 'active', trial_start: null, trial_end: null,
                  current_period_start: secs(T0 + days(30)),
                  current_period_end: secs(T0 + days(60)) }), T0 + days(32)));

    const back = resolve(f, T0 + days(33));
    assert.equal(back.active, true);
    assert.equal(back.reason, 'paid');
    assert.equal(subRow(f).current_period_end, new Date(T0 + days(60)).toISOString(),
      'once it is paid, invoiced-through and paid-through are the same instant again');
  });
});

test('a provider that DOES supply grace is honoured, and only the provider', async () => {
  /* Stripe's subscription object carries no retry deadline, so the web rail has
     no provider grace and the adapter says so explicitly rather than leaving
     the column unwritten. The rule itself is provider-neutral and lives in
     _entitlement.js, so this pins the behaviour Apple and Google will reach
     through the same column -- and pins that nothing in the API computes one. */
  const E = require('../api/_entitlement.js');
  const at = new Date(T0 + days(31));
  const base = { provider: 'web', product_code: 'VALHALLA_STANDARD', condition: 'past_due',
                 current_period_end: new Date(T0 + days(30)).toISOString() };

  const none = E.subscriptionAccess(base, at);
  assert.equal(none.active, false);
  assert.equal(none.reason, 'payment_hold');

  const given = E.subscriptionAccess(
    Object.assign({}, base, { grace_period_end: new Date(T0 + days(40)).toISOString() }), at);
  assert.equal(given.active, true);
  assert.equal(given.reason, 'grace_period');
  assert.equal(given.until, new Date(T0 + days(40)).toISOString());
});


test('a dispute revokes, and revocation outranks every date on the row', async () => {
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.created',
      stripeSub({ status: 'active', trial_start: null, trial_end: null,
                  current_period_end: secs(T0 + days(300)) })));
    assert.equal(resolve(f, T0 + days(10)).active, true);

    await post(stripeEvent('evt_2', 'customer.subscription.deleted',
      stripeSub({ status: 'canceled', trial_start: null, trial_end: null,
                  current_period_end: secs(T0 + days(300)),
                  cancellation_details: { reason: 'payment_disputed' } }), T0 + days(10)));

    assert.equal(subRow(f).condition, 'revoked');
    const after = resolve(f, T0 + days(11));
    assert.equal(after.active, false);
    assert.equal(after.reason, 'revoked', 'a refunded purchase must not keep granting for ten months');
  });
});

test('an ordinary cancellation is not a revocation', async () => {
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.deleted',
      stripeSub({ status: 'canceled', cancellation_details: { reason: 'cancellation_requested' } })));
    assert.equal(subRow(f).condition, 'expired');
  });
});

test('a status we do not recognise is dropped, never guessed into access', async () => {
  await withStripe(null, async (f, post) => {
    const r = await post(stripeEvent('evt_1', 'customer.subscription.updated',
      stripeSub({ status: 'something_new_from_stripe' })));
    assert.equal(r.status, 200, 'a non-2xx would have Stripe retry it forever');
    assert.equal(r.json.applied, false);
    assert.equal(f.rows('subscriptions').length, 0);
  });
});

test('a subscription we cannot attribute creates nothing', async () => {
  await withStripe(null, async (f, post) => {
    const r = await post(stripeEvent('evt_1', 'customer.subscription.created',
      stripeSub({ metadata: {} })));
    assert.equal(r.status, 200);
    assert.equal(r.json.reason, 'unattributable');
    assert.equal(f.rows('subscriptions').length, 0);
    assert.equal(account(f).trial_consumed_at, null, 'and it certainly does not spend a trial');
  });
});

// ===========================================================================
// THE WIRE
// ===========================================================================
test('an unsigned or wrongly signed delivery is refused before the body is read', async () => {
  await withStripe(null, async (f, post) => {
    /* A header that is present but carries no v1 signature. NOT an empty
       header: an absent stripe-signature means "this is not a Stripe
       delivery", which correctly falls through to the generic provider path,
       and asserting 401 there would be asserting the wrong endpoint. */
    assert.equal((await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()),
                             { header: 't=' + Math.floor(Date.now() / 1000) })).status, 401);
    assert.equal((await post(stripeEvent('evt_2', 'customer.subscription.created', stripeSub()),
                             { secrets: ['not-the-secret'] })).status, 401);
    assert.equal((await post(stripeEvent('evt_3', 'customer.subscription.created', stripeSub()),
                             { t: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
    assert.equal(f.rows('subscriptions').length, 0);
    assert.equal(f.rows('billing_events').length, 0, 'an unverified event must not even be claimed');
  });
});

test('a signing-secret rotation does not drop a delivery', async () => {
  // Stripe sends several v1 signatures while two secrets are live. Any one
  // matching is valid -- otherwise a rotation silently loses every event
  // signed with the secret the endpoint has not been told about yet.
  await withStripe(null, async (f, post) => {
    const r = await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()),
                         { secrets: ['the-old-secret', SIGNING] });
    assert.equal(r.status, 200);
    assert.equal(r.json.applied, true);
  });
});

test('a replay is free, and answers 200 so the provider stops retrying', async () => {
  await withStripe(null, async (f, post) => {
    const evt = stripeEvent('evt_1', 'customer.subscription.created', stripeSub());
    const first = await post(evt);
    const second = await post(evt);
    assert.equal(first.json.applied, true);
    assert.equal(second.status, 200);
    assert.equal(second.json.applied, false);
    assert.equal(second.json.reason, 'already_applied');
    assert.equal(f.rows('billing_events').length, 1, 'the ledger holds one row per event, ever');
    assert.equal(f.rows('subscriptions').length, 1);
  });
});

test('the ledger records which subscription an event was for', async () => {
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()));
    const led = f.rows('billing_events')[0];
    assert.equal(led.result, 'processed');
    assert.equal(led.account_id, ACC);
    assert.equal(led.subscription_id, subRow(f).id,
      'reading a property the writer does not return records null forever');
    assert.equal(led.environment, 'sandbox');
  });
});

test('no signing secret means 503, never "accept everything"', async () => {
  const realSec = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try{
    const res = fakeRes();
    await webhook(deliver(stripeEvent('evt_1', 'customer.subscription.created', stripeSub())), res);
    assert.equal(res.result().status, 503);
  } finally {
    if (realSec === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = realSec;
  }
});

// ===========================================================================
// CHECKOUT
// ===========================================================================
function checkoutParams(offerCode, priceEnvName, priceId){
  const env = {}; env[priceEnvName] = priceId;
  const cfg = P.config(Object.assign({ STRIPE_SECRET_KEY: KEY,
    VVV_SITE_ORIGIN: 'https://app.test', VVV_MARKETING_ORIGIN: 'https://site.test' }, env));
  let sent = null;
  return P.createCheckoutSession(cfg, {
    offerCode: offerCode, uid: ACC, accountId: ACC, customerId: 'cus_1', env: env
  }, { fetch: async (url, init) => { sent = init.body;
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'cs_1', url: 'https://c.test' }) }; } })
   .then(function(r){ return { r: r, body: decodeURIComponent(String(sent).replace(/\+/g, ' ')) }; });
}

test('monthly checkout asks for the monthly price, a card, and fourteen days', async () => {
  const { r, body } = await checkoutParams('STANDARD_MONTHLY', 'VVV_PRICE_WEB_STANDARD_MONTHLY', 'price_m1');
  assert.equal(r.ok, true);
  assert.equal(r.period, 'monthly');
  assert.equal(r.trialDays, 14);
  assert.match(body, /line_items\[0\]\[price\]=price_m1/);
  assert.match(body, /mode=subscription/);
  assert.match(body, /subscription_data\[trial_period_days\]=14/);
  assert.match(body, /payment_method_collection=always/,
    'the whole commercial model rests on the card being taken upfront');
  // No amount, no currency, no price built here: the price id is the only thing.
  assert.equal(/unit_amount|price_data|currency=/.test(body), false);
});

test('annual checkout asks for the annual price', async () => {
  const { r, body } = await checkoutParams('STANDARD_YEARLY', 'VVV_PRICE_WEB_STANDARD_YEARLY', 'price_y1');
  assert.equal(r.ok, true);
  assert.equal(r.period, 'yearly');
  assert.equal(r.trialDays, 14);
  assert.match(body, /line_items\[0\]\[price\]=price_y1/);
  assert.match(body, /payment_method_collection=always/);
});

test('an unconfigured price refuses rather than charging something', async () => {
  const cfg = P.config({ STRIPE_SECRET_KEY: KEY, VVV_SITE_ORIGIN: 'https://app.test' });
  const r = await P.createCheckoutSession(cfg, { offerCode: 'STANDARD_MONTHLY', uid: ACC, accountId: ACC, env: {} },
    { fetch: async () => { throw new Error('must not reach Stripe'); } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'price_not_configured');
});

test('the checkout carries everything needed to rebuild the purchase from a webhook alone', async () => {
  // The browser may never come back to the success page. The webhook must be
  // sufficient on its own, which means the metadata has to be complete.
  const { body } = await checkoutParams('STANDARD_MONTHLY', 'VVV_PRICE_WEB_STANDARD_MONTHLY', 'price_m1');
  assert.match(body, /subscription_data\[metadata\]\[vvv_account_id\]=/);
  assert.match(body, /subscription_data\[metadata\]\[vvv_offer\]=STANDARD_MONTHLY/);
  assert.match(body, /subscription_data\[metadata\]\[vvv_period\]=monthly/);
  assert.match(body, /client_reference_id=/);
});

test('customer mapping is by our uid, and an existing customer is reused', async () => {
  const cfg = P.config({ STRIPE_SECRET_KEY: KEY });
  let called = 0;
  const reused = await P.ensureCustomer(cfg, ACC, 'a@b.test', 'cus_existing',
    { fetch: async () => { called++; return { ok: true, status: 200, text: async () => '{}' }; } });
  assert.equal(reused.customerId, 'cus_existing');
  assert.equal(reused.created, false);
  assert.equal(called, 0, 'an athlete must not acquire a second customer');

  let sentBody = null, sentHeaders = null;
  const made = await P.ensureCustomer(cfg, ACC, 'a@b.test', null,
    { fetch: async (u, init) => { sentBody = init.body; sentHeaders = init.headers;
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'cus_new' }) }; } });
  assert.equal(made.customerId, 'cus_new');
  assert.match(decodeURIComponent(sentBody), new RegExp('metadata\\[vvv_user_id\\]=' + ACC));
  assert.equal(sentHeaders['Idempotency-Key'], 'cust:' + ACC,
    'a timed-out create that is retried must not make a second customer');
});

// ===========================================================================
// FAIL CLOSED
// ===========================================================================
test('an unreadable database is not an athlete with no subscription', async () => {
  const broken = { sb: async () => ({ ok: false, status: 503, json: async () => null,
                                      headers: { get: () => null } }) };
  const r = await Store.resolveStandardEntitlement(broken, { supabaseUrl: 'x', serviceKey: 'y' }, ACC, new Date(T0));
  assert.equal(r.ok, false);
  assert.equal(r.active, false);
  assert.equal(r.reason, 'invalid');
});

test('live charging is not a key being present', () => {
  // Commerce goes live when a human says so. A credential appearing in the
  // environment -- through an integration, a restore, a copied project -- must
  // never be the thing that starts charging people.
  const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_live_1' });
  assert.equal(cfg.isLiveKey, true);
  assert.equal(cfg.environment, 'production');
  const src = require('fs').readFileSync(path.join(ROOT, 'api', '_stripe.js'), 'utf8');
  assert.equal(/live: *!!secret|live: *cfg\.hasSecret/.test(src), false,
    'liveness must not be derived from a key existing');
});

// ===========================================================================
// THE PATH PREFIX -- A WHOLE CLASS OF SILENT 404
// ===========================================================================
test('no caller of S.sb prepends /rest/v1, because S.sb already does', () => {
  /* S.sb builds `cfg.supabaseUrl + '/rest/v1' + path`. A call site that also
     writes the prefix produces /rest/v1/rest/v1/... -- a 404 that no code path
     checks, because both of these were fire-and-forget writes:
       the trial allowance stamp, so no athlete would ever have consumed their
         one trial and every athlete could take another;
       the last-active touch, so the operational metric would have been null
         forever on a board built to read it.
     Both were live in main. Neither test suite noticed, because both call
     sites were asserted by grepping for the function name. */
  const fs = require('fs');
  const dir = path.join(ROOT, 'api');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))){
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    const re = /\bsb\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*['"`]\/rest\/v1/g;
    if (re.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    'these call sites double the PostgREST prefix and will 404 silently');
});

test('the two writes that were 404ing are exercised, not merely spelled', async () => {
  // The allowance stamp, proven by the row rather than by the source line.
  await withStripe(null, async (f, post) => {
    await post(stripeEvent('evt_1', 'customer.subscription.created', stripeSub()));
    assert.ok(account(f).trial_consumed_at, 'the allowance was not actually spent');
  });
  // And the touch, proven by the request the session handler issues.
  const fs = require('fs');
  const session = fs.readFileSync(path.join(ROOT, 'api', 'session.js'), 'utf8');
  const m = /sb\([a-z]+, *'([^']*touch_last_active[^']*)'/.exec(session);
  assert.ok(m, 'the session no longer touches last_active_at at all');
  assert.equal(m[1], '/rpc/touch_last_active');
});
