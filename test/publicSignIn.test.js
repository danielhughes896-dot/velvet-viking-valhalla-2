'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../api/_access.js');
const E = require('../api/_entitlement.js');
const Ck = require('../api/_checkout.js');
const Prod = require('../api/_products.js');

/* PUBLIC AUTHENTICATION, COMMERCIAL ACCESS
 * ===========================================================================
 * THE SEPARATION THIS FILE EXISTS TO HOLD. Anyone may prove they own an email
 * address. Nobody reaches Valhalla without a commercial entitlement. Those are
 * different questions decided in different places, and conflating them is what
 * kept public signup shut for a fortnight after the database gate was dropped.
 *
 * WHAT WENT WRONG, because it is the thing most likely to come back.
 * supabase-commercial-cutover.sql removed beta_allowlist_gate from auth.users,
 * so the DATABASE stopped refusing new accounts. /api/beta-signin went on
 * reading the same allowlist itself and answering 403 not_in_beta, so the
 * APPLICATION still did. Every account anyone could observe was allowlisted, so
 * nothing failed and nothing looked wrong: the founder could sign in, the
 * grandfathered cohort could sign in, and the only person who could not was a
 * customer who did not exist yet.
 *
 * That is the shape of the bug this file is here to prevent -- a gate that is
 * invisible precisely because everybody testing it is already through it.
 */

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const NOW = new Date('2026-09-01T09:00:00Z');
const UID = 'a1111111-1111-1111-1111-111111111111';
const LIVE = { accountRequired: true, commercialRequired: true };
const row = (o) => Object.assign({ state: 'expired', tier: 'standard', access_until: null,
  cancel_at_period_end: false, override: null, override_expires_at: null }, o || {});
const decide = (ent) => A.resolveAccess(Object.assign({ now: NOW, uid: UID, entitlement: ent }, LIVE));

// ---------------------------------------------------------------------------
// 1. SIGNING IN IS PUBLIC
// ---------------------------------------------------------------------------

test('the sign-in route consults no allowlist at all', () => {
  /* Structural and absolute: not "it checks something else first", but that
     the words are not in the executable file. A comment may still explain the
     history -- that is what the comment strip is for. */
  const src = code(read('api/beta-signin.js'));
  assert.ok(!/beta_allowlist/.test(src), 'the sign-in route still reads the allowlist');
  assert.ok(!/isApproved/.test(src), 'the allowlist reader survives');
  assert.ok(!/not_in_beta/.test(src), 'the sign-in route can still answer not_in_beta');
  assert.ok(!/beta_email_approved|is_beta_approved/.test(src));
});

test('a brand-new address is not refused by anything this route decides', () => {
  /* Every refusal the route can still produce, enumerated from its own source,
     so a new one cannot be added without this test noticing. None of them is
     about who the athlete is. */
  const src = code(read('api/beta-signin.js'));
  const codes = (src.match(/error:\s*'([a-z_]+)'/g) || [])
    .map((m) => m.replace(/.*'([a-z_]+)'.*/, '$1'));
  const permitted = ['method_not_allowed', 'unavailable', 'bad_email', 'send_failed'];
  codes.forEach((c) => assert.ok(permitted.indexOf(c) !== -1,
    'the sign-in route gained a refusal that is not about the request: ' + c));
});

test('email validation is preserved', () => {
  const src = code(read('api/beta-signin.js'));
  assert.match(src, /indexOf\('@'\) < 1/, 'the shape check is gone');
  assert.match(src, /length > 254/, 'the length bound is gone');
  assert.match(src, /error: 'bad_email'/);
});

test('rate limiting and provider-failure classification are preserved', () => {
  /* The limit is GoTrue's, and what this route must keep doing is REPORTING it
     honestly rather than flattening every provider failure into one message. */
  const src = code(read('api/beta-signin.js'));
  assert.match(src, /429/, 'a rate-limited provider response is no longer recognised');
  assert.match(src, /rate_limited/);
  assert.match(src, /send_failed/);
});

