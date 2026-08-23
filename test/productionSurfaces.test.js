'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const P = require('../api/_products.js');

// PRODUCTION SURFACES — the athlete-facing side of a product that charges.
//
// These are not coaching tests. They pin the promises a paying customer is
// entitled to see and act on: what they are on, when it ends, how to stop, and
// what happens to their training if they do. Each one exists because the
// surface it describes was either absent, contradictory, or pointing somewhere
// the athlete could not reach.

const ROOT = path.join(__dirname, '..');
const RUNTIME = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CODE = RUNTIME.replace(/\/\*[^]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*$/gm, ' ');
const TODAY = '2026-08-21T09:00:00Z';

function signedIn(info){
  const a = loadApp({ pinnedDate: TODAY });
  a.showToast = () => {};
  a.SUPABASE_URL = 'https://x.supabase.co';
  a.SUPABASE_ANON_KEY = 'k';
  a.cloudSession = { access_token: 't', user_id: 'u', email: 'athlete@example.com' };
  a.entitlementInfo = info || null;
  return a;
}
const ENT = (over) => Object.assign({
  signed_in: true, commercial_required: true, state: 'active',
  access_until: '2026-12-01T00:00:00Z', checkout_configured: true
}, over || {});
const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ===========================================================================
// SUBSCRIPTION
// ===========================================================================
test('every subscription state says something true and offers a way to act', () => {
  const cases = [
    { name: 'trial',      info: ENT({ state: 'trial', access_until: '2026-09-04T00:00:00Z' }),
      says: /Trial until/, acts: /Cancel my subscription/ },
    { name: 'active',     info: ENT({}), says: /active until/, acts: /Cancel my subscription/ },
    { name: 'cancelling', info: ENT({ cancel_at_period_end: true }),
      says: /Cancelled .* paid up until/, acts: null },
    { name: 'grace',      info: ENT({ state: 'grace' }),
      says: /payment didn/i, acts: /Update payment details/ },
    { name: 'expired',    info: ENT({ state: 'expired', access_until: '2026-08-01T00:00:00Z' }),
      says: /Access ended on/, acts: /Subscribe again/ }
  ];
  cases.forEach(c => {
    const out = text(signedIn(c.info).renderSubscriptionCard());
    assert.ok(out, c.name + ' rendered nothing at all');
    assert.match(out, /Subscription/, c.name + ' has no heading');
    assert.match(out, c.says, c.name + ' does not say what state it is in: ' + out);
    if (c.acts) assert.match(out, c.acts, c.name + ' offers no way to act: ' + out);
  });
});

test('CANCELLING IS ALWAYS REACHABLE while a subscription is running', () => {
  /* A subscription with no visible way out is not a finished product. The
     route may be a billing portal or an email that reaches a human, but there
     must be one, and it must be on the same screen as the subscription. */
  ['trial', 'active'].forEach(state => {
    const out = text(signedIn(ENT({ state })).renderSubscriptionCard());
    assert.match(out, /Cancel my subscription|Manage or cancel/,
      'a running ' + state + ' offers no cancellation route');
    assert.match(out, /keep access until the end of the period/i,
      'and does not say what cancelling costs them: ' + out);
  });
});

test('an already-cancelling subscription is not asked to cancel again', () => {
  const out = text(signedIn(ENT({ cancel_at_period_end: true })).renderSubscriptionCard());
  assert.doesNotMatch(out, /Cancel my subscription/,
    'offering cancel again invites the athlete to doubt the first one worked');
});

test('a card cannot contradict itself', () => {
  /* "Active" beside "Valhalla is not charging for access yet" was a real
     rendering: the entitlement carries a state whether or not the commercial
     gate is on. */
  const off = text(signedIn(ENT({ commercial_required: false })).renderSubscriptionCard());
  assert.match(off, /not charging for access yet/);
  assert.doesNotMatch(off, /\bActive\b/, 'a status chip appeared with no subscription behind it');

  const beta = text(signedIn(ENT({ override: 'beta', state: 'expired' })).renderSubscriptionCard());
  assert.match(beta, /Nothing is being charged/,
    'a comped athlete must not be shown a subscription they are not paying for');
  assert.doesNotMatch(beta, /£/, 'nor a price');
});

test('nothing commercial is claimed before the server has answered', () => {
  assert.equal(signedIn(null).renderSubscriptionCard(), '',
    'a placeholder subscription is a claim');
  const out = loadApp({ pinnedDate: TODAY }).renderSubscriptionCard();
  assert.equal(out, '', 'a signed-out athlete has no subscription to describe');
});

