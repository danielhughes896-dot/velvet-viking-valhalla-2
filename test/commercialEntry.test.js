'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../api/_entitlement.js');
const A = require('../api/_access.js');
const P = require('../api/_products.js');

// THE COMMERCIAL FRONT DOOR.
//
// The property the whole phase rests on: an athlete may see what Sacoro built
// for them without receiving Sacoro. Everything else is routing.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = new Date('2026-08-20T12:00:00Z');

// ---------------------------------------------------------------------------
// THE ACCESS BOUNDARY AND INPUT VALIDATION OF POST /api/preview
// ---------------------------------------------------------------------------
/* RETIRED (founder, 18 November 2026: remove the unused POST /api/preview).
   Eight tests here read api/_preview.js: that it never served the runtime,
   that its summary was an allow-list withholding the coaching product, that
   it showed real structure and paces, that it needed no sign-in, that it
   wrote nothing commercial, and that validate() refused abusive or duplicate
   input. Nothing had called the endpoint since the web builder was retired
   on 16 November, so the endpoint and every one of those properties went
   with it. The app's own builder holds its validation in
   test/builderSpecParity.test.js and test/m6-builder-answers.test.js. */

// ---------------------------------------------------------------------------
// THE COMMERCIAL DECISION
//
// The trial takes a payment method upfront and converts to the interval the
// athlete chose, so there is no separate trial endpoint any more: Checkout
// creates a real subscription with free days.
// ---------------------------------------------------------------------------
test('the standalone trial endpoint is gone, not merely unrouted', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'api/_trial.js')), false);
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(vercel.routes.filter((r) => /\/api\/trial/.test(r.src)).length, 0);
  const account = read('api/account.js');
  assert.equal(account.indexOf('_trial.js'), -1);
});