test('the service-key fail-closed protection is preserved', () => {
  /* Not about who may sign in -- about whether this deployment can function.
     It must survive the allowlist going. */
  const src = code(read('api/beta-signin.js'));
  assert.match(src, /if \(!cfg\.serviceKey\)/);
  assert.match(src, /SUPABASE_KEY_UNUSABLE/);
});

test('redirect and origin validation are preserved', () => {
  const signin = require('../api/beta-signin.js');
  const src = code(read('api/beta-signin.js'));
  assert.match(src, /function webOrigins/);
  assert.match(src, /function safeRedirect/);
  assert.match(src, /redirect_to=' \+ encodeURIComponent\(redirect\)/,
    'the validated redirect is no longer what is sent to the provider');
  /* And it is the VALIDATED value that travels, not the caller's. */
  assert.ok(!/redirect_to=' \+ encodeURIComponent\(body/.test(src),
    'the caller’s raw redirect reaches the provider');
  assert.ok(typeof signin === 'function', 'the route still exports a handler');
});

test('unsafe redirects are still discarded in favour of the entry point', () => {
  const src = code(read('api/beta-signin.js'));
  /* An attacker-supplied redirect here would hand them the magic-link tokens,
     so the fallback must be this deployment's own entry path. */
  assert.match(src, /ENTRY_PATH/);
  const fn = src.slice(src.indexOf('function safeRedirect'), src.indexOf('module.exports'));
  assert.match(fn, /list\[0\]|origins/, 'the fallback no longer uses a known origin');
});

// ---------------------------------------------------------------------------
// 2. SIGNING IN GRANTS NOTHING
// ---------------------------------------------------------------------------

test('authentication alone does not grant Valhalla access', () => {
  /* The entire commercial model in one assertion. A new athlete exists, is
     authenticated, and has no row: refused. */
  const d = decide(null);
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'no_entitlement');
  assert.deepEqual(d.capabilities, []);
});

test('an authenticated athlete stays gated until the commercial journey grants access', () => {
  [null, row({}), row({ state: 'expired', access_until: '2026-08-01T00:00:00Z' })]
    .forEach((ent, i) => assert.equal(decide(ent).allow, false, 'case ' + i + ' admitted somebody'));
  /* And the states that DO admit are the commercial ones. */
  const until = '2026-09-20T00:00:00Z';
  assert.equal(decide(row({ state: 'trial', access_until: until })).allow, true);
  assert.equal(decide(row({ state: 'active', access_until: until })).allow, true);
});

test('the sign-in route cannot write an entitlement of any kind', () => {
  /* It holds the service key, so "it could have" is a real question. It reads
     nothing and writes nothing: the only outbound call is the OTP request. */
  const src = code(read('api/beta-signin.js'));
  ['entitlements', 'entitlement_grants', 'account_commercial', 'subscriptions']
    .forEach((t) => assert.ok(src.indexOf(t) === -1,
      'the sign-in route touches ' + t));
  assert.ok(!/method:\s*'(POST|PATCH|PUT)'[\s\S]{0,200}S\.sb\(/.test(src),
    'the sign-in route writes to Supabase');
  const calls = (src.match(/S\.sb\(/g) || []).length;
  assert.equal(calls, 0, 'the sign-in route still queries Supabase directly');
});

// ---------------------------------------------------------------------------
// 3. THE COHORTS THAT MUST NOT MOVE
// ---------------------------------------------------------------------------

test('owner remains override_owner', () => {
  const d = decide(row({ override: 'owner' }));
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'override_owner');
});

test('the grandfathered athletes remain override_promo', () => {
  /* The production row shape after the projection fix: no commercial window,
     open-ended complimentary override. */
  const d = decide(row({ override: 'promo' }));
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'override_promo');
  assert.deepEqual(A.ACCESS_OVERRIDES.slice().sort(), ['owner', 'promo']);
  assert.equal(E.grantAccess({ id: 'g', account_id: UID, source: 'admin_comp',
    product_code: Prod.STANDARD, expires_at: null, revoked_at: null }, NOW).active, true);
});

