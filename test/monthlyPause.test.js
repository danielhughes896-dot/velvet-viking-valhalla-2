'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// THE MONTHLY PAUSE.
//
// Two things that are easy to confuse and must not be: a RULE about what
// Valhalla allows, and an INSTRUCTION to whoever is collecting the money. The
// rule lives in _pause.js and is pure -- it makes no network call and knows no
// provider's field names. The instruction lives in _stripe.js. These tests keep
// the seam honest, because the day the rule is written in Stripe's vocabulary
// is the day there is no rule left to port to Apple or Google.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const Pz = require(path.join(ROOT, 'api', '_pause.js'));
const E = require(path.join(ROOT, 'api', '_entitlement.js'));
const P = require(path.join(ROOT, 'api', '_stripe.js'));

const DAY = 24 * 3600 * 1000;
const T0 = new Date('2026-09-01T12:00:00Z');
const at = (d) => new Date(T0.getTime() + d * DAY);

const monthly = (over) => Object.assign({
  id: 'sub-1', account_id: 'acc-1', provider: 'web', product_code: 'VALHALLA_STANDARD',
  offer_code: 'STANDARD_MONTHLY', billing_period: 'monthly', condition: 'active',
  current_period_start: at(-10), current_period_end: at(20),
  cancel_at_period_end: false, auto_renew: true,
  agreed_price_minor: 1199, agreed_currency: 'GBP', catalogue_version: 'launch-2026-08',
  price_locked_at: at(-400),
  paused_at: null, pause_resumes_at: null, last_pause_started_at: null
}, over || {});

const resolve = (sub, when) =>
  E.resolveStandardEntitlement({ subscriptions: [sub], grants: [], now: when });

// ===========================================================================
// WHO MAY PAUSE
// ===========================================================================
test('a monthly subscriber in good standing may pause', () => {
  assert.deepEqual(Pz.mayPause(monthly(), T0), { ok: true, reason: 'ok' });
});

