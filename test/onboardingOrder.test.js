'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Preview = require('../api/_preview.js');

// SACORO FIRST-TIME ONBOARDING ORDER
//
// The approved acquisition journey: Builder -> Personalised Preview ->
// "Save My Plan" / Authenticate -> Trial or Purchase -> App. Before this, the
// order was account-first: an anonymous visitor was sent to pane-auth and
// could not see the builder, let alone a personalised preview, without
// signing in first.
//
// This is a reorder of existing capability, not a rebuild of it: the builder
// answers, the preview endpoint, the magic-link auth, and the checkout call
// are all untouched. What changed is which one a visitor with no session
// meets first, and where the athlete's answers live while they cross the
// auth round trip. These tests read the actual /start source and the actual
// preview engine, the same way the rest of this suite does -- there is no
// second, paraphrased description of the journey to drift out of sync.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('start.html');
const routeFn = () => /function route\(\)\{[^]*?\n  \}/.exec(SRC)[0];
const fnBody = (name) => {
  const re = new RegExp('function ' + name + '\\([^)]*\\)\\{[^]*?\\n  \\}');
  const m = re.exec(SRC);
  return m ? m[0] : null;
};

// ---------------------------------------------------------------------------
// 1 & 2. A NEW VISITOR REACHES THE BUILDER AND THE PREVIEW BEFORE IDENTITY
// ---------------------------------------------------------------------------
/* RETIRED (founder, 16 November 2026, item 9: "Can it be removed? Yeh"): the web builder on /start is removed; the plan is built in the app (/get). */
/* So the builder that was step one now lives in the app; a banked preview is
   still step two here, and saving it still step three. */
