'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// THE COMMISSIONING FAILURE.
//
// A magic link requested from https://app.velvetviking.co.uk/start arrived
// pointing at https://velvet-viking-valhalla-1.vercel.app/ — wrong host, wrong
// path — and the athlete was told the link had expired.
//
// safeRedirect() validated the requested redirect against ONE origin:
// siteOrigin(req), which is VVV_SITE_ORIGIN when pinned and the forwarded Host
// otherwise. Once the product gained a canonical custom domain those stopped
// being the same thing, the canonical redirect matched neither branch, and the
// function fell through to `origin + '/'` — a path vercel.json routes to
// /api/app, the protected runtime, rather than to the entry journey.
//
// These tests drive the real exported decision, not a paraphrase of it.

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'api', 'beta-signin.js'));

const CANONICAL = 'https://app.velvetviking.co.uk';
const DEPLOY = 'https://velvet-viking-valhalla-1.vercel.app';
const reqOn = host => ({ headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': host } });

// ===========================================================================
// WEB CALLBACK
// ===========================================================================
test('a browser link comes back to the canonical app origin', () => {
  const origins = B.webOrigins(reqOn('app.velvetviking.co.uk'), { VVV_SITE_ORIGIN: CANONICAL });
  assert.equal(B.safeRedirect(CANONICAL + '/start', origins), CANONICAL + '/start');
});

test('THE REGRESSION: a canonical redirect is not discarded for the deployment host', () => {
  /* The exact shape of the live failure -- the request reaches the function
     through the deployment host, and the browser asks to come back to the
     canonical one. Before the fix this returned DEPLOY + '/'. */
  const origins = B.webOrigins(reqOn('velvet-viking-valhalla-1.vercel.app'),
                               { VVV_SITE_ORIGIN: CANONICAL });
  const got = B.safeRedirect(CANONICAL + '/start', origins);
  assert.equal(got, CANONICAL + '/start',
    'the canonical redirect was thrown away in favour of the deployment host');
  assert.ok(got.indexOf('.vercel.app') === -1, 'the link points at a deployment host');
});

test('the fallback is the entry journey, never the app root', () => {
  /* '/' is routed to /api/app -- the protected runtime behind the account
     gate. A magic link landing there is at the wrong end of the product. */
  const origins = B.webOrigins(reqOn('app.velvetviking.co.uk'), { VVV_SITE_ORIGIN: CANONICAL });
  const got = B.safeRedirect('https://attacker.example/steal', origins);
  assert.equal(got, CANONICAL + '/start');
  assert.notEqual(got, CANONICAL + '/', 'the fallback still lands on the protected runtime');
  assert.equal(B.ENTRY_PATH, '/start');
});

test('an attacker-supplied redirect is still refused', () => {
  const origins = B.webOrigins(reqOn('app.velvetviking.co.uk'), { VVV_SITE_ORIGIN: CANONICAL });
  ['https://evil.example/x',
   'https://app.velvetviking.co.uk.evil.example/x',
   'http://app.velvetviking.co.uk/x',           // wrong scheme
   '//evil.example',
   'javascript:alert(1)'].forEach(bad => {
    const got = B.safeRedirect(bad, origins);
    assert.equal(got, CANONICAL + '/start', bad + ' was accepted as a redirect target');
  });
});

test('no wildcard was introduced to make this work', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'beta-signin.js'), 'utf8');
  const fn = /function safeRedirect\([^]*?\n\}/.exec(src)[0];
  [/\*/, /indexOf\('\.'\)/, /endsWith\(/, /RegExp\(/].forEach(re =>
    assert.doesNotMatch(fn, re, 'the redirect check has been loosened rather than corrected'));
});

// ===========================================================================
// NO DEPLOYMENT HOST LEAK
// ===========================================================================
test('no deployment host is hardcoded as a browser callback anywhere', () => {
  ['api/beta-signin.js', 'start.html'].forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /velvet-viking-valhalla-\d\.vercel\.app/,
      f + ' hardcodes a deployment host');
  });
});

/* UPDATED (founder, 18 November 2026: "Remove the old start."). /start no
   longer requests a link of its own; it forwards to the root of the origin
   it was reached on, and the app asks to come back to that same origin. */
