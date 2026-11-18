'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Preview = require('../api/_preview.js');
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
// THE ACCESS BOUNDARY
// ---------------------------------------------------------------------------
test('the preview never serves the protected runtime', () => {
  const src = read('api/_preview.js');
  // It loads the engine to RUN it, and returns a summary it assembles itself.
  assert.equal(/serveRuntime|sendFile|res\.end\(html|readFileSync\(RUNTIME/.test(src), false,
    'the preview must not ship the runtime file');
  assert.match(src, /summarise\(/, 'what crosses the wire is assembled here');
});

test('the preview response is an allow-list, so the plan cannot escape', () => {
  const src = read('api/_preview.js');
  const fn = src.slice(src.indexOf('function summarise'), src.indexOf('async function handle'));
  // Never a spread of the plan or the day. A spread is how the product leaks
  // one release after somebody adds a field.
  assert.equal(/\.\.\.d\b|Object\.assign\(\{\}, d\)|JSON\.parse\(JSON\.stringify\(days/.test(fn), false,
    'days must be projected field by field');
  assert.match(fn, /weekday: |type: |title: |km: /);
});

test('the preview shows real structure and the athlete\'s own paces', () => {
  // Both were silently empty on first build: days carry no `phase` field, and
  // paceZones() does not exist. An empty preview is a preview that argues
  // nothing, so it is worth pinning what it actually renders.
  const app = require('../test/harness.js').loadApp({ pinnedDate: '2026-08-20T09:00:00Z' });
  const input = { distanceKey: 'half', weeks: 12, volume: 45,
                  activeDays: [1,2,3,5,6], longRunDay: 6, benchmarkSeconds: 2700,
                  benchmarkDistanceKey: '10k', goalAmbition: 'B' };
  const start = app.todayStr();
  const race = app.addDays(app.addDays(start, -app.isoWeekday(start)), 12 * 7 - 1);
  const block = app.buildBlockWeeks('half', 45, 12);
  const days = app.buildDaysFromWeeks(block, race, { activeDays: input.activeDays, longRunDay: 6 }, start, false);
  app.state = app.makeDefaultState(); app.state.setup = { raceDate: race };
  const s = Preview.summarise(app, days, block, input);

  assert.ok(s.phases.length >= 2, 'the block shape must be described');
  assert.deepEqual(s.phases.map((x) => x.phase), ['Build', 'Taper']);
  assert.ok(s.paces && s.paces.length >= 3, 'pace guidance is the evidence it is THEIR plan');
  assert.match(s.paces[0].range, /\d+:\d\d\/km – \d+:\d\d\/km/);
  assert.ok(s.programme.totalSessions > 0 && s.programme.totalKm > 0);
  assert.ok(s.firstWeek.length > 0);
});

test('the preview withholds the coaching product', () => {
  const src = read('api/_preview.js');
  const fn = src.slice(src.indexOf('function summarise'), src.indexOf('async function handle'))
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  for (const withheld of ['executionReview', 'nextMove', 'adaptation', 'athleteState',
                          'rationale', 'evolution', 'history', 'completed']) {
    assert.equal(new RegExp('\\b' + withheld, 'i').test(fn), false,
      'the preview exposes ' + withheld + ', which is the product rather than a summary');
  }
});

test('the preview is reachable without authentication -- that is the point of it now', () => {
  /* Was: 'an unauthenticated caller gets no preview', asserting a 401 gate.
     That gate was correct for the acquisition order it was built under
     (sign in, then build). The approved journey is now builder -> preview ->
     "Save My Plan" -> trial, so an anonymous visitor must reach this endpoint
     BEFORE they have ever authenticated. generate() was always a pure function
     of the validated input -- see 'generating a preview writes nothing
     commercial' below -- so nothing about removing the gate changes what the
     preview can do; it only changes who may ask for it. */
  const src = read('api/_preview.js');
  assert.equal(/if \(!uid\) return S\.json\(res, 401/.test(src), false,
    'the preview still hard-gates on a signed-in caller');
  assert.match(src, /userIdFromRequest/, 'the caller is still identified when a token is present');
});

test('generating a preview writes nothing commercial', () => {
  const src = read('api/_preview.js').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  for (const write of ['account_commercial', 'entitlement_grants', 'subscriptions',
                       'start_standard_trial', 'trial_consumed']) {
    assert.equal(src.indexOf(write), -1,
      'the preview touches ' + write + ' — building a plan must not spend the trial');
  }
});

// ---------------------------------------------------------------------------
// INPUT VALIDATION — these values reach a generator
// ---------------------------------------------------------------------------
/* `ultra` MOVED SIDES, and it moved because it was on the wrong one.

   This list used to assert that 'ultra' was refused as an unknown distance.
   That was never a rule about safety -- DISTANCE_PROFILES has a complete ultra
   profile and the entry copy promises "anything from a 5K to a 50K ultra" --
   it was the allow-list having drifted from the engine's own list. The same
   drift is what made every marathon preview fail: the list accepted
   'marathon', which the engine has never had a key for, and refused 'full',
   which is the key it does have.

   So the guard now asserts the real rule -- only a distance the generator can
   actually build -- and a genuinely unknown value takes ultra's place below,
   so the refusal path is still exercised. */
test('the builder refuses input that would abuse the engine', () => {
  const ok = { distanceKey: '10k', weeks: 12, volume: 40, activeDays: [1,2,3,5,6], longRunDay: 6, benchmarkSeconds: 2700 };
  assert.equal(Preview.validate(ok).ok, true);
  const bad = [
    [{ distanceKey: 'parkrun' }, 'unknown_distance'],
    [{ distanceKey: '' }, 'unknown_distance'],
    [{ purpose: 'recovery' }, 'unknown_purpose'],
    [{ purpose: 'whatever' }, 'unknown_purpose'],
    [{ weeks: 500 }, 'weeks_out_of_range'],
    [{ weeks: 1 }, 'weeks_out_of_range'],
    [{ volume: 9999 }, 'volume_out_of_range'],
    /* A5 (founder, 15 November 2026): the builder accepts one to seven
       running days, so the refusal is now no days at all. */
    [{ activeDays: [] }, 'training_days_out_of_range'],
    [{ activeDays: [6] }, null],
    /* De-duplicated to seven distinct days -- once ABOVE the endpoint's own
       (looser) days:[2,7], now above the canonical builder's own 3-6, which
       assets/builder-spec.js's validation.daysRange makes this endpoint
       enforce too. Accepting eight running days was the drift this file's
       own header describes: a build the app itself could never generate. */
    /* ...and seven distinct days (eight entries, one repeated) is now inside
       the canonical range the endpoint reads, so it is accepted. */
    [{ activeDays: [1,2,3,4,5,6,0,1] , longRunDay: 6 }, null],
    [{ longRunDay: 4 }, 'long_run_day_not_a_training_day'],
    [{ benchmarkSeconds: 5 }, 'benchmark_out_of_range']
  ];
  for (const [over, code] of bad) {
    const r = Preview.validate(Object.assign({}, ok, over));
    if (code === null) { assert.equal(r.ok, true, JSON.stringify(over) + ' should be accepted'); continue; }
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.code, code);
  }
});

test('duplicate training days are de-duplicated, not counted twice', () => {
  const r = Preview.validate({ distanceKey: '10k', weeks: 12, volume: 40,
    activeDays: [1,1,1,2,2,3], longRunDay: 2, benchmarkSeconds: 2700 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.input.activeDays, [1, 2, 3]);
});

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
  assert.ok(srcs.indexOf('/api/preview') !== -1);
  assert.ok(srcs.indexOf('/api/checkout') !== -1);
  assert.ok(srcs.indexOf('/start') !== -1);
});

test('the account function can reach the runtime it needs to run', () => {
  // The preview loads the engine, so protected/** must be bundled with it.
  const vercel = JSON.parse(read('vercel.json'));
  assert.equal(vercel.functions['api/account.js'].includeFiles, 'protected/**');
});

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