test('the prices shown are the prices the billing catalogue charges', () => {
  const a = signedIn(ENT({ state: 'expired' }));
  const shown = {};
  a.PLAN_PRICING.forEach(p => { shown[p.period] = p.price; });
  const money = (offerCode) => {
    const o = P.offer(offerCode);
    return '£' + (o.priceMinor / 100).toFixed(2);
  };
  assert.equal(shown.monthly, money('STANDARD_MONTHLY'),
    'the app quotes a monthly price the billing system does not charge');
  assert.equal(shown.yearly, money('STANDARD_YEARLY'),
    'the app quotes a yearly price the billing system does not charge');
  assert.equal(a.TRIAL_DAYS_SHOWN, P.TRIAL_DAYS,
    'the app promises a trial length the products file does not define');
});

test('NATIVE STORE RULES: no web payment steering inside the app shell', () => {
  /* Apple and Google both forbid steering a customer to an external web
     payment for the same digital subscription. The Capacitor build must not
     carry a subscribe or manage link; it says where the subscription lives
     instead. */
  const a = signedIn(ENT({ state: 'expired' }));
  a.window.Capacitor = { isNativePlatform: () => true };
  const native = a.renderSubscriptionCard();

  /* THE RULE IS ABOUT CONTROLS, NOT PROSE. What the stores forbid is a link
     or a button that takes the customer to an external purchase; telling them
     where their subscription is managed is not only allowed, it is the useful
     thing to say. An earlier version of this test scanned the rendered TEXT
     for "Manage or cancel" and matched its own explanatory sentence -- so it
     failed on the correct behaviour. It reads the markup now. */
  assert.doesNotMatch(native, /data-action="subscription-resubscribe"/,
    'the native shell offers a button into a web checkout');
  assert.doesNotMatch(native, /<a[^>]+href="https?:/,
    'the native shell links out to an external payment page');
  assert.match(text(native), /where you bought it/i,
    'and must still say where the subscription actually lives');

  a.window.Capacitor = { isNativePlatform: () => false };
  const web = a.renderSubscriptionCard();
  assert.match(web, /data-action="subscription-resubscribe"/,
    'the web build must still be able to sell');
  assert.match(text(web), /Subscribe again/);
});

// ===========================================================================
// RESET PLAN IS NOT DELETE ACCOUNT
// ===========================================================================
test('the reversible act and the permanent one do not look alike', () => {
  const a = signedIn(ENT({}));
  buildPlan(a, { weeks: 10, startDate: '2026-08-01', distanceKey: '10k' });
  const settings = a.renderSettingsHubView();

  const resetBtn = /<button[^>]*data-action="reset-plan"[^>]*>/.exec(settings);
  assert.ok(resetBtn, 'Reset Plan is missing from Settings');
  const deleteBtn = /<button[^>]*data-action="cloud-delete-account"[^>]*>/.exec(settings)[0];

  assert.match(deleteBtn, /btn-danger/, 'deleting an account must keep the danger treatment');
  assert.doesNotMatch(resetBtn[0], /btn-danger/,
    'Reset Plan keeps every logged run — dressing it as destruction makes the ' +
    'genuinely destructive control look ordinary by comparison');
  assert.match(settings, /class="danger-zone"/,
    'the permanent control needs more than a colour to set it apart');
  assert.match(text(settings), /This is not the same as resetting your plan/,
    'the distinction must be stated, not merely implied');
});

test('EVERY Reset Plan control, not just the one on the hub', () => {
  /* Reset Plan is offered twice -- on the Settings hub view and inside the
     older Settings modal -- and the first version of the test above read only
     the hub. Restoring the danger treatment on the modal's copy changed
     nothing any test could see, which is how one of two identical controls
     drifts away from the other. Scanned at source, so both are covered
     wherever they live. */
  const buttons = CODE.match(/<button[^>]*data-action=\\?"reset-plan\\?"[^>]*>/g) || [];
  assert.ok(buttons.length >= 2,
    'expected Reset Plan on both Settings surfaces, found ' + buttons.length);
  buttons.forEach((b, i) => {
    assert.doesNotMatch(b, /btn-danger/, 'Reset Plan #' + (i + 1) + ' still reads as destruction');
    assert.match(b, /btn-ghost/, 'Reset Plan #' + (i + 1) + ' has lost its ordinary treatment');
  });
  const deletes = CODE.match(/<button[^>]*data-action=\\?"cloud-delete-account\\?"[^>]*>/g) || [];
  assert.ok(deletes.length >= 1);
  deletes.forEach(b => assert.match(b, /btn-danger/,
    'account deletion must keep the danger treatment everywhere it appears'));
});

