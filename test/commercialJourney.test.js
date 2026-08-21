'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// THE WHOLE JOURNEY, AND THE SEAMS BETWEEN ITS PIECES.
//
// Every stage has its own suite. What nothing tested is the JOIN: that the page
// which names an interval reaches the endpoint that resolves it, that the
// webhook that lands writes what the resolver reads, that the consent choice
// taken in the builder governs the coaching engine on the other side of the
// app, and that an athlete who leaves and comes back gets a NEW agreement
// rather than the old one.
//
// The three consent postures are the reason this file exists in this shape:
// declined, granted and withdrawn are not three settings, they are three
// products, and only an end-to-end walk shows that the first is still a whole
// one.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const S = require(path.join(ROOT, 'api', '_strava.js'));
const P = require(path.join(ROOT, 'api', '_stripe.js'));
const Prod = require(path.join(ROOT, 'api', '_products.js'));
const E = require(path.join(ROOT, 'api', '_entitlement.js'));
const HC = require(path.join(ROOT, 'api', '_health-consent.js'));
const webhook = require(path.join(ROOT, 'api', 'billing-webhook.js'));
const { createFakeSupabase } = require('./fakeSupabase.js');
const { loadApp } = require('./harness.js');

const ACC = '11111111-1111-4111-8111-111111111111';
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const secs = (ms) => Math.floor(ms / 1000);
const days = (n) => n * 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// HARNESS -- the real endpoint, a fake database, a signed Stripe delivery
// ---------------------------------------------------------------------------
function fakeRes(){
  const out = {};
  return { setHeader(){}, status(c){ out.s = c; return this; }, send(b){ out.b = b; return this; },
           result(){ return { status: out.s, json: JSON.parse(out.b || 'null') }; } };
}
function stripeSub(over){
  return Object.assign({
    id: 'sub_j1', customer: 'cus_j1', status: 'trialing',
    metadata: { vvv_account_id: ACC, vvv_offer: 'STANDARD_MONTHLY', vvv_period: 'monthly' },
    trial_start: secs(T0), trial_end: secs(T0 + days(14)),
    current_period_start: secs(T0), current_period_end: secs(T0 + days(14)),
    cancel_at_period_end: false, canceled_at: null,
    items: { data: [{ price: { recurring: { interval: 'month' } } }] }
  }, over || {});
}
const evt = (id, type, obj, atMs) =>
  ({ id, type, created: secs(atMs == null ? T0 : atMs), data: { object: obj } });

