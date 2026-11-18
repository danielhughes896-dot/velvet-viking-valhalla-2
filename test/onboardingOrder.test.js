'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Preview = require('../api/_preview.js');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// SACORO FIRST-TIME ONBOARDING ORDER
//
// The approved acquisition journey: Builder -> Personalised Preview ->
// account ("Save My Plan", now Make It Yours) -> Trial or Purchase -> App,
// with the plan seen BEFORE any identity is asked for.
//
// UPDATED (founder, 18 November 2026: "Remove the old start."). This file used
// to read /start's own screens: a banked preview, Save My Plan, a sign-in
// form and a trial card. Those screens are gone, and /start now leads
// everybody to the app root, where the in-app first-time journey holds the
// same order: Welcome, the builder, the slides and the programme preview, then
// Make It Yours, then the seven-day trial. So the ORDER is asserted on the
// journey now, and /start is asserted to be the plain door it has become.
// What these tests guarded that still matters is kept, on the journey:
//   * the plan before identity, and identity before the trial;
//   * checkout only with a real session;
//   * the account moment is "save your plan", not "Create Account";
//   * the preview endpoint's engine is the real one, with no auth gate.
// Retired with the screens: the banked-preview storage helpers
// (savePending / loadPending / clearPending) and route(), which no longer
// exist anywhere in start.html.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('start.html');
const RUNTIME = read(RUNTIME_RELATIVE);
const PINNED = '2026-11-18T09:00:00Z';

function journeyOnly(){
  const a = loadApp({ pinnedDate: PINNED });
  a.showToast = () => {};
  a.JOURNEY_ONLY_MODE = true;
  return a;
}
function fnSrc(name){
  const at = RUNTIME.indexOf('function ' + name + '(');
  assert.ok(at !== -1, name + '() is missing');
  const open = RUNTIME.indexOf('{', at);
  let depth = 0, i = open;
  for (; i < RUNTIME.length; i++){
    if (RUNTIME[i] === '{') depth++;
    else if (RUNTIME[i] === '}' && --depth === 0) break;
  }
  return RUNTIME.slice(at, i + 1);
}