/* UPDATED (founder, 18 November 2026: "Remove the old start."). The entry
   surface these tests read was /start's own trial card, sign-in and routing.
   /start now leads everybody to the app root, and the entry surface is the
   in-app first-time journey's seven-day trial screen, on the website and in
   the website-distributed Android app. The same properties, held there. */
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const Agree = require('../api/_agreements.js');
const RUNTIME = read(RUNTIME_RELATIVE);
function jsFn(name){
  const at = RUNTIME.indexOf('function ' + name + '(');
  assert.ok(at !== -1, name + '() is missing');
  let depth = 0, i = RUNTIME.indexOf('{', at);
  for (; i < RUNTIME.length; i++){
    if (RUNTIME[i] === '{') depth++;
    else if (RUNTIME[i] === '}' && --depth === 0) break;
  }
  return RUNTIME.slice(at, i + 1);
}
function trialApp(commerce){
  const a = loadApp({ pinnedDate: '2026-11-18T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  a.journeyWrite({ v: 1, step: 'trial', built: true, drives: [], slide: 0, period: 'yearly' });
  const env = commerce ? { VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_m', VVV_PRICE_WEB_STANDARD_YEARLY: 'price_y' } : {};
  a.journeyOfferAsked = true;
  a.journeyOffer = { catalogue: P.catalogue('web', env, new Date('2026-11-18T09:00:00Z')),
    agreements: Agree.currentAgreements(), commerce_enabled: !!commerce, provider_configured: !!commerce };
  return a;
}

test('the entry surface makes the athlete choose an interval first', () => {
  const a = trialApp(true);
  let html = a.renderJourneyTrial();
  assert.match(html, /data-action="journey-period" data-period="monthly"/);
  assert.match(html, /data-action="journey-period" data-period="yearly"/);
  assert.match(html, /£11\.99/);
  assert.match(html, /£79\.99/);
  // And says what happens at the end of the seven days, for both.
  assert.match(html, /Day 8:<\/b> <span class="font-mono">£79\.99<\/span>, then annually/);
  a.journeySet({ period: 'monthly' });
  html = a.renderJourneyTrial();
  assert.match(html, /Day 8:<\/b> <span class="font-mono">£11\.99<\/span>, then monthly/);
  assert.match(html, /Cancel before your trial ends to avoid being charged\./);
  assert.match(html, /Continue to secure payment setup/, 'it is not said that a payment method comes next');
});

test('the entry surface starts a trial through Checkout, naming only a period', () => {
  const web = jsFn('journeyWebCheckout');
  assert.match(web, /fetch\('\/api\/checkout', \{\s*method:'POST',/);
  assert.match(web, /var body = \{ period: period \};\s*if \(returnTo === 'app'\) body\['return'\] = 'app';/,
    'the browser sends more than a period (and, from the app, where to come back to)');
  assert.equal(RUNTIME.indexOf('/api/trial'), -1, 'the card-free endpoint must not linger');
  // No price, amount or Stripe identifier is ever sent from the browser.
  assert.equal(/price_[A-Za-z0-9]|amount|priceMinor/.test(web), false);
});

test('a refused checkout says so truthfully and charges nothing', () => {
  const copy = /var JOURNEY_CHECKOUT_COPY = \{([^]*?)\n\};/.exec(RUNTIME)[1];
  assert.match(copy, /commerce_disabled: 'Subscriptions are not open yet\. Nothing has been charged\.'/);
  assert.match(copy, /already_subscribed_here: 'You already have a subscription on this account\.'/);
  assert.match(jsFn('handleJourneyTrialStart'), /We could not open the payment page\. Nothing has been charged\./);
});

// ---------------------------------------------------------------------------
// ROUTING
// ---------------------------------------------------------------------------
test('an athlete with access never sees an acquisition screen', () => {
  /* A subscription the server reports moves the journey past the trial, and
     the gate (api/app.js) hands an entitled athlete the full app. */
  const a = trialApp(true);
  a.cloudSession = { access_token: 't', user_id: 'u', expires_at: Date.now() + 3600e3 };
  a.entitlementInfo = { signed_in: true, access: true, reason: 'subscription_trial', state: 'trial' };
  assert.equal(a.journeyStep(), 'arrive');
  /* And /start, the old front door, decides nothing: it forwards to '/'. */
  assert.match(read('start.html'), /location\.replace\(dest\)/);
});

test('an expired athlete lands on the locked shell, not a dead end', () => {
  /* The gate sends a refused athlete to /account?why=locked, the one locked
     shell, which /start used to duplicate. */
  const app = read('api/app.js');
  assert.match(app, /return toShell\(res, decision\.reason === 'no_account' \? 'signin' : 'locked'\);/);
  const account = read('account.html');
  assert.match(account, /Your training plan and history are safe and still stored\./);
  assert.match(account, /id="export"[^>]*>Export My Training</, 'there must be a way to take everything');
  assert.match(account, /id="resubscribe"[^>]*>Set Up My Subscription</, 'there must be a route back');
});

test('a hung server does not strand the athlete on a spinner', () => {
  /* /start no longer waits on anything: the forward runs before the page
     draws. The trial screen's own wait for the catalogue ends in an offer to
     try again rather than a spinner. */
  const start = read('start.html');
  assert.doesNotMatch(start, /fetch\(/);
  const a = trialApp(true);
  a.journeyOffer = null; a.journeyOfferFailed = true;
  const html = a.renderJourneyTrial();
  assert.match(html, /We could not load the plans just now\. Nothing has been charged\./);
  assert.match(html, /data-action="journey-offer-retry">Try Again</);
});

test('the front door claims no authority of its own', () => {
  const html = read('start.html');
  // It may forward. It may not decide.
  for (const forbidden of ['localStorage', 'access = true', 'grantAccess',
                           'entitlement_grants', 'service_role', 'fetch(']) {
    assert.equal(html.indexOf(forbidden), -1, 'start.html contains ' + forbidden);
  }
});

test('a sign-in link that lands on /start keeps its tokens on the way to the root, out of the address bar', () => {
  const html = read('start.html');
  assert.match(html, /var dest = '\/' \+ \(location\.search \|\| ''\) \+ \(location\.hash \|\| ''\);/);
  assert.match(html, /location\.replace\(dest\)/, '/start, and the token with it, stays in the back history');
  /* And the root strips them once taken (cloudConsumeAuthHash). */
  assert.match(jsFn('cloudConsumeAuthHash'), /window\.history\.replaceState\(null, '', path \+ search\)/,
    'the fragment must be stripped: a token in history is a token');
});

// ---------------------------------------------------------------------------
// WIRING
// ---------------------------------------------------------------------------
test('the new routes cost no serverless functions', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => /\.js$/.test(f) && f.charAt(0) !== '_');
  assert.ok(fns.length <= 12, 'function budget: ' + fns.length);
  const vercel = JSON.parse(read('vercel.json'));
  const srcs = vercel.routes.map((r) => r.src);
  /* POST /api/preview was removed (founder, 18 November 2026). */
  assert.equal(srcs.indexOf('/api/preview'), -1, 'the removed preview endpoint is routed again');
  assert.equal(fs.existsSync(path.join(ROOT, 'api/_preview.js')), false);
  assert.ok(srcs.indexOf('/api/checkout') !== -1);
  assert.ok(srcs.indexOf('/start') !== -1);
});

/* RETIRED (founder, 18 November 2026: remove the unused POST /api/preview).
   'the account function can reach the runtime it needs to run' pinned
   includeFiles: protected/** on api/account.js only because the preview
   loaded the engine. No account route reads the runtime now, so the bundle
   setting went with the endpoint. */

test('Android deep-link auth is untouched', () => {
  // beta-signin owns the native redirect; Phase 3 must not have moved it.
  const src = read('api/beta-signin.js');
  assert.match(src, /com\.velvetviking\.valhalla:\/\/auth/);
});

// ---------------------------------------------------------------------------
// BILLING STAYS INERT
// ---------------------------------------------------------------------------
test('the entry journey fabricates no paid state', () => {
  /* UPDATED (founder, 18 November 2026: "Remove the old start."): the
     journey's trial screen, which replaced /start's, is the page read. */
  const html = jsFn('renderJourneyTrial') + jsFn('handleJourneyTrialStart') + jsFn('journeyWebCheckout') +
    /var JOURNEY_CHECKOUT_COPY = \{[^]*?\n\};/.exec(RUNTIME)[0];
  /* The trial now REQUIRES a payment method, so a payment path is correct and
     expected here. What must still be true is that nothing is fabricated: the
     page cannot name a price id, an amount or a Stripe object, and the server
     refuses while commerce is disabled. */
  assert.equal(/price_[A-Za-z0-9]{6,}|sk_live|sk_test|whsec_/.test(html), false,
    'no Stripe identifier or secret may appear in the page');
  assert.match(html, /Nothing has been charged/, 'a refusal must say so plainly');
  assert.equal(A.commerceEnabled(), false, 'and the server still refuses');
});
