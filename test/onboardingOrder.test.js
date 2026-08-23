'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Preview = require('../api/_preview.js');

// VALHALLA FIRST-TIME ONBOARDING ORDER
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
test('the builder is step one, the preview is step two, saving the plan is step three', () => {
  // The builder used to be a single condensed step, hence "Step one of
  // three"; it is now nine stages, so it carries its own "0X / 09" progress
  // indicator (bld-no) instead of that fixed label -- see bldGoToStage().
  // Preview and auth are untouched: they were never staged.
  assert.match(SRC, /id="pane-build"[^]*?id="bld-no"/, 'the builder no longer carries its own stage indicator');
  assert.match(SRC, /' \/ 0' \+ BLD_STAGES\.length;/,
    'the builder no longer counts nine stages of its own');
  assert.match(SRC, /bld-stage-label'\)\.textContent = BLD_STAGES\[bldCurrentStage\]\.name;/,
    'the current stage name is no longer shown alongside the count');
  assert.match(SRC, /id="pane-preview"[^]*?Step two of three/, 'the preview is no longer step two');
  assert.match(SRC, /id="auth-step">Step three of three/, 'saving the plan is no longer step three');
});

test('a visitor with no session goes to the builder, not to sign-in', () => {
  const fn = routeFn();
  const noTok = /if \(!tok\)\{[^]*?\n    \}/.exec(fn)[0];
  assert.match(noTok, /show\('pane-build'\)/, 'no-session no longer resolves to the builder');
  assert.doesNotMatch(noTok, /show\('pane-auth'\)/, 'no-session still resolves to sign-in first');
});

test('the build call no longer requires a session', () => {
  // authed() rejects with no_session when there is no token; apiCall() does
  // not. submitBuild() -- fired from the review stage's Continue button,
  // now that the builder is nine stages rather than one form -- must use
  // the one that works for a first-time, signed-out visitor.
  const build = fnBody('submitBuild');
  assert.ok(build, 'submitBuild() was not found');
  assert.match(build, /apiCall\('\/api\/preview'/, 'the builder still calls the auth-required helper');
  assert.doesNotMatch(build, /authed\('\/api\/preview'/);
});

test('the preview endpoint itself has no auth gate left to trip', () => {
  const src = read('api/_preview.js');
  assert.equal(/if \(!uid\) return S\.json\(res, 401/.test(src), false,
    'the preview still hard-gates on a signed-in caller');
});

// ---------------------------------------------------------------------------
// 3. BUILDER STATE AND THE PREVIEW SURVIVE THE AUTH ROUND TRIP
// ---------------------------------------------------------------------------
test('a successful build banks the answers and the preview before showing either', () => {
  const build = fnBody('submitBuild');
  assert.ok(build, 'submitBuild() was not found');
  const savedBeforeShown = build.indexOf('savePending(');
  const shown = build.indexOf('showPreview(');
  assert.ok(savedBeforeShown !== -1, 'nothing is banked on a successful build');
  assert.ok(shown !== -1, 'the preview is never rendered after building');
  assert.ok(savedBeforeShown < shown, 'the preview can be shown before it is safely banked');
});

test('the banked build carries every field the builder actually asked for', () => {
  const build = fnBody('submitBuild');
  assert.ok(build, 'submitBuild() was not found');
  const input = /var input = \{[^]*?\};/.exec(build)[0];
  // The full nine-stage field set -- hasEvent/raceDate (stage 03), experience
  // and benchmarkDistanceKey (stages 04/05) are new; the mini-builder never
  // asked them, which is exactly the drift this reconciliation closed.
  ['purpose', 'distanceKey', 'hasEvent', 'raceDate', 'weeks', 'volume', 'activeDays',
   'longRunDay', 'benchmarkSeconds', 'benchmarkDistanceKey', 'experience', 'goalAmbition']
    .forEach(field => assert.match(input, new RegExp(field), 'the banked answers are missing ' + field));
  assert.match(build, /savePending\(\{ input: input, preview: r\.body\.preview, build: r\.body\.build,/,
    'the preview is banked without the answers that produced it');
  assert.match(build, /savedAt: Date\.now\(\)/,
    'the banked build carries no timestamp, so it can never be aged out as abandoned');
});

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
test('"Sign In" is still one tap away from the builder, and it skips the builder entirely', () => {
  assert.match(SRC, /id="signin-instead"/, 'there is no direct sign-in route from the builder screen');
  const handler = /\$\('signin-instead'\)\.addEventListener\('click', function\(\)\{[^]*?\}\);/.exec(SRC)[0];
  assert.match(handler, /show\('pane-auth'\)/, 'the direct sign-in link no longer opens sign-in');
  assert.doesNotMatch(handler, /pane-build/, 'the direct sign-in link still routes through the builder');
});

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