async function journey(run){
  const f = createFakeSupabase({
    account_commercial: [{ account_id: ACC }],
    subscriptions: [], entitlement_grants: [], billing_events: [], entitlements: []
  });
  const realSb = S.sb, realCfg = S.config;
  const key = process.env.STRIPE_SECRET_KEY, sec = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = 'sk_test_1';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec';
  S.sb = f.S.sb; S.config = () => f.cfg;
  try{
    return await run(f, async function(e){
      const raw = JSON.stringify(e);
      const t = Math.floor(Date.now() / 1000);
      const sig = 't=' + t + ',v1=' + crypto.createHmac('sha256', 'whsec').update(t + '.' + raw).digest('hex');
      const res = fakeRes();
      await webhook({ method: 'POST', headers: { 'stripe-signature': sig },
                      rawBody: raw, body: JSON.parse(raw) }, res);
      return res.result();
    });
  } finally {
    S.sb = realSb; S.config = realCfg;
    if (key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = key;
    if (sec === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = sec;
  }
}
const resolve = (f, atMs) => E.resolveStandardEntitlement({
  account: f.rows('account_commercial')[0], subscriptions: f.rows('subscriptions'),
  grants: f.rows('entitlement_grants'), now: new Date(atMs) });

// ===========================================================================
// THE COMMERCIAL WALK
// ===========================================================================
test('website → /start → trial → paid → cancel → soft-lock → return', async () => {
  await journey(async (f, post) => {
    // /start names a PERIOD. It never names a price, an amount or a price id.
    const start = read('start.html');
    assert.match(start, /data-period="monthly"/);
    assert.match(start, /data-period="yearly"/);
    assert.match(start, /JSON\.stringify\(\{ period: period \}\)/);
    assert.equal(/price_[A-Za-z0-9]{6,}|unit_amount|sk_(test|live)_/.test(start), false,
      'the browser must never carry a price identifier or a key');

    // The trial begins, and it begins because a provider said so.
    assert.equal((await post(evt('e1', 'customer.subscription.created', stripeSub()))).json.applied, true);
    let ent = resolve(f, T0 + days(3));
    assert.equal(ent.reason, 'trial');
    assert.equal(f.rows('account_commercial')[0].trial_consumed_at, new Date(T0).toISOString());
    const agreed = f.rows('subscriptions')[0];
    assert.equal(agreed.agreed_price_minor, 1199);
    assert.equal(agreed.catalogue_version, Prod.CATALOGUE_VERSION);

    // It converts. Nobody decided anything; the provider reported a fact.
    await post(evt('e2', 'customer.subscription.updated',
      stripeSub({ status: 'active', current_period_start: secs(T0 + days(14)),
                  current_period_end: secs(T0 + days(45)) }), T0 + days(14)));
    assert.equal(resolve(f, T0 + days(20)).reason, 'paid');

    // They cancel. Cancelled is not ended.
    await post(evt('e3', 'customer.subscription.updated',
      stripeSub({ status: 'active', current_period_end: secs(T0 + days(45)),
                  cancel_at_period_end: true }), T0 + days(20)));
    assert.equal(resolve(f, T0 + days(30)).active, true, 'the period they paid for is the period they get');

    // The period ends. Soft-locked: no access, nothing owed, a purchase away.
    await post(evt('e4', 'customer.subscription.deleted',
      stripeSub({ status: 'canceled', current_period_end: secs(T0 + days(45)),
                  canceled_at: secs(T0 + days(45)),
                  cancellation_details: { reason: 'cancellation_requested' } }), T0 + days(45)));
    ent = resolve(f, T0 + days(46));
    assert.equal(ent.active, false);
    assert.equal(ent.commercialState, 'expired');
    assert.equal(ent.reason, 'expired', 'not revoked, and not a payment hold -- they simply left');

    // They come back. A NEW subscription, and the trial is not handed out again.
    const may = E.mayStartStandardPurchase({ provider: 'web', account: f.rows('account_commercial')[0],
      subscriptions: f.rows('subscriptions'), now: new Date(T0 + days(46)) });
    assert.equal(may.allowed, true, 'nothing blocks a returning athlete');
    assert.equal(may.trial.eligible, false, 'but the one trial has been spent');
  });
});

test('coming back is a new agreement at the current price', async () => {
  await journey(async (f, post) => {
    await post(evt('e1', 'customer.subscription.created', stripeSub()));
    await post(evt('e2', 'customer.subscription.deleted',
      stripeSub({ status: 'canceled', cancellation_details: { reason: 'cancellation_requested' } }),
      T0 + days(14)));
    const first = f.rows('subscriptions')[0];
    assert.equal(first.agreed_price_minor, 1199);

    // The catalogue rises while they are away.
    const real = Prod.OFFERS.STANDARD_MONTHLY.priceMinor;
    Prod.OFFERS.STANDARD_MONTHLY.priceMinor = 1499;
    try{
      await post(evt('e3', 'customer.subscription.created',
        stripeSub({ id: 'sub_j2', status: 'active', trial_start: null, trial_end: null,
                    current_period_end: secs(T0 + days(400)) }), T0 + days(300)));
    } finally { Prod.OFFERS.STANDARD_MONTHLY.priceMinor = real; }

    const rows = f.rows('subscriptions');
    assert.equal(rows.length, 2, 'a return is a new subscription row, not a revived one');
    const back = rows.filter(r => r.provider_subscription_id === 'sub_j2')[0];
    assert.equal(back.agreed_price_minor, 1499,
      'a new agreement is at the price on the day they agreed it');
    assert.equal(rows.filter(r => r.provider_subscription_id === 'sub_j1')[0].agreed_price_minor, 1199,
      'and the old one is still what it always was');
  });
});

test('monthly and annual are different agreements, not one with a setting', async () => {
  await journey(async (f, post) => {
    await post(evt('e1', 'customer.subscription.created', stripeSub()));
    await post(evt('e2', 'customer.subscription.created', stripeSub({
      id: 'sub_year', status: 'active', trial_start: null, trial_end: null,
      metadata: { vvv_account_id: ACC, vvv_offer: 'STANDARD_YEARLY', vvv_period: 'yearly' },
      items: { data: [{ price: { recurring: { interval: 'year' } } }] },
      current_period_end: secs(T0 + days(365)) }), T0 + days(60)));
    const rows = f.rows('subscriptions');
    const m = rows.filter(r => r.billing_period === 'monthly')[0];
    const y = rows.filter(r => r.billing_period === 'yearly')[0];
    assert.equal(m.agreed_price_minor, 1199);
    assert.equal(y.agreed_price_minor, 8999);
    assert.notEqual(m.price_locked_at, y.price_locked_at,
      'two agreements, agreed at two different moments');
  });
});

// ===========================================================================
// THE THREE CONSENT POSTURES ARE THREE PRODUCTS
// ===========================================================================
function app(){ return loadApp({ pinnedDate: '2026-09-01' }); }

test('DECLINED: the programme is whole, and no covered value is read', () => {
  const a = app();
  a.state.healthConsent = null;                      // never asked -- the default
  assert.equal(a.healthConsentGranted(), false);
  /* Object.keys rather than deepEqual: the runtime is evaluated in a VM
     realm, so its objects carry a different Object.prototype and a strict
     deep-equal fails on the prototype rather than on the contents. */
  assert.deepEqual(Object.keys(a.getActiveHRZones()), [], 'no heart-rate zones without consent');
  assert.equal(a.getTargetHRRangeForDay({ type: 'easy' }), null);
  assert.equal(a.dayReadiness({ readiness: { legs: 'heavy' } }), null,
    'answers given are not read while consent is absent');
  // And the ordinary programme still exists: paces, distances, the plan itself.
  assert.equal(typeof a.trainingPacesFromVDOT, 'function');
  const paces = a.trainingPacesFromVDOT(50);
  assert.ok(paces && Object.keys(paces).length > 0, 'pace coaching is unaffected');
});

test('GRANTED: the covered inputs are read, and only because of the record', () => {
  const a = app();
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted',
                            decidedAt: '2026-08-01T00:00:00Z', grantedAt: '2026-08-01T00:00:00Z' };
  a.state.setup = Object.assign({}, a.state.setup, { lthr: 172, maxHR: 190 });
  assert.equal(a.healthConsentGranted(), true);
  const z = a.getActiveHRZones();
  assert.ok(z && Object.keys(z).length > 0, 'zones exist once consent does');
  assert.deepEqual(a.dayReadiness({ readiness: { legs: 'heavy' } }), { legs: 'heavy' });
});

test('WITHDRAWN: history is retained and inert, not destroyed', () => {
  const a = app();
  const day = { date: '2026-08-20', readiness: { legs: 'heavy', sleep: 'poor' },
                actual: { km: 10, pace: 300, hr: 148, rpe: 5, feel: 'poor', notes: 'hip sore' } };
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'withdrawn',
                            decidedAt: '2026-09-01T00:00:00Z', grantedAt: '2026-08-01T00:00:00Z',
                            withdrawnAt: '2026-09-01T00:00:00Z' };
  // Inert.
  assert.equal(a.healthConsentGranted(), false);
  assert.equal(a.dayReadiness(day), null);
  assert.equal(a.getTargetHRRangeForDay({ type: 'easy' }), null);
  // Retained -- the values are still the athlete's own record.
  assert.equal(day.actual.hr, 148);
  assert.deepEqual(day.readiness, { legs: 'heavy', sleep: 'poor' });
  assert.equal(day.actual.notes, 'hip sore');
  // And RPE keeps working, because RPE was never inside the boundary.
  assert.equal(day.actual.rpe, 5);
});