// ===========================================================================
// NO DEAD ENDS
// ===========================================================================
test('a failed sign-in never points at a screen the athlete cannot reach', () => {
  /* Settings lives on the bottom nav, and the nav is hidden in both no-plan
     states -- so "request a new one from Settings" was addressed to precisely
     the athlete who could not get there. */
  const noPlan = loadApp({ pinnedDate: TODAY });
  assert.equal(noPlan.appStateAllowsNav(), false, 'precondition: no nav without a plan');
  const stranded = noPlan.cloudAuthErrorCopy('otp_expired');
  assert.doesNotMatch(stranded, /Settings/,
    'the athlete was sent to a screen that is not on their device: ' + stranded);
  assert.match(stranded, /start/, 'and given nowhere else to go');

  const withPlan = loadApp({ pinnedDate: TODAY });
  buildPlan(withPlan, { weeks: 10, startDate: '2026-08-01', distanceKey: '10k' });
  assert.equal(withPlan.appStateAllowsNav(), true);
  assert.match(withPlan.cloudAuthErrorCopy('otp_expired'), /Settings/,
    'where Settings IS reachable it is still the shortest route');

  ['otp_expired', 'access_denied', 'anything_else'].forEach(code => {
    const said = withPlan.cloudAuthErrorCopy(code);
    assert.ok(said.length > 20, code + ' produced no usable sentence');
    assert.match(said, /—/, code + ' gives a reason but no next step');
  });
});

// ===========================================================================
// LEGAL AND SUPPORT
// ===========================================================================
test('a paying customer is not told they are a beta tester', () => {
  const a = signedIn(ENT({}));
  assert.equal(a.legalTermsLabel(), 'Terms of Service');
  assert.match(a.legalCoverSentence(), /subscription/i);

  const beta = signedIn(ENT({ commercial_required: false }));
  assert.equal(beta.legalTermsLabel(), 'Private Beta Terms',
    'while nobody is charged, the beta wording is the true one');
});

test('Settings carries the whole legal and support surface', () => {
  const a = signedIn(ENT({}));
  buildPlan(a, { weeks: 10, startDate: '2026-08-01', distanceKey: '10k' });
  const settings = a.renderSettingsHubView();
  assert.match(settings, new RegExp(a.LEGAL_URLS.privacy.replace(/[/.]/g, '\\$&')));
  assert.match(settings, new RegExp(a.LEGAL_URLS.terms.replace(/[/.]/g, '\\$&')));
  assert.match(settings, /mailto:support@velvetviking\.co\.uk/);
  const said = text(settings);
  assert.match(said, /Cancelling\./, 'cancellation information is missing from Settings');
  assert.match(said, /nothing further is charged/);
  assert.match(said, /never deletes your training/);
});

test('no link in the runtime points at nothing', () => {
  /* Every href must be a real destination: a mail address, one of the two
     legal documents, or a route this deployment serves. A "#" or an empty
     href is a placeholder, and placeholders are what this pass removes. */
  const hrefs = (CODE.match(/href="([^"]*)"/g) || []).map(h => h.slice(6, -1));
  assert.ok(hrefs.length > 3, 'the scan found no links at all — it is not working');
  const served = ['/privacy', '/terms', '/start', '/get', '/account'];
  hrefs.forEach(h => {
    if (h.indexOf("'+") !== -1 || h.indexOf('+LEGAL') !== -1) return;  // built at render time
    assert.notEqual(h, '', 'an empty href is a placeholder');
    assert.notEqual(h, '#', 'a "#" href is a placeholder');
    if (h[0] === '/') assert.ok(served.indexOf(h) !== -1 || h.indexOf('/assets/') === 0,
      'unrouted internal link: ' + h);
  });
});

// ===========================================================================
// GARMIN AND STRAVA TELL THE TRUTH
// ===========================================================================
test('Garmin never offers a Connect button this deployment cannot honour', () => {
  const a = signedIn(ENT({}));
  a.garminCapability = null;                       // the fail-closed default
  const closed = a.renderGarminSection();
  assert.doesNotMatch(closed, /data-action="garmin-connect"/,
    'a Connect button appeared before the server said Garmin was available');
  assert.match(text(closed), /Not yet available/);

  a.garminCapability = { available: true, connected: false };
  assert.match(a.renderGarminSection(), /data-action="garmin-connect"/,
    'and once it IS available, connecting must be offered');
});

