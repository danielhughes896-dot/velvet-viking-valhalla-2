'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Preview = require('../api/_preview.js');
const Trial = require('../api/_trial.js');
const E = require('../api/_entitlement.js');
const A = require('../api/_access.js');
const P = require('../api/_products.js');

// THE COMMERCIAL FRONT DOOR.
//
// The property the whole phase rests on: an athlete may see what Valhalla built
// for them without receiving Valhalla. Everything else is routing.

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
                  activeDays: [1,2,3,5,6], longRunDay: 6, benchmarkSeconds: 2700 };
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

test('an unauthenticated caller gets no preview', () => {
  const src = read('api/_preview.js');
  assert.match(src, /if \(!uid\) return S\.json\(res, 401/);
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
    [{ activeDays: [1] }, 'training_days_out_of_range'],
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
    activeDays: [1,1,1,2,2], longRunDay: 2, benchmarkSeconds: 2700 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.input.activeDays, [1, 2]);
});

// ---------------------------------------------------------------------------
// TRIAL ACTIVATION
// ---------------------------------------------------------------------------
test('the trial endpoint reads nothing from the request body', () => {
  // No account_id, no expiry, no product. The body being ignored is the point.
  const src = read('api/_trial.js').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  assert.equal(/readBody|req\.body|body\./.test(src), false,
    'the trial endpoint must not read the request body');
  assert.match(src, /userIdFromRequest/, 'the account comes from the verified token');
  assert.match(src, /p_account_id: uid/);
});

test('the trial duration comes from the offering, not from this file', () => {
  const src = read('api/_trial.js');
  assert.match(src, /p_trial_days: P\.TRIAL_DAYS/);
  assert.equal(/p_trial_days: 14|= 14\b/.test(src), false, 'no second copy of the duration');
  assert.equal(P.TRIAL_DAYS, 14);
});

test('only a started outcome is treated as success', () => {
  assert.equal(Trial.OUTCOME.started.ok, true);
  for (const k of Object.keys(Trial.OUTCOME)) {
    if (k === 'started') continue;
    assert.equal(Trial.OUTCOME[k].ok, false, k + ' must not be success');
  }
  // And an outcome the database invents that this file has not seen is a
  // refusal, never a success.
  assert.equal(Trial.OUTCOME.something_new, undefined);
});

// ---------------------------------------------------------------------------
// ROUTING
// ---------------------------------------------------------------------------
test('an athlete with access never sees an acquisition screen', () => {
  const html = read('start.html');
  assert.match(html, /if \(b\.access === true\)\{ enter\(\); return; \}/,
    'access short-circuits straight into the product');
  // And "enter" means the server-gated route, not a client-side unlock.
  assert.match(html, /var enter = function\(\)\{ location\.replace\('\/'\); \}/);
});

test('an expired athlete lands on the locked shell, not a dead end', () => {
  const html = read('start.html');
  assert.match(html, /show\('pane-locked'\)/);
  assert.match(html, /Everything you have done is still here/);
  assert.match(html, /href="\/account"/, 'there must be a route back');
  assert.match(html, /Nothing has been deleted/);
});

test('a hung server does not strand the athlete on a spinner', () => {
  // A request that never answers is not an error, so .catch() never fires for
  // it. Without a deadline the resolving pane is a dead end.
  const html = read('start.html');
  assert.match(html, /function within\(ms, p\)/, 'route resolution must be time-bounded');
  assert.match(html, /within\(10000, establish\(tok\)\)/);
  assert.match(html, /We could not reach Valhalla just then/,
    'and it must say something actionable rather than nothing');
  // Falling back to sign-in grants nothing: the server still decides access.
  assert.match(html, /show\('pane-auth'\);\s*\n\s*fail\('auth-err'/);
});

test('the front door claims no authority of its own', () => {
  const html = read('start.html');
  // It may ask, render and route. It may not decide.
  for (const forbidden of ['localStorage.setItem(\'vvv_entitle', 'access = true', 'grantAccess',
                           'entitlement_grants', 'service_role']) {
    assert.equal(html.indexOf(forbidden), -1, 'start.html contains ' + forbidden);
  }
  assert.match(html, /re-resolves that server-side/, 'and says so');
});

test('the magic link returns to /start and carries no token in the address bar', () => {
  const html = read('start.html');
  assert.match(html, /redirect: location\.origin \+ '\/start'/);
  assert.match(html, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/,
    'the fragment must be stripped — a token in history is a token');
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
  assert.ok(srcs.indexOf('/api/trial') !== -1);
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
  // 'card' alone is not the test: this page has a .card layout class, and
  // matching it proves nothing about billing. What must be absent is a payment
  // ACTION while Stripe is inert.
  const html = read('start.html').replace(/<!--[\s\S]*?-->/g, ' ');
  for (const rx of [/\bstripe\b/i, /\bcheckout\b/i, /\bsubscribe\b/i,
                    /credit card/i, /\bpayment\b/i, /api\/checkout/]) {
    assert.equal(rx.test(html), false, 'start.html offers a payment action: ' + rx);
  }
  // The only commercial action on the page is the card-free trial.
  assert.match(html, /api\/trial/);
  assert.equal(A.commerceEnabled(), false);
});