test('a version bump retires every existing consent without a migration', () => {
  const a = app();
  a.state.healthConsent = { version: 'health_data_consent_v0', decision: 'granted',
                            decidedAt: '2026-08-01T00:00:00Z' };
  assert.equal(a.healthConsentGranted(), false,
    'consent is to a named purpose, not to whatever wording was on the screen');
  assert.equal(a.healthConsentAnswered(), false, 'and the athlete is asked again');
});

// ===========================================================================
// THE SEAM BETWEEN THE APP AND THE PROVIDER
// ===========================================================================
test('an unconsented provider activity is stripped before it is stored', async () => {
  // Not filtered on the way out. Never written.
  const calls = [];
  const fake = { sb: async (cfg, p, opts) => {
    calls.push({ p, opts });
    if (/health_data_consent/.test(p)) return { ok: true, status: 200, json: async () => [] };
    return { ok: true, status: 201, json: async () => [] };
  } };
  const out = await HC.forIngest({ serviceKey: 'x' }, fake.sb, ACC,
    { activityId: 9, km: 10, pace: 300, hr: 150, maxHR: 175, cadence: 178 });
  assert.equal(out.hr, undefined);
  assert.equal(out.maxHR, undefined);
  assert.equal(out.km, 10);
  assert.equal(out.cadence, 178, 'ordinary training data imports either way');
});