test('the app makes no claim about a Garmin feature it does not have', () => {
  const said = text(CODE);
  assert.doesNotMatch(said, /Garmin[^.]{0,40}(coming soon|next month|shortly)/i,
    'a delivery promise was made for an integration that is not switched on');
});

// ===========================================================================
// RELEASE PACKAGING — WHAT THE APK ACTUALLY POINTS AT
// ===========================================================================
const CANONICAL_HOST = 'app.velvetviking.co.uk';

test('the native shell loads the canonical production domain, not a preview host', () => {
  /* THE DEFECT THIS PINS. Both capacitor.config.json files pointed the APK's
     WebView at the *.vercel.app deployment host while the auth callback,
     VVV_SITE_ORIGIN and the Supabase Site URL had all moved to the canonical
     domain. Different origin means different localStorage: an athlete who
     signed in on the web was not signed in inside the app, and the sign-in
     link their email carried pointed at a host the app did not claim. */
  /* THE SOURCE OF TRUTH IS THE ROOT CONFIG, and it is the only one committed.
     android/app/src/main/assets/capacitor.config.json is GITIGNORED -- `cap
     sync` generates it from this file. Asserting it unconditionally made this
     test fail in any fresh clone, which has never run a sync and does not have
     the file at all; it passed only on a machine that happened to have a stale
     build artefact lying around. So the generated copy is checked when it is
     present, because a STALE one is a real defect -- that copy is what the
     built APK reads, and it is how the wrong host shipped in the first place --
     and its absence is not a failure. */
  const check = (f, cfg) => {
    assert.equal(cfg.appId, 'com.velvetviking.valhalla', f + ' has the wrong package identity');
    assert.ok(cfg.server && cfg.server.url, f + ' has no server url');
    assert.equal(cfg.server.url, 'https://' + CANONICAL_HOST,
      f + ' ships pointing at ' + cfg.server.url);
    assert.doesNotMatch(cfg.server.url, /vercel\.app|localhost|127\.0\.0\.1|ngrok/,
      f + ' ships a preview or development endpoint');
  };

  const root = 'capacitor.config.json';
  check(root, JSON.parse(fs.readFileSync(path.join(ROOT, root), 'utf8')));

  const generated = 'android/app/src/main/assets/capacitor.config.json';
  const at = path.join(ROOT, generated);
  if (fs.existsSync(at)){
    check(generated, JSON.parse(fs.readFileSync(at, 'utf8')));
  }
});

test('the generated Capacitor config is not committed, so it cannot go stale in git', () => {
  // It is a build artefact. Committing it creates a second place the APK's
  // origin is written down, and the second place is the one nobody edits.
  const ignore = fs.readFileSync(path.join(ROOT, 'android', '.gitignore'), 'utf8');
  assert.match(ignore, /app\/src\/main\/assets\/capacitor\.config\.json/);
  const tracked = require('child_process')
    .execSync('git ls-files android/app/src/main/assets/capacitor.config.json', { cwd: ROOT })
    .toString().trim();
  assert.equal(tracked, '', 'the generated config is tracked; run cap sync instead of committing it');
});