// ---------------------------------------------------------------------------
// 1. /start IS A DOOR TO THE JOURNEY, FOR EVERYBODY
// ---------------------------------------------------------------------------
test('/start leads everybody to the app root, keeping the query and the fragment', () => {
  const script = /<script>([^]*?)<\/script>/.exec(SRC);
  assert.ok(script, '/start has no forward');
  assert.match(script[1], /var dest = '\/' \+ \(location\.search \|\| ''\) \+ \(location\.hash \|\| ''\);/,
    'the forward drops the sign-in tokens or GoTrue\'s error');
  assert.match(script[1], /location\.replace\(dest\)/, 'the forward leaves /start in the back history');
  /* For everybody: no session, no entitlement and no stored build is read. */
  assert.doesNotMatch(script[1], /localStorage|fetch\(|access_token|vvv_pending_build/,
    '/start decides something on its own again');
  assert.equal((SRC.match(/<script\b/g) || []).length, 1, '/start carries more than the forward');
  /* And a visitor without scripts still has the way in. */
  assert.match(SRC, /<a class="vvv-btn" id="open-app" href="\/">Open SACORO<\/a>/);
});

test('the forward, run, lands on the root with the tokens and the errors intact', () => {
  const script = /<script>([^]*?)<\/script>/.exec(SRC)[1];
  const cases = [['', ''], ['', '#access_token=a.b.c&refresh_token=r&expires_in=3600'],
                 ['?error=access_denied&error_code=otp_expired', ''], ['?period=yearly', '#x']];
  cases.forEach(([search, hash]) => {
    const went = [];
    const location = { search, hash, replace(u){ went.push(u); } };
    new Function('location', script)(location);
    assert.deepEqual(went, ['/' + search + hash]);
  });
});

test('none of the old /start screens is left', () => {
  const markup = SRC.replace(/<!--[^]*?-->/g, '');
  ['pane-preview', 'pane-auth', 'pane-sent', 'pane-locked', 'pane-resolving', 'save-plan', 'trial-card',
   'checkout-agreements', 'plan-choice', 'id="trial"'].forEach(id =>
    assert.equal(markup.indexOf(id), -1, id + ' is still on /start'));
  assert.doesNotMatch(markup, /Save My Plan|Send My Link|Start My 7-Day Trial|Your access has ended|Restore Access/);
  assert.doesNotMatch(markup, /api\/checkout|api\/subscription|api\/beta-signin|api\/session/,
    '/start still talks to a server route');
  assert.doesNotMatch(markup, /£\d/, '/start still quotes a price');
});

/* The /start route still names this page, so links already in inboxes, the
   website's buttons and the Android App Link (pathPrefix="/start") reach the
   forward rather than a 404. */
test('/start is still a route, and the Android App Link still claims it', () => {
  const vercel = JSON.parse(read('vercel.json'));
  assert.ok(vercel.routes.some(r => r.src === '/start' && r.dest === '/start.html'));
  assert.match(read('android/app/src/main/AndroidManifest.xml'), /android:pathPrefix="\/start"/);
});

// ---------------------------------------------------------------------------
// 2. THE PLAN BEFORE IDENTITY, NOW ON THE JOURNEY
// ---------------------------------------------------------------------------
test('the journey shows the plan before it asks who you are, and asks before the trial', () => {
  const order = RUNTIME.match(/var JOURNEY_STEPS = \[([^\]]*)\]/)[1].replace(/'/g, '').split(/,\s*/);
  ['slides', 'preview', 'account', 'trial'].reduce((prev, s) => {
    const at = order.indexOf(s);
    assert.ok(at > prev, s + ' is out of order in ' + order.join(' > '));
    return at;
  }, -1);
  /* The programme preview is the screen /start used to call "Here is your
     programme", and it asks for nothing. */
  const a = journeyOnly();
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  a.journeyWrite({ v: 1, step: 'preview', built: true, drives: [], slide: 0 });
  const preview = a.renderJourneyPreview();
  assert.match(preview, /Here Is Your Programme/);
  assert.doesNotMatch(preview, /type="email"|journey-trial-start|api\/checkout/, 'the preview asks for identity or money');
});

test('a visitor with no account is held at Make It Yours: the trial needs a session', () => {
  const a = journeyOnly();
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  ['trial', 'arrive', 'done'].forEach(step => {
    a.journeyWrite({ v: 1, step: step, built: true, drives: [], slide: 0 });
    assert.equal(a.journeyStep(), 'account', step + ' is reachable without an account');
  });
});

test('checkout still requires a real session, and sends only a period', () => {
  const web = fnSrc('journeyWebCheckout');
  assert.match(web, /cloudRefreshIfNeeded\(\)\.then\(function\(fresh\)\{\s*if \(!fresh\) return \{ ok:false, code:'not_signed_in' \};/,
    'checkout no longer requires a signed-in athlete');
  assert.match(web, /'Authorization':'Bearer '\+cloudSession\.access_token/);
  assert.match(web, /var body = \{ period: period \};/, 'checkout sends more than a period');
});

test('the account moment is saving your plan, not "Create Account"', () => {
  const a = journeyOnly();
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  a.journeyWrite({ v: 1, step: 'account', built: true, drives: [], slide: 0 });
  const html = a.renderJourneyAccount();
  assert.match(html, /Make It Yours\./);
  assert.match(html, /Create your account to save your personalised training plan\./);
  assert.match(html, /Your plan is ready\. Your trial has not started\./);
  const labels = (html.match(/<button[^>]*>[^]*?<\/button>/g) || []).map(b => b.replace(/<[^>]*>/g, '').trim());
  assert.ok(labels.length > 0);
  labels.forEach(l => assert.doesNotMatch(l, /Create Account/i, 'a button says Create Account'));
});

// ---------------------------------------------------------------------------
// 3. THE PREVIEW ENGINE IS THE REAL ONE
// ---------------------------------------------------------------------------
test('the preview endpoint itself has no auth gate left to trip', () => {
  const src = read('api/_preview.js');
  assert.equal(/if \(!uid\) return S\.json\(res, 401/.test(src), false,
    'the preview still hard-gates on a signed-in caller');
});

test('the real engine produces the preview shape from the builder\'s input contract', () => {
  // The builder and /api/_preview.js speak the same input contract; this
  // proves a preview is generated by the real training engine, not a second,
  // decorative one.
  const app = require('./harness.js').loadApp({ pinnedDate: '2026-08-20T09:00:00Z' });
  const input = { purpose: 'race', distanceKey: 'half', weeks: 12, volume: 45,
                   activeDays: [1, 2, 3, 5, 6], longRunDay: 6, benchmarkSeconds: 2700 };
  const v = Preview.validate(input);
  assert.equal(v.ok, true, 'the builder\'s input shape failed validation: ' + JSON.stringify(v.errors));
  const g = Preview.generate(app, v.input);
  const s = Preview.summarise(app, g.days, g.block, v.input);
  assert.equal(s.goal.distance, 'half');
  assert.ok(s.programme.weeks > 0 && s.programme.totalSessions > 0);
  assert.ok(s.paces && s.paces.length > 0, 'the preview would have no paces to show');
});