test('/start forwards to its own origin, and the app asks to come back to its own', () => {
  const src = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');
  assert.match(src, /var dest = '\/' \+/, '/start forwards somewhere other than its own root');
  const app = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(app, /: \(window\.location\.origin \+ window\.location\.pathname\);/,
    'the app no longer requests its own origin');
});

// ===========================================================================
// ANDROID
// ===========================================================================
test('the Android custom scheme still survives every origin configuration', () => {
  assert.equal(B.NATIVE_REDIRECT, 'com.velvetviking.valhalla://auth');
  [{ VVV_SITE_ORIGIN: CANONICAL }, {}, { VVV_SITE_ORIGIN: DEPLOY }].forEach(env => {
    const origins = B.webOrigins(reqOn('app.velvetviking.co.uk'), env);
    assert.equal(B.safeRedirect(B.NATIVE_REDIRECT, origins), B.NATIVE_REDIRECT,
      'the native deep link was rewritten to a web origin');
  });
});

test('the native scheme is checked before any origin, so it can never be rewritten', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'beta-signin.js'), 'utf8');
  const fn = /function safeRedirect\([^]*?\n\}/.exec(src)[0];
  assert.ok(fn.indexOf('NATIVE_REDIRECT') < fn.indexOf('for ('),
    'the origin loop now runs before the native check');
});

test('the Android intent filter that receives it is intact', () => {
  const manifest = path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!fs.existsSync(manifest)) return;    // manifest not present in this checkout
  const src = fs.readFileSync(manifest, 'utf8');
  assert.match(src, /com\.velvetviking\.valhalla/,
    'the custom scheme is no longer registered on Android');
});

// ===========================================================================
// PREVIEWS AND LOCALHOST
// ===========================================================================
test('an unpinned deployment still works from its own host', () => {
  const origins = B.webOrigins(reqOn('vvv-git-preview-abc.vercel.app'), {});
  assert.equal(B.safeRedirect('https://vvv-git-preview-abc.vercel.app/start', origins),
    'https://vvv-git-preview-abc.vercel.app/start',
    'a preview deployment can no longer sign anybody in');
});