test('App Links claim the domain sign-in links are actually sent to', () => {
  const manifest = fs.readFileSync(
    path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const verified = manifest.slice(manifest.indexOf('android:autoVerify="true"'));
  const hosts = (verified.match(/android:host="([^"]+)"/g) || []).map(h => h.slice(14, -1));
  assert.ok(hosts.indexOf(CANONICAL_HOST) !== -1,
    'the verified filter does not claim ' + CANONICAL_HOST + ' — found ' + hosts.join(', '));
  /* The custom scheme is the fallback that works without domain verification
     and must survive every change to the filters above it. */
  assert.match(manifest, /android:scheme="com\.velvetviking\.valhalla"/);
  assert.match(manifest, /android:host="auth"/);
});

test('no debug or cleartext escape hatch ships in the release manifest', () => {
  const manifest = fs.readFileSync(
    path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(manifest, /android:usesCleartextTraffic="true"/,
    'cleartext HTTP is enabled in the shipping manifest');
  assert.doesNotMatch(manifest, /android:debuggable="true"/);
});

test('the signing pipeline is configured for a real release key', () => {
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
  assert.match(gradle, /applicationId "com\.velvetviking\.valhalla"/);
  assert.match(gradle, /signingConfigs\s*\{/, 'no signing configuration at all');
  assert.match(gradle, /versionCode\s+\d+/);
  assert.match(gradle, /versionName\s+"/);
  /* A keystore password committed to the repository would be the whole key. */
  assert.doesNotMatch(gradle, /storePassword\s+"(?!\s*$)[A-Za-z0-9]/,
    'a literal keystore password is committed');
});

// ===========================================================================
// THE ENTRY JOURNEY, AS SOURCE
//
// The full state matrix is driven in a real browser (see the commissioning
// notes); what is pinned here is that each branch and each explanation exists
// at all, because a browser run is not part of the suite and a deleted branch
// would otherwise go unnoticed until an athlete found it.
// ===========================================================================
const START = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');

test('/start routes every commercial state, and explains every failure', () => {
  /* access -> the product; expired -> the locked shell; signed in without a
     subscription -> the builder; anything else -> sign in. */
  assert.match(START, /if \(b\.access === true\)\{ enter\(\); return; \}/,
    'an athlete with access must not be shown acquisition screens again');
  assert.match(START, /reason === 'expired'[^]*?show\('pane-locked'\)/,
    'an expired athlete needs the locked shell, not the builder');
  assert.match(START, /show\('pane-build'\)/);

  /* Four failures, four explanations. A blank form with no reason is the
     defect these each exist to prevent. */
  assert.match(START, /r\.status >= 500/,
    'a server error is indistinguishable from "not signed in" without this');
  assert.match(START, /having a moment/, 'a 5xx must say what happened');
  assert.match(START, /could not reach Valhalla/, 'a timeout must say what happened');
  assert.match(START, /otp_expired: 'That sign-in link has expired/);
  assert.match(START, /access_denied: 'That sign-in link has already been used/);
  assert.match(START, /within\(10000,/, 'a hung request must be raced against a deadline');
});

test('/start starts no trial by accident', () => {
  /* Nothing on the entry page may spend the allowance. The only commercial
     act is the one the athlete presses, and it goes through checkout. */
  const scripts = START.slice(START.indexOf('<script>'));
  assert.equal(/\/api\/trial/.test(scripts), false,
    'the standalone trial endpoint is gone; nothing may call it');
  const auto = /addEventListener\('load'|window\.onload|setTimeout\([^)]*checkout/i;
  assert.equal(auto.test(scripts), false, 'a checkout is being opened without a press');
  assert.match(scripts, /\$\('trial'\)\.addEventListener\('click'/,
    'the commercial act must be a deliberate press');
});

test('/start offers every objective the app builds', () => {
  // The nine-stage wizard renders its purpose/distance pickers from
  // window.BUILDER_SPEC at runtime (renderGoalStage()/renderDistanceStage()
  // map over BS.purposes.order / BS.distances.order), not a static list of
  // value="..." options -- so what proves parity is that both stages read
  // the canonical spec's own arrays, and that those arrays are themselves
  // the app's real BUILDER_PURPOSE_ORDER/DISTANCE_ORDER (asserted by
  // test/builderSpecParity.test.js). A literal per-value grep would pass on
  // dead markup; reading the actual source of each value is what cannot.
  const app = loadApp({ pinnedDate: TODAY });
  const goalFn = START.slice(START.indexOf('function renderGoalStage'));
  const goalBody = goalFn.slice(0, goalFn.indexOf('\n  }\n'));
  assert.match(goalBody, /BS\.purposes\.order\.map\(/,
    '/start\'s purpose picker no longer reads the canonical spec\'s own purpose order');
  const distFn = START.slice(START.indexOf('function renderDistanceStage'));
  const distBody = distFn.slice(0, distFn.indexOf('\n  }\n'));
  assert.match(distBody, /BS\.distances\.order\.map\(/,
    '/start\'s distance picker no longer reads the canonical spec\'s own distance order');
  // JSON.stringify rather than assert.deepEqual: these arrays were built
  // inside the VM sandbox, and Node's strict assertions treat that as a
  // different realm even when every value matches (same as elsewhere in
  // this suite -- see continuousBuild.test.js's own comment on this).
  assert.equal(JSON.stringify(app.BUILDER_SPEC.purposes.order), JSON.stringify(app.BUILDER_PURPOSE_ORDER),
    'the canonical spec\'s purpose order no longer matches the app\'s own');
  assert.equal(JSON.stringify(app.BUILDER_SPEC.distances.order), JSON.stringify(app.DISTANCE_ORDER),
    'the canonical spec\'s distance order no longer matches the app\'s own');
});