test('historical beta mechanisms still cannot grant new access', () => {
  assert.equal(E.grantAccess({ id: 'g', account_id: UID, source: 'admin_beta',
    product_code: Prod.STANDARD, expires_at: null, revoked_at: null }, NOW).active, false);
  assert.equal(decide(row({ override: 'beta' })).allow, false);
  assert.deepEqual(E.RETIRED_GRANT_SOURCES, ['admin_beta']);
  /* And opening signup did not turn the allowlist into an entitlement: no
     module that decides access or money reads it. */
  ['api/_access.js', 'api/_entitlement.js', 'api/_commercial-store.js',
   'api/_checkout.js', 'api/_subscription.js', 'api/app.js', 'api/_portal.js',
   'api/beta-signin.js'
  ].forEach((f) => assert.ok(!/beta_allowlist/.test(code(read(f))),
    f + ' reads the allowlist'));
});

// ---------------------------------------------------------------------------
// 4. THE COMMERCIAL BOUNDARY IS UNCHANGED
// ---------------------------------------------------------------------------

test('UK-only checkout is intact', () => {
  const ok = (over) => Object.assign({ commerceEnabled: true, commercialRequired: true,
    stripeConfigured: true, isLiveKey: true, uid: UID, country: 'GB', period: 'monthly',
    purchaseCheck: { allowed: true, reason: 'ok' },
    evidence: { ok: true, terms: true, immediateStart: true, published: true },
    now: NOW }, over || {});
  assert.equal(Ck.decideCheckout(ok()).ok, true);
  assert.equal(Ck.decideCheckout(ok({ country: 'US' })).code, 'country_not_supported');
  assert.equal(Ck.decideCheckout(ok({ country: null })).code, 'country_unavailable');
  assert.deepEqual(Ck.SUPPORTED_COUNTRIES, ['GB']);
});

test('prices, trial and server-side resolution are unchanged', () => {
  assert.equal(Prod.offer('STANDARD_MONTHLY').priceMinor, 1199);
  assert.equal(Prod.offer('STANDARD_YEARLY').priceMinor, 8999);
  assert.equal(Prod.offer('STANDARD_MONTHLY').trialDays, 14);
  assert.equal(Prod.offer('STANDARD_YEARLY').trialDays, 14);
  assert.equal(Prod.offerForPeriod('monthly').code, 'STANDARD_MONTHLY');
  assert.equal(Prod.offerForPeriod('yearly').code, 'STANDARD_YEARLY');
  ['price_1Abc', 'weekly', null, ''].forEach((p) =>
    assert.equal(Prod.offerForPeriod(p), null));
});

// ---------------------------------------------------------------------------
// 5. NO OTHER SIGN-IN ROUTE
// ---------------------------------------------------------------------------

test('there is exactly one sign-in route, and every caller uses it', () => {
  /* A second route would be a second place for a gate to hide. */
  const callers = ['account.html', 'start.html', 'protected/velvet-viking-valhalla.html'];
  callers.forEach((f) => assert.match(read(f), /\/api\/beta-signin/,
    f + ' no longer uses the shared sign-in route'));
  /* Underscore-prefixed files are shared modules, not routes -- _strava-auth.js
     is Strava's OAuth handler mounted on the strava router and has nothing to do
     with athlete authentication. Routes are the files without the prefix. */
  const routes = fs.readdirSync(path.join(ROOT, 'api'))
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .filter((f) => /signin|sign-in|login/i.test(f));
  assert.deepEqual(routes, ['beta-signin.js'],
    'another authentication route appeared: ' + routes.join(', '));
});