test('localhost keeps its scheme', () => {
  const origins = B.webOrigins({ headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' } }, {});
  assert.equal(B.safeRedirect('http://localhost:3000/start', origins), 'http://localhost:3000/start');
});

test('both the canonical origin and the request origin are accepted', () => {
  const origins = B.webOrigins(reqOn('velvet-viking-valhalla-1.vercel.app'),
                               { VVV_SITE_ORIGIN: CANONICAL });
  assert.equal(origins.length, 2);
  assert.equal(origins[0], CANONICAL, 'the canonical origin must be first — it is the fallback');
  assert.equal(B.safeRedirect(DEPLOY + '/start', origins), DEPLOY + '/start',
    'a link opened on the deployment host during commissioning is refused');
});

// ===========================================================================
// CALLBACK HANDLING, NOW AT THE ROOT
// UPDATED (founder, 18 November 2026: "Remove the old start."). /start used
// to consume the link itself. It now forwards the fragment and the query to
// the root, where the app (and, for a stale cookie, /account) does the same
// work; these assert it there.
// ===========================================================================
const RUNTIME_SRC = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const runtimeFn = name => {
  const at = RUNTIME_SRC.indexOf('function ' + name + '(');
  assert.ok(at !== -1, name + '() is missing');
  let depth = 0, i = RUNTIME_SRC.indexOf('{', at);
  for (; i < RUNTIME_SRC.length; i++){
    if (RUNTIME_SRC[i] === '{') depth++;
    else if (RUNTIME_SRC[i] === '}' && --depth === 0) break;
  }
  return RUNTIME_SRC.slice(at, i + 1);
};
test('a link that lands on /start reaches the root with its tokens, and the root establishes the session', () => {
  const start = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');
  assert.match(start, /\(location\.search \|\| ''\) \+ \(location\.hash \|\| ''\)/,
    'the forward drops the fragment the tokens are in');
  assert.match(runtimeFn('cloudConsumeAuthHash'), /cloudSetSession\(\{/, 'the root does not take the tokens');
  assert.match(runtimeFn('establishDeliverySession'), /fetch\(ENTITLEMENT_ENDPOINT/);
  assert.match(RUNTIME_SRC, /var ENTITLEMENT_ENDPOINT = '\/api\/session';/, 'the root does not establish a server session');
});

test('CALLBACK CLEANUP: tokens are stripped from the visible URL', () => {
  assert.match(runtimeFn('cloudConsumeAuthHash'), /window\.history\.replaceState\(null, '', path \+ search\)/,
    'the token is left in the address bar');
  const account = fs.readFileSync(path.join(ROOT, 'account.html'), 'utf8');
  const strip = /function stripHash\(\)\{[^]*?\n  \}/.exec(account)[0];
  assert.match(strip, /history\.replaceState/);
  assert.match(strip, /location\.hash = ''/, 'no fallback when replaceState is unavailable');
});

test('a refused link says why instead of showing a blank form', () => {
  const fn = runtimeFn('cloudConsumeAuthHash');
  assert.match(fn, /showToast\(cloudAuthErrorCopy\(p\.error_code, p\.error_description\)\)/,
    'the root ignores GoTrue error parameters');
  assert.match(RUNTIME_SRC, /otp_expired: 'That sign-in link has expired'/, 'an expired link has no specific message');
  assert.doesNotMatch(runtimeFn('cloudAuthErrorCopy'), /return [^;]*description[^;]*;/,
    'the provider\u2019s own error text is being shown to the athlete');
});

// ===========================================================================
// THE GATEWAY — STEP TWO
// ===========================================================================
const APP = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');

/* WHAT THE ATHLETE READS, NOT WHAT THE AUTHOR WROTE ABOUT IT.

   An extracted render block is source, and source carries the comment that
   explains it. A guard looking for "the trial has begun" matches the comment
   saying that sentence must never appear just as readily as it would match the
   sentence itself -- so the assertion stops describing the rendered markup and
   starts describing the prose next to it. Strip block comments first and the
   guards scan the strings that actually reach the screen. Only block comments:
   `//` cannot be removed safely from a line that also contains a URL.

   The \uXXXX escapes are decoded for the same reason. This file keeps its
   source ASCII, so an em-dash is spelt `—` on disk and rendered as `—`
   in the browser; a guard reading the source sees the spelling, and copy
   pinned as the words an athlete reads would never match it. */
const markup = s => String(s)
  .replace(/\/\*[^]*?\*\//g, '')
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

test('DUPLICATE AUTH IS GONE from the builder gateway', () => {
  assert.doesNotMatch(APP, /Sign in or restore a plan/,
    'the second sign-in entry point is still on the gateway');
  assert.doesNotMatch(APP, /Trained with Velvet Viking before/,
    'the returning-athlete prompt still competes with /start');
});

test('the gateway states its place in the journey', () => {
  assert.match(APP, /Step two of three/i, 'the gateway does not say where it is');
  assert.match(APP, /Build Your Training Block/);
  assert.match(APP, /Build My Plan/, 'the primary action is gone');
});

/* THE APPROVED WORDS, PINNED AS WORDS.

   The gateway shipped with a paraphrase of this paragraph -- same meaning,
   different sentence -- and the drift was only caught by a human reading the
   screen against the approved copy. Copy that has been approved verbatim is
   pinned verbatim, so the next paraphrase is caught by the suite instead.

   It also happens to be the more honest sentence: "goal distance", "current
   weekly mileage" and "a recent benchmark time" are the three inputs the
   builder genuinely asks for (#f-volume is labelled "Current Weekly Volume",
   and "Recent benchmark" is its own section), and a pace-zoned block is what
   comes back. Each clause is checkable against the builder. */
const APPROVED_GATEWAY_BODY =
  'Pick a goal distance, your current weekly mileage and a recent benchmark ' +
  'time. Get a full pace-zoned training block for anything from a 5K ' +
  'to a 50K ultra. An event is optional.';

test('the approved gateway paragraph is rendered word for word', () => {
  const fn = markup(/setup-cta setup-step[^]*?<\/div><\/div>';/.exec(APP)[0]);
  assert.ok(fn.indexOf('<p>' + APPROVED_GATEWAY_BODY + '</p>') !== -1,
    'the gateway paragraph has drifted from the approved copy');
  ['Current Weekly Volume', 'Recent benchmark'].forEach(field =>
    assert.match(APP, new RegExp(field),
      'the paragraph promises an input the builder no longer asks for: ' + field));
});

test('the gateway makes the preview promise and no payment claim', () => {
  /* Anchored on the gateway's own marker class. `if (!state.setup){` appears
     more than once in the runtime, and the first match is a different guard
     entirely -- extracting by that would have tested the wrong block. */
  const found = /setup-cta setup-step[^]*?<\/div><\/div>';/.exec(APP);
  assert.ok(found, 'the gateway render was not found');
  const fn = markup(found[0]);
  assert.match(fn, /before your 7-day trial begins/,
    'the preview-before-trial promise is missing');
  [/card/i, /\bpay\b/i, /£/, /billing/i, /trial has (begun|started)/i].forEach(re =>
    assert.doesNotMatch(fn, re, 'the gateway mentions payment or implies the trial started'));
});

test('OPENING STEP TWO CONSUMES NOTHING — no trial is started by the gateway', () => {
  const fn = markup(/setup-cta setup-step[^]*?<\/div><\/div>';/.exec(APP)[0]);
  [/trial/i.test(fn) && !/7-day trial begins/.test(fn)].forEach(bad =>
    assert.equal(bad, false, 'the gateway touches trial state'));
  [/consumeTrial/, /startTrial/, /entitlement/i, /\/api\/trial/].forEach(re =>
    assert.doesNotMatch(fn, re, 'the gateway reaches into the commercial core'));
});

test('the builder itself is untouched by this gateway change', () => {
  /* The gateway is the door. Behind it, open-setup still opens the same
     builder, and nothing about generation moved. */
  assert.match(APP, /data-action="open-setup"/, 'the gateway no longer opens the builder');
  assert.match(APP, /function handleGeneratePlan\(\)/);
  assert.match(APP, /function buildBlockWeeks\(/);
  assert.match(APP, /function buildDaysFromWeeks\(/);
});

// ===========================================================================
// ROUTING — ONE OWNER
// UPDATED (founder, 18 November 2026: "Remove the old start."). The owner is
// the gate (api/app.js) and the journey it serves, no longer /start.
// ===========================================================================
const GATE = fs.readFileSync(path.join(ROOT, 'api', 'app.js'), 'utf8');
test('/start owns no commercial-entry state; the gate and the journey own them all', () => {
  const src = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8').replace(/<!--[^]*?-->/g, '');
  ['pane-auth', 'pane-sent', 'pane-preview', 'pane-locked'].forEach(p =>
    assert.equal(src.indexOf(p), -1, '/start still has ' + p));
  assert.match(GATE, /if \(!leaseId\)\{ stamp\(res, 'journey'\); return serveJourneyOnly\(res\); \}/,
    'a visitor with no session is not given the journey');
  assert.match(GATE, /return toShell\(res, decision\.reason === 'no_account' \? 'signin' : 'locked'\);/,
    'an athlete without access has nowhere to go');
  assert.match(GATE, /stamp\(res, 'granted'\);\s*serveRuntime\(req, res\);/, 'an entitled athlete is not admitted');
});

test('an athlete with access is not shown acquisition screens again', () => {
  /* The journey reads a subscription the server reports as the end of the
     trial step, so an entitled athlete goes on to Welcome to SACORO. */
  assert.match(runtimeFn('journeyStep'), /if \(step === 'trial' && journeySubscribed\(\)\) step = 'arrive';/);
  assert.match(runtimeFn('journeySubscribed'), /subscription_\(trial\|active\|grace\)/);
});

test('an anonymous visitor is sent into the journey, not to sign-in', () => {
  const src = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');
  assert.match(src, /location\.replace\(dest\)/, 'a visitor to /start is not sent on');
  assert.doesNotMatch(src.replace(/<!--[^]*?-->/g, ''), /type="email"/, '/start still asks a visitor to sign in');
  assert.match(GATE, /return serveJourneyOnly\(res\)/);
});

test('sign-in is still here for a returning athlete', () => {
  /* On the journey's first screen, Existing Member; and on /account. */
  assert.match(RUNTIME_SRC, /data-action="journey-member">Existing Member</);
  assert.match(RUNTIME_SRC, /case 'journey-member': return openSigninSheet\(\);/);
  const account = fs.readFileSync(path.join(ROOT, 'account.html'), 'utf8');
  assert.match(account, /<h1 id="headline">Sign in to SACORO<\/h1>/);
});

test('the entry path is stated once and routed once', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const hit = (v.routes || []).filter(r => r.src === '/start');
  assert.equal(hit.length, 1, '/start is routed ' + hit.length + ' times');
  assert.equal(hit[0].dest, '/start.html');
});
