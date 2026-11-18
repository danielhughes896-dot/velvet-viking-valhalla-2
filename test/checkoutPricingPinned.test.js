'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Prod = require('../api/_products.js');
const Checkout = require('../api/_checkout.js');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RUNTIME = read(RUNTIME_RELATIVE);
const PINNED = '2026-11-18T09:00:00Z';

// AUDIT REPRO (Final Full Product Audit, Part 17/23, finding B). The in-app
// Subscription card is cross-checked against api/_products.js
// (productionSurfaces.test.js: "the prices shown are the prices the billing
// catalogue charges"), but start.html -- then the checkout page --
// independently hardcoded the same facts as literal strings with no test
// diffing them against the catalogue.
//
// UPDATED (founder, 18 November 2026: "Remove the old start."). /start holds
// no prices any more; the checkout page is the journey's seven-day trial
// screen, on the website and in the website-distributed Android app. The same
// guarantee, held there, and held more strongly: that screen types NO price at
// all, and every figure it shows is read from GET /api/checkout, which is the
// catalogue checkout charges from. So this file asks the real handler and
// renders the real screen from its answer.

function mkRes(){
  return { code: null, body: null, headers: {},
    setHeader(k, v){ this.headers[String(k).toLowerCase()] = v; },
    status(s){ this.code = s; return this; },
    send(b){ this.body = b; return this; },
    end(b){ if (b) this.body = b; return this; },
    json(){ return JSON.parse(this.body); } };
}
async function offerFromServer(){
  const env = { VVV_COMMERCE_ENABLED: '1', VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_m', VVV_PRICE_WEB_STANDARD_YEARLY: 'price_y' };
  const saved = {};
  Object.keys(env).forEach(k => { saved[k] = process.env[k]; process.env[k] = env[k]; });
  try {
    const res = mkRes();
    await Checkout.handle({ method: 'GET', headers: {} }, res);
    return res.json();
  } finally {
    Object.keys(saved).forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  }
}
async function trialHtml(period, native){
  const a = loadApp({ pinnedDate: PINNED });
  a.showToast = () => {};
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  a.journeyWrite({ v: 1, step: 'trial', built: true, drives: [], slide: 0, period: period || 'yearly' });
  a.journeyOfferAsked = true;
  a.journeyOffer = await offerFromServer();
  if (native) a.isNativeApp = () => true;
  return a.renderJourneyTrial();
}
const money = n => '£' + (n / 100).toFixed(2);

test('every price on the trial screen is a catalogue price, or arithmetic on one', async () => {
  const monthly = Prod.offer('STANDARD_MONTHLY');
  const yearly = Prod.offer('STANDARD_YEARLY');
  assert.equal(money(monthly.priceMinor), '£11.99', 'sanity: catalogue price unexpectedly changed');
  assert.equal(money(yearly.priceMinor), '£79.99', 'sanity: catalogue price unexpectedly changed');
  const allowed = [money(monthly.priceMinor), money(yearly.priceMinor),
                   money(Math.round(yearly.priceMinor / 12)), money(0)];
  for (const period of ['yearly', 'monthly']){
    for (const native of [false, true]){
      const html = await trialHtml(period, native);
      const prices = html.match(/£\d+\.\d{2}/g) || [];
      assert.ok(prices.length > 0, 'sanity: the trial screen must actually quote a price');
      prices.forEach(p => assert.ok(allowed.indexOf(p) !== -1,
        'the trial screen quotes ' + p + ', which is not a catalogue figure (' + allowed.join(' / ') + ')'));
      assert.ok(html.indexOf(money(monthly.priceMinor)) !== -1 && html.indexOf(money(yearly.priceMinor)) !== -1);
      /* the timeline names the price of the period chosen */
      const chosen = period === 'monthly' ? monthly : yearly;
      assert.ok(html.indexOf('<span class="font-mono">' + money(chosen.priceMinor) + '</span>, then ' +
        (period === 'monthly' ? 'monthly' : 'annually')) !== -1, 'the day-8 line is not the chosen catalogue price');
    }
  }
});

test('the trial length and the first charge day are the catalogue\'s', async () => {
  assert.equal(Prod.TRIAL_DAYS, 7, 'sanity: catalogue trial length unexpectedly changed');
  const html = await trialHtml('yearly');
  assert.match(html, new RegExp('Start Your ' + Prod.TRIAL_DAYS + '-Day Free Trial'));
  assert.ok(html.indexOf('Day ' + (Prod.TRIAL_DAYS + 1) + ':</b>') !== -1, 'the first charge is not on day 8');
  /* The immediate-start wording names the statutory fourteen-day
     cancellation right, which is the law's number, not the trial's. */
  const own = html.replace(/<p class="jr-fine jr-agree-say">[^]*?<\/p>/, '');
  (own.replace(/<[^>]*>/g, ' ').match(/\b\d+[\s-]days?\b/gi) || []).forEach(p =>
    assert.equal(parseInt(p, 10), Prod.TRIAL_DAYS, '"' + p + '" is not the catalogue trial length'));
});

test('no price or trial length is typed into the journey\'s source', () => {
  const block = RUNTIME.slice(RUNTIME.indexOf('THE FIRST-TIME JOURNEY\n'), RUNTIME.indexOf('function renderMainContent(){'));
  assert.doesNotMatch(block, /11\.99|79\.99|6\.67|£\d|\\u00a3\d|1199|7999/, 'a price is typed into the journey');
  assert.doesNotMatch(block, /\b(7|seven)[- ]day free trial/i, 'the trial length is typed into a sentence');
  assert.equal(read('start.html').match(/£\d/), null, '/start quotes a price again');
});

test('the currency, offer codes and periods the trial screen relies on still exist in the catalogue', async () => {
  assert.ok(Prod.offer('STANDARD_MONTHLY'), 'STANDARD_MONTHLY must still exist');
  assert.ok(Prod.offer('STANDARD_YEARLY'), 'STANDARD_YEARLY must still exist');
  assert.equal(Prod.offer('STANDARD_MONTHLY').currency, 'GBP', 'the screen writes £ for GBP');
  assert.equal(Prod.offer('STANDARD_YEARLY').currency, 'GBP');
  assert.equal(Prod.offer('STANDARD_MONTHLY').billingPeriod, 'monthly');
  assert.equal(Prod.offer('STANDARD_YEARLY').billingPeriod, 'yearly');
  const html = await trialHtml('yearly');
  assert.match(html, /data-period="monthly"/);
  assert.match(html, /data-period="yearly"/);
  assert.equal(Prod.offerForPeriod('monthly').code, 'STANDARD_MONTHLY');
  assert.equal(Prod.offerForPeriod('yearly').code, 'STANDARD_YEARLY');
});