test('an annual subscriber may not, and is told why', () => {
  // They have already paid for the year. There is no collection to suspend, so
  // a "pause" could only mean extending the term -- a different product at a
  // different price. Refused rather than approximated.
  const r = Pz.mayPause(monthly({ billing_period: 'yearly', offer_code: 'STANDARD_YEARLY' }), T0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_monthly');
});

test('the annual refusal is not masked by a later one', () => {
  // Somebody on an annual plan who also paused last month should hear "annual
  // plans cannot be paused", not "you already used your pause this year". The
  // order of the checks is the message the athlete reads.
  const r = Pz.mayPause(monthly({
    billing_period: 'yearly', last_pause_started_at: at(-30)
  }), T0);
  assert.equal(r.reason, 'not_monthly');
});

test('a trial cannot be paused, and neither can a payment problem', () => {
  // A trial has nothing to collect yet, so pausing it would only shorten the
  // trial. past_due has a payment to sort out first.
  assert.equal(Pz.mayPause(monthly({ condition: 'trialing' }), T0).reason, 'not_active');
  assert.equal(Pz.mayPause(monthly({ condition: 'past_due' }), T0).reason, 'not_active');
  assert.equal(Pz.mayPause(monthly({ condition: 'expired' }), T0).reason, 'not_active');
  assert.equal(Pz.mayPause(monthly({ condition: 'revoked' }), T0).reason, 'not_active');
});

test('a subscription already on its way out cannot be paused', () => {
  // It would either quietly cancel the cancellation or leave a pause that
  // outlives the subscription. Both are surprises at the athlete's expense.
  assert.equal(Pz.mayPause(monthly({ cancel_at_period_end: true }), T0).reason, 'cancelling');
});

test('nothing is not a subscription', () => {
  assert.equal(Pz.mayPause(null, T0).reason, 'no_subscription');
  assert.equal(Pz.mayPause({}, T0).reason, 'no_subscription');
});

// ===========================================================================
// HOW LONG
// ===========================================================================
test('one, two or three months -- and nothing else', () => {
  for (const n of [1, 2, 3]) assert.equal(Pz.planPause(monthly(), n, T0).ok, true, n + ' months');
  /* '2' is in this list on purpose. Number('2') is 2, so a coercing check
     accepts it -- and the same coercion reads '' as 0 and [2] as 2. The caller
     parses; this refuses anything that is not already a number. */
  for (const n of [0, 4, 12, -1, 1.5, '2', '', [2], null, undefined, NaN, Infinity]){
    assert.equal(Pz.planPause(monthly(), n, T0).reason, 'bad_duration', JSON.stringify(n));
  }
});

test('three months from the 31st lands on the last day, not in the month after next', () => {
  // setMonth() on the 31st silently overflows, and "90 days" is not three
  // months. Clamping to the last valid day is what a human means.
  const jan31 = new Date('2026-01-31T09:00:00Z');
  assert.equal(Pz.addMonths(jan31, 1).toISOString(), '2026-02-28T09:00:00.000Z');
  assert.equal(Pz.addMonths(jan31, 3).toISOString(), '2026-04-30T09:00:00.000Z');
  // and a leap year is not special-cased by hand
  assert.equal(Pz.addMonths(new Date('2028-01-31T09:00:00Z'), 1).toISOString(),
               '2028-02-29T09:00:00.000Z');
});

test('the plan writes a window and a memory, and does not perform anything', () => {
  const plan = Pz.planPause(monthly(), 2, T0);
  assert.equal(plan.patch.paused_at, T0.toISOString());
  assert.equal(plan.patch.pause_resumes_at, '2026-11-01T12:00:00.000Z');
  assert.equal(plan.patch.last_pause_started_at, T0.toISOString());
  assert.deepEqual(plan.providerInstruction,
    { action: 'suspend_collection', resumesAt: '2026-11-01T12:00:00.000Z',
      chargeForPausedPeriod: false });
  // Nothing about the agreement is in the patch at all.
  for (const k of ['agreed_price_minor', 'agreed_currency', 'catalogue_version',
                   'price_locked_at', 'condition', 'offer_code', 'billing_period']){
    assert.equal(Object.prototype.hasOwnProperty.call(plan.patch, k), false,
      'a pause must not touch ' + k);
  }
});

// ===========================================================================
// ONCE PER ROLLING YEAR
// ===========================================================================
test('a second pause inside the rolling year is refused', () => {
  const used = monthly({ last_pause_started_at: at(-200) });
  const r = Pz.mayPause(used, T0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'used_this_year');
  assert.equal(r.eligibleFrom, new Date(at(-200).getTime() + 365 * DAY).toISOString());
});

test('and allowed again once the year has actually passed', () => {
  assert.equal(Pz.mayPause(monthly({ last_pause_started_at: at(-366) }), T0).ok, true);
  assert.equal(Pz.mayPause(monthly({ last_pause_started_at: at(-364) }), T0).ok, false);
});

test('the window is rolling, so December and January are not two allowances', () => {
  // A calendar-year rule lets somebody pause in December and again in January
  // and take six months off inside eight weeks.
  const dec = new Date('2026-12-15T00:00:00Z');
  const jan = new Date('2027-01-15T00:00:00Z');
  assert.equal(Pz.mayPause(monthly({ last_pause_started_at: dec }), jan).reason, 'used_this_year');
});

test('the year is measured from the pause STARTING, not from it ending', () => {
  // From the end, a three-month pause would push the next eligibility fifteen
  // months out. The rule is one pause per year, not one per year of payment.
  const started = at(-370), ended = at(-280);
  const sub = monthly({ last_pause_started_at: started, paused_at: null, pause_resumes_at: null });
  assert.equal(Pz.mayPause(sub, T0).ok, true);
  assert.ok(ended > at(-365), 'the fixture must actually distinguish the two readings');
});

test('resuming keeps the memory, which is the only thing enforcing the rule', () => {
  const paused = monthly({ paused_at: at(-40), pause_resumes_at: at(-10),
                           last_pause_started_at: at(-40) });
  const plan = Pz.planResume(paused, T0);
  assert.equal(plan.ok, true);
  assert.equal(plan.patch.paused_at, null);
  assert.equal(plan.patch.pause_resumes_at, null);
  assert.equal(Object.prototype.hasOwnProperty.call(plan.patch, 'last_pause_started_at'), false,
    'naming it here is how it eventually gets nulled and the yearly rule stops working');

  // Applied, the athlete still cannot pause again this year.
  const after = Object.assign({}, paused, plan.patch);
  assert.equal(Pz.mayPause(after, T0).reason, 'used_this_year');
});

test('pause, resume, pause again the same afternoon is refused', () => {
  const p1 = Pz.planPause(monthly(), 1, T0);
  const paused = Object.assign({}, monthly(), p1.patch);
  const resumed = Object.assign({}, paused, Pz.planResume(paused, T0).patch);
  assert.equal(Pz.planPause(resumed, 3, new Date(T0.getTime() + 3600 * 1000)).reason,
    'used_this_year');
});

test('a pause cannot be stacked on a pause', () => {
  const paused = monthly({ paused_at: at(-5), pause_resumes_at: at(25),
                           last_pause_started_at: at(-5) });
  // 'already_paused' rather than 'used_this_year': the more specific truth.
  assert.equal(Pz.mayPause(paused, T0).reason, 'already_paused');
});

// ===========================================================================
// ACCESS AND BILLING WHILE PAUSED
// ===========================================================================
test('access stops with billing, and comes back with it', () => {
  const paused = monthly({ paused_at: at(-5), pause_resumes_at: at(25),
                           last_pause_started_at: at(-5),
                           current_period_end: at(400) });
  // A pause that keeps the product working is a free month with extra steps.
  const during = resolve(paused, T0);
  assert.equal(during.active, false);
  assert.equal(during.reason, 'paused');
  assert.equal(during.commercialState, 'paused');
  assert.equal(during.validUntil, null);

  // It resumes itself. Nothing has to run, and nobody has to press anything.
  const after = resolve(paused, at(26));
  assert.equal(after.active, true);
  assert.equal(after.reason, 'paid');
});

test('the resume date is reported, so a surface can say when they are back', () => {
  const paused = monthly({ paused_at: at(-5), pause_resumes_at: at(25), last_pause_started_at: at(-5) });
  const src = E.resolveStandardEntitlement({ subscriptions: [paused], grants: [], now: T0 });
  const one = src.sources.filter(s => s.reason === 'paused')[0];
  assert.ok(one, 'the paused source must be reported, not swallowed');
  assert.equal(one.until, at(25).toISOString());
  const state = Pz.pauseState(paused, T0);
  assert.equal(state.paused, true);
  assert.equal(state.daysRemaining, 25);
});

test('a half-written pause fails towards the athlete keeping access', () => {
  // paused_at with no resume date is an open-ended suspension with no automatic
  // end -- exactly what the policy forbids -- so it is not treated as a pause.
  const half = monthly({ paused_at: at(-5), pause_resumes_at: null });
  assert.equal(Pz.pauseState(half, T0).paused, false);
  assert.equal(resolve(half, T0).active, true);
});

test('an admin grant still works while a subscription is paused', () => {
  // The grant is a separate source and a pause is about a purchase. Somebody
  // with complimentary access who pauses their own subscription does not lose
  // the grant. Written on admin_comp since beta was retired: the claim is
  // about a grant surviving a pause, and only a live grant can show it.
  const paused = monthly({ paused_at: at(-5), pause_resumes_at: at(25) });
  const grant = (source) => ({ id: 'g1', account_id: 'acc-1', source: source,
    product_code: 'VALHALLA_STANDARD', revoked_at: null, expires_at: null });
  const r = E.resolveStandardEntitlement({
    subscriptions: [paused], grants: [grant('admin_comp')], now: T0
  });
  assert.equal(r.active, true);
  assert.equal(r.reason, 'admin_comp');

  // And a retired grant rescues nobody from a pause either.
  const beta = E.resolveStandardEntitlement({
    subscriptions: [paused], grants: [grant('admin_beta')], now: T0
  });
  assert.equal(beta.active, false, 'a beta grant covered a paused subscription');
});

test('pausing is not leaving: a paused athlete cannot buy a second subscription', () => {
  const paused = monthly({ paused_at: at(-5), pause_resumes_at: at(25) });
  const may = E.mayStartStandardPurchase({
    provider: 'web', subscriptions: [paused], account: {}, now: T0
  });
  assert.equal(may.allowed, false);
  assert.equal(may.reason, 'already_subscribed_here');
});

// ===========================================================================
// CANCELLING WHILE PAUSED
// ===========================================================================
test('cancelling while paused ends it now, because no period is running', () => {
  const paused = monthly({ paused_at: at(-5), pause_resumes_at: at(25),
                           last_pause_started_at: at(-5), current_period_end: at(400) });
  const plan = Pz.planCancelWhilePaused(paused, T0);
  assert.equal(plan.ok, true);
  assert.equal(plan.patch.condition, 'expired');
  assert.equal(plan.patch.cancelled_at, T0.toISOString());
  assert.equal(plan.patch.paused_at, null);
  assert.equal(plan.providerInstruction.action, 'cancel_now');
  // The pause allowance is NOT handed back: coming back is a new agreement at
  // the current price, and it must not arrive with a fresh pause they did not
  // earn.
  assert.equal(Object.prototype.hasOwnProperty.call(plan.patch, 'last_pause_started_at'), false);
  const after = Object.assign({}, paused, plan.patch);
  assert.equal(resolve(after, at(1)).active, false);
});

test('cancelling something that is not paused is not this function"s job', () => {
  assert.equal(Pz.planCancelWhilePaused(monthly(), T0).reason, 'not_paused');
});

// ===========================================================================
// THE FOUNDING PRICE THROUGH A PAUSE
// ===========================================================================
test('a valid pause preserves the agreement exactly', () => {
  const before = monthly();
  const paused = Object.assign({}, before, Pz.planPause(before, 3, T0).patch);
  const resumed = Object.assign({}, paused, Pz.planResume(paused, at(92)).patch);
  for (const k of ['agreed_price_minor', 'agreed_currency', 'catalogue_version', 'price_locked_at']){
    assert.deepEqual(resumed[k], before[k], 'the pause moved ' + k);
  }
  assert.equal(resumed.agreed_price_minor, 1199);
});

// ===========================================================================
// THE PROVIDER SEAM
// ===========================================================================
test('the policy knows no provider', () => {
  /* Comments stripped: this file explains the seam at length and legitimately
     names Stripe while doing so. What must be absent is a DEPENDENCE. */
  const code = read('api/_pause.js')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  assert.equal(/stripe|_stripe|pause_collection|api\.stripe/i.test(code), false,
    'the pause rule must not be written in a provider"s vocabulary');
  assert.equal(/fetch\(|require\('\.\/_stripe/.test(code), false,
    'the rule decides; it does not perform');
});

test('the provider is instructed to void, not to defer or to write off', () => {
  // void          nothing is collected and nothing is owed afterwards
  // keep_as_draft the athlete returns to a bill for the months they did not use
  // mark_uncollectible a bad-debt mark against somebody who did nothing wrong
  const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_1' });
  let body = null, headers = null;
  return P.pauseCollection(cfg, 'sub_1',
    { action: 'suspend_collection', resumesAt: '2026-12-01T00:00:00Z', chargeForPausedPeriod: false },
    { fetch: async (u, i) => { body = decodeURIComponent(i.body); headers = i.headers;
        return { ok: true, status: 200, text: async () => '{}' }; } })
    .then(function(){
      assert.match(body, /pause_collection\[behavior\]=void/);
      assert.match(body, /pause_collection\[resumes_at\]=\d+/);
      assert.equal(/keep_as_draft|mark_uncollectible/.test(body), false);
      assert.match(headers['Idempotency-Key'], /^pause:sub_1:/,
        'a retried pause must not become two');
    });
});

test('a pause with no end date is refused at the money as well as at the rule', () => {
  const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_1' });
  const never = async () => { throw new Error('must not reach Stripe'); };
  return Promise.all([
    P.pauseCollection(cfg, 'sub_1', { action: 'suspend_collection' }, { fetch: never })
      .then(r => assert.equal(r.code, 'no_resume_date')),
    P.pauseCollection(cfg, 'sub_1',
      { action: 'suspend_collection', resumesAt: '2026-12-01T00:00:00Z', chargeForPausedPeriod: true },
      { fetch: never }).then(r => assert.equal(r.code, 'deferral_not_supported')),
    P.pauseCollection(cfg, '', { action: 'suspend_collection', resumesAt: '2026-12-01T00:00:00Z' },
      { fetch: never }).then(r => assert.equal(r.code, 'no_subscription_id')),
    P.pauseCollection(cfg, 'sub_1', { action: 'cancel_now' }, { fetch: never })
      .then(r => assert.equal(r.code, 'not_a_pause_instruction'))
  ]);
});

test('resume sends an EMPTY pause_collection, not a null one', () => {
  // encode() drops nulls and undefineds, so a null would send no field at all
  // and leave the subscription paused while reporting success. The empty string
  // is the difference between resuming somebody and appearing to.
  const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_1' });
  let body = null;
  return P.resumeCollection(cfg, 'sub_1',
    { fetch: async (u, i) => { body = i.body; return { ok: true, status: 200, text: async () => '{}' }; } })
    .then(function(){
      assert.equal(body, 'pause_collection=');
      assert.notEqual(body, '', 'an empty request body would silently do nothing');
    });
});

test('a provider failure leaves the athlete exactly where they were', () => {
  // The plan is computed and returns a patch; the caller applies the provider
  // FIRST. If Stripe refuses, no row has changed. The other order produces a
  // subscription Valhalla believes is paused and Stripe is still charging for.
  const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_1' });
  const before = monthly();
  const plan = Pz.planPause(before, 1, T0);
  assert.equal(plan.ok, true);
  return P.pauseCollection(cfg, 'sub_1', plan.providerInstruction, {
    fetch: async () => ({ ok: false, status: 402, text: async () => JSON.stringify({ error: { code: 'card_declined' } }) })
  }).then(function(r){
    assert.equal(r.ok, false);
    // The subscription object was never mutated by planning.
    assert.equal(before.paused_at, null);
    assert.equal(before.last_pause_started_at, null);
    assert.equal(resolve(before, T0).active, true);
  });
});

// ===========================================================================
// THE SCHEMA THIS RESTS ON
// ===========================================================================
test('the columns the policy needs exist, and say what they are for', () => {
  const sql = read('supabase-trial-via-provider.sql');
  for (const col of ['paused_at', 'pause_resumes_at', 'last_pause_started_at']){
    assert.match(sql, new RegExp('add column if not exists\\s+' + col));
  }
  assert.match(sql, /last_pause_started_at/);
});