test('the preview is step two and saving the plan is step three, with no builder on the page', () => {
  assert.doesNotMatch(SRC, /id="pane-build"/, 'the web builder is back on /start');
  assert.doesNotMatch(SRC, /function submitBuild\(|function bldGoToStage\(|id="signin-instead"/);
  assert.match(SRC, /id="pane-preview"[^]*?Step two of three/, 'the preview is no longer step two');
  assert.match(SRC, /id="auth-step">Step three of three/, 'saving the plan is no longer step three');
});

test('"Change something" lets the banked plan go and sends the athlete to build in the app', () => {
  assert.match(SRC, /id="rebuild"[^>]*>Change Something</);
  const h = /\$\('rebuild'\)\.addEventListener\('click', function\(\)\{([^}]*)\}\);/.exec(SRC);
  assert.ok(h, 'the Change something handler has gone');
  assert.match(h[1], /clearPending\(\);\s*location\.replace\('\/get'\);/,
    'Change something no longer clears the banked plan and goes to /get');
  assert.doesNotMatch(h[1], /pane-build/);
});

test('a visitor with no session goes to install the app, not to sign-in', () => {
  const fn = routeFn();
  const noTok = /if \(!tok\)\{[^]*?\n    \}/.exec(fn)[0];
  assert.match(noTok, /location\.replace\('\/get'\)/, 'no-session no longer resolves to the app install page');
  assert.doesNotMatch(noTok, /show\('pane-auth'\)/, 'no-session still resolves to sign-in first');
});

/* "The build call no longer requires a session": retired with submitBuild() (item 9). */
test('the preview endpoint itself has no auth gate left to trip', () => {
  const src = read('api/_preview.js');
  assert.equal(/if \(!uid\) return S\.json\(res, 401/.test(src), false,
    'the preview still hard-gates on a signed-in caller');
});

// ---------------------------------------------------------------------------
// 3. BUILDER STATE AND THE PREVIEW SURVIVE THE AUTH ROUND TRIP
// ---------------------------------------------------------------------------
/* "A successful build banks the answers" and "the banked build carries every field": retired with
   submitBuild() (item 9). The app's own adoption of a banked build is unchanged. */
test('every route() branch that would otherwise show the builder checks for a banked preview first', () => {
  const fn = routeFn();
  const resumeChecks = (fn.match(/pending && pending\.preview/g) || []).length;
  // no-session, signed-in-without-access, and the network-failure fallback --
  // every one of them can be reached by an athlete who already has a preview.
  assert.ok(resumeChecks >= 3, 'a refresh or a slow network can lose a banked preview: only found ' +
    resumeChecks + ' resume check(s) in route()');
});

test('resuming a banked preview never re-asks the engine for one', () => {
  const showPreview = fnBody('showPreview');
  assert.ok(showPreview, 'showPreview() was not found');
  assert.doesNotMatch(showPreview, /apiCall\(|authed\(|fetch\(/,
    'showing a banked preview makes a network call -- it should only render what is already saved');
});

// ---------------------------------------------------------------------------
// 4. THE PLAN THE ATHLETE SAVES IS THE ONE THEY BUILT
// ---------------------------------------------------------------------------
test('the real engine produces the same preview shape /start renders, from the same inputs', () => {
  // start.html's mini-builder and /api/_preview.js speak the same input
  // contract; this proves the preview an athlete banks is generated by the
  // real training engine, not a second, decorative one.
  const app = require('./harness.js').loadApp({ pinnedDate: '2026-08-20T09:00:00Z' });
  const input = { purpose: 'race', distanceKey: 'half', weeks: 12, volume: 45,
                   activeDays: [1, 2, 3, 5, 6], longRunDay: 6, benchmarkSeconds: 2700 };
  const v = Preview.validate(input);
  assert.equal(v.ok, true, 'the exact shape /start sends failed validation: ' + JSON.stringify(v.errors));
  const g = Preview.generate(app, v.input);
  const s = Preview.summarise(app, g.days, g.block, v.input);
  assert.equal(s.goal.distance, 'half');
  assert.ok(s.programme.weeks > 0 && s.programme.totalSessions > 0);
  assert.ok(s.paces && s.paces.length > 0, 'the banked preview would have no paces to show');
});

// ---------------------------------------------------------------------------
// 5. NOTHING SERVER-SIDE IS CREATED BY BUILDING, PREVIEWING, OR BANKING
// ---------------------------------------------------------------------------
test('banking a preview is purely local -- no request is made to bank or resume one', () => {
  ['savePending', 'loadPending', 'clearPending'].forEach(name => {
    const body = fnBody(name);
    assert.ok(body, name + '() was not found');
    assert.doesNotMatch(body, /fetch\(/, name + '() reaches the network');
  });
});

// ---------------------------------------------------------------------------
// 6. AN ABANDONED ANONYMOUS BUILD IS INERT
// ---------------------------------------------------------------------------
test('loading a banked preview cannot throw on missing or corrupt storage', () => {
  const body = fnBody('loadPending');
  assert.match(body, /catch/, 'a corrupt or missing localStorage entry is not handled');
});

// ---------------------------------------------------------------------------
// 7. RETURNING ATHLETES STILL SIGN IN DIRECTLY
// ---------------------------------------------------------------------------
/* "Sign In is one tap away from the builder": retired with the builder (item 9). */
test('a signed-in athlete with access is still sent straight into the app', () => {
  const fn = routeFn();
  const seg = /if \(b\.access === true\)\{[^]*?\}/.exec(fn);
  assert.ok(seg, 'the access check no longer exists');
  assert.match(seg[0], /enter\(\)/, 'access no longer leads straight into the app');
});

// ---------------------------------------------------------------------------
// 9. THE TRIAL / PURCHASE HANDOFF IS UNCHANGED AND STILL GATED ON A SESSION
// ---------------------------------------------------------------------------
test('checkout still requires a real session and the trial step is hidden until one exists', () => {
  const trial = /\$\('trial'\)\.addEventListener\('click'[^]*?\n  \}\);/.exec(SRC)[0];
  assert.match(trial, /authed\('\/api\/checkout'/, 'checkout no longer uses the auth-required helper');
  const gate = fnBody('updatePreviewGate');
  assert.ok(gate, 'updatePreviewGate() was not found');
  assert.match(gate, /trial-card[^]*?authenticated/, 'the trial step is not gated on being signed in');
});

test('"Save My Plan" is the authentication moment, not "Create Account"', () => {
  const markup = String(SRC).replace(/<!--[^]*?-->/g, '');
  assert.match(markup, /Save My Plan/);
  assert.doesNotMatch(markup, /Create Account/i);
});