test('a missing consent table means no consent, not an error and not a bypass', async () => {
  const missing = async () => ({ ok: false, status: 404, json: async () => null });
  assert.equal(await HC.isGranted({ serviceKey: 'x' }, missing, ACC), false);
  const thrown = async () => { throw new Error('network'); };
  assert.equal(await HC.isGranted({ serviceKey: 'x' }, thrown, ACC), false);
});

test('a grant cannot be reached without a record that proves it', () => {
  /* The asymmetry is the whole point: withdrawal must never be blocked by an
     outage, and a grant must never happen without evidence. It is also what
     makes the deployment order stop mattering -- ship the code before the
     table exists and the insert 404s, so nobody reaches a granted state at
     all rather than reaching one recorded only in a browser. */
  const runtime = read('protected/velvet-viking-valhalla.html');
  const fn = runtime.slice(runtime.indexOf('function handleHealthConsentDecision'),
                           runtime.indexOf('function applyHealthConsentDecision'));
  assert.match(fn, /if \(granted && cloudSignedIn\(\)\)\{/);
  assert.match(fn, /return recordHealthConsentAudit\(rec\)\.then\(function\(recorded\)\{/);
  assert.match(fn, /if \(!recorded\)\{/);
  assert.match(fn, /nothing has been turned on/);
  // The builder reads LTHR immediately afterwards, so it must wait.
  assert.match(runtime, /await handleHealthConsentDecision\(!!consentBox\.checked, \{ quiet:true \}\)/);
});

// ===========================================================================
// THE NATIVE SHELL SELLS NOTHING
// ===========================================================================
test('the page with the prices on it suppresses them inside the shell', () => {
  // Apple and Google both prohibit steering to an external web payment for the
  // same subscription, and the Android manifest routes /start into the app.
  const start = read('start.html');
  assert.match(start, /function isNativeApp\(\)/);
  assert.match(start, /window\.Capacitor && window\.Capacitor\.isNativePlatform/);
  const guard = start.slice(start.indexOf('if (isNativeApp()){'),
                            start.indexOf("$('trial').addEventListener"));
  assert.match(guard, /plan-choice/, 'the interval choice must go');
  assert.match(guard, /card\.innerHTML =/, 'and the prices with it');
  assert.match(guard, /Subscriptions are set up on the web/);
  // Hiding the button alone would leave the prices on screen.
  assert.match(guard, /t\.classList\.add\('vvv-hidden'\)/);
});

test('the app runtime already refused, and still does', () => {
  const runtime = read('protected/velvet-viking-valhalla.html');
  const fn = runtime.slice(runtime.indexOf('function renderSubscriptionActions'),
                           runtime.indexOf('function renderSubscriptionActions') + 1200);
  assert.match(fn, /if \(isNativeApp\(\)\)\{/);
  assert.match(fn, /Manage or cancel your subscription where you bought it/);
  const after = fn.slice(fn.indexOf('if (isNativeApp()){'));
  assert.ok(after.indexOf('return') < after.indexOf('subscription-resubscribe'),
    'the native branch must return before any subscribe control is built');
});

test('the Android manifest is the reason /start needed guarding', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:pathPrefix="\/start"/);
  assert.match(manifest, /android:host="app\.velvetviking\.co\.uk"/);
  // And the device-storage posture, because the cached plan holds covered data.
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
});
