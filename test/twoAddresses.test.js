'use strict';
/* ONE APP, TWO ADDRESSES, WHILE THE OLD ONE IS RETIRED.
 *
 * Founder, 21 November 2026: "Proceed with the domain migration, maintaining
 * backwards compatibility for older builds. Keep app.velvetviking.co.uk
 * operational until it is safe to retire."
 *
 * On switch day VVV_SITE_ORIGIN becomes https://app.sacoro.app: the one
 * address registered with Strava and Garmin. Builds 13 and earlier still load
 * https://app.velvetviking.co.uk, and their App Links claim only that host, so
 * anything that sends a PERSON back somewhere must send them to the address
 * they started from, and only ever to one of the app's own. These tests drive
 * the real functions. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const O = require('../api/_origins.js');
const S = require('../api/_strava.js');
const P = require('../api/_stripe.js');
const G = require('../api/_google.js');
const Callback = require('../api/_strava-callback.js');

const NEW = 'https://app.sacoro.app';
const OLD = 'https://app.velvetviking.co.uk';
const on = (host) => ({ headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': host, host: host } });
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function withEnv(vars, fn){
  const was = {};
  Object.keys(vars).forEach((k) => { was[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; });
  const restore = () => Object.keys(was).forEach((k) => { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; });
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.finally(restore);
    restore();
    return r;
  } catch (e) { restore(); throw e; }
}

// ---------------------------------------------------------------------------
// THE LIST
// ---------------------------------------------------------------------------
test('the app has exactly two addresses of its own, and nothing else counts', () => {
  assert.deepEqual(O.APP_ORIGINS.slice(), [NEW, OLD]);
  assert.ok(Object.isFrozen(O.APP_ORIGINS), 'the list cannot be added to at run time');
  assert.equal(O.isAppOrigin(NEW + '/'), true, 'a trailing slash is the same address');
  assert.equal(O.isAppOrigin(OLD), true);
  ['https://evil.example', 'http://app.sacoro.app', 'https://app.sacoro.app.evil.example',
   'https://sacoro.app', 'https://velvet-viking-valhalla-1.vercel.app', '', null, undefined]
    .forEach((o) => assert.equal(O.isAppOrigin(o), false, String(o) + ' was taken for the app'));
  assert.equal(O.isAppOrigin('https://preview.example', 'https://preview.example/'), true,
    'the pinned origin always counts');
});

// ---------------------------------------------------------------------------
// WHERE A PERSON IS SENT BACK TO
// ---------------------------------------------------------------------------
test('pinned to the new address, a person on either address is sent back to that address', () => {
  withEnv({ VVV_SITE_ORIGIN: NEW }, () => {
    assert.equal(S.returnOrigin(on('app.sacoro.app')), NEW);
    assert.equal(S.returnOrigin(on('app.velvetviking.co.uk')), OLD, 'an older build is sent back to its own address');
    assert.equal(S.returnOrigin(on('evil.example')), NEW, 'a host the app does not own is never used');
    assert.equal(S.returnOrigin(on('velvet-viking-valhalla-1.vercel.app')), NEW);
    assert.equal(S.returnOrigin({ headers: {} }), NEW);
    assert.equal(S.siteOrigin(on('app.velvetviking.co.uk')), NEW, 'the registered address does not follow the request');
  });
});

test('pinned to the OLD address (today), a build 14 person is sent back to the new one', () => {
  withEnv({ VVV_SITE_ORIGIN: OLD }, () => {
    assert.equal(S.returnOrigin(on('app.sacoro.app')), NEW);
    assert.equal(S.returnOrigin(on('app.velvetviking.co.uk')), OLD);
  });
});

test('unpinned (previews, localhost) it is siteOrigin exactly, as it always was', () => {
  withEnv({ VVV_SITE_ORIGIN: null }, () => {
    const r = { headers: { 'x-forwarded-proto': 'http', host: 'localhost:3000' } };
    assert.equal(S.returnOrigin(r), S.siteOrigin(r));
    assert.equal(S.returnOrigin(r), 'http://localhost:3000');
  });
});

// ---------------------------------------------------------------------------
// STRAVA
// ---------------------------------------------------------------------------
test('Strava: the redirect_uri stays the one registered address, wherever the athlete is', () => {
  withEnv({ VVV_SITE_ORIGIN: NEW }, () => {
    assert.equal(S.redirectUri(on('app.velvetviking.co.uk')), NEW + '/api/strava-callback');
  });
  assert.match(read('api/_strava-auth.js'), /state: S\.signState\(uid, cfg\.clientSecret, S\.returnOrigin\(req\)\)/,
    'the authorization no longer remembers where the athlete started');
});

test('Strava: the signed state carries the starting address, and only this server can write it', () => {
  withEnv({ VVV_SITE_ORIGIN: NEW }, () => {
    const st = S.signState('user-1', 'client-secret', OLD);
    assert.equal(S.verifyState(st, 'client-secret'), 'user-1', 'the uid is read exactly as before');
    assert.equal(S.stateOrigin(st, 'client-secret'), OLD);
    assert.equal(S.stateOrigin(st, 'another-secret'), '', 'a state this server did not sign names nowhere');
    assert.equal(S.stateOrigin(S.signState('user-1', 'client-secret'), 'client-secret'), '',
      'a state from before this change returns to siteOrigin, as every state did');
    assert.equal(S.stateOrigin(S.signState('user-1', 'client-secret', 'https://evil.example'), 'client-secret'), '',
      'even a signed address must be one of the app\'s own');
    assert.equal(S.stateOrigin('', 'client-secret'), '');
    assert.equal(S.stateOrigin(st, ''), '', 'no secret configured, nothing is believed');
    /* Tampering with the address breaks the MAC. */
    const [body, mac] = [st.slice(0, st.lastIndexOf('.')), st.slice(st.lastIndexOf('.') + 1)];
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    claims.o = 'https://evil.example';
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url') + '.' + mac;
    assert.equal(S.stateOrigin(forged, 'client-secret'), '');
    assert.equal(S.verifyState(forged, 'client-secret'), null);
  });
});

test('Strava: an expired state still sends the athlete home, but its uid is not believed', () => {
  withEnv({ VVV_SITE_ORIGIN: NEW }, () => {
    const realNow = Date.now;
    let st;
    try { Date.now = () => realNow() - 60 * 60 * 1000; st = S.signState('user-1', 'client-secret', OLD); }
    finally { Date.now = realNow; }
    assert.equal(S.verifyState(st, 'client-secret'), null);
    assert.equal(S.stateOrigin(st, 'client-secret'), OLD);
  });
});

function fakeRes(){
  const r = { status: 0, headers: {}, body: '' };
  r.writeHead = (s, h) => { r.status = s; Object.assign(r.headers, h || {}); };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = b || ''; };
  return r;
}

test('Strava: the callback sends each athlete back to /auth on the address they started from', async () => {
  /* Strava switched off: the callback answers before any network call, which
     is enough to see where it sends the athlete. */
  await withEnv({ VVV_SITE_ORIGIN: NEW, STRAVA_CLIENT_ID: '123', STRAVA_CLIENT_SECRET: 'client-secret',
                  VVV_STRAVA_ENABLED: null }, async () => {
    const land = async (state) => {
      const res = fakeRes();
      await Callback.handle({ method: 'GET', query: { state: state, error: 'access_denied' }, headers: on('app.sacoro.app').headers }, res);
      assert.equal(res.status, 302);
      return res.headers.Location;
    };
    assert.equal(await land(S.signState('u1', 'client-secret', OLD)), OLD + '/auth?strava=unavailable',
      'an older build, which started on the old address, is sent back to it');
    assert.equal(await land(S.signState('u1', 'client-secret', NEW)), NEW + '/auth?strava=unavailable');
    assert.equal(await land(S.signState('u1', 'not-ours', OLD)), NEW + '/auth?strava=unavailable',
      'a state this server did not sign returns to the registered address');
    assert.equal(await land(undefined), NEW + '/auth?strava=unavailable');
  });
});

// ---------------------------------------------------------------------------
// STRIPE: CHECKOUT AND THE BILLING PORTAL
// ---------------------------------------------------------------------------
test('Stripe: the payment page returns to the address the athlete paid from', () => {
  withEnv({ VVV_SITE_ORIGIN: NEW }, () => {
    const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_1', VVV_SITE_ORIGIN: NEW });
    const old = P.returnUrls(P.atOrigin(cfg, S.returnOrigin(on('app.velvetviking.co.uk'))), 'web');
    assert.equal(old.success, OLD + '/account?checkout=complete&session_id={CHECKOUT_SESSION_ID}');
    assert.equal(old.cancel, 'https://sacoro.app/pricing?checkout=cancelled', 'a cancel still goes to the website');
    const app = P.returnUrls(P.atOrigin(cfg, S.returnOrigin(on('app.velvetviking.co.uk'))), 'app');
    assert.equal(app.success, OLD + '/account?checkout=complete&session_id={CHECKOUT_SESSION_ID}&return=app');
    const evil = P.returnUrls(P.atOrigin(cfg, 'https://evil.example'), 'web');
    assert.equal(evil.success, NEW + '/account?checkout=complete&session_id={CHECKOUT_SESSION_ID}',
      'an address the app does not own never reaches Stripe');
    assert.equal(P.atOrigin(cfg, 'https://evil.example'), cfg);
  });
});

test('Stripe: without VVV_SITE_ORIGIN checkout still refuses rather than guessing', async () => {
  const cfg = P.atOrigin(P.config({ STRIPE_SECRET_KEY: 'sk_test_1' }), NEW);
  assert.equal(cfg.appOrigin, '');
  const r = await P.createCheckoutSession(cfg, { uid: 'u1', accountId: 'u1', customerId: 'cus_1',
    offerCode: 'STANDARD_YEARLY', env: { VVV_PRICE_WEB_STANDARD_YEARLY: 'price_y' }, returnTo: 'web' },
    { fetch: async () => { throw new Error('no network call may be made'); } });
  assert.deepEqual(r, { ok: false, code: 'app_origin_not_configured' });
});

test('Stripe: checkout and the portal both take the address from the request, through the list', () => {
  ['api/_checkout.js', 'api/_portal.js'].forEach((f) => {
    assert.match(read(f), /const stripe = P\.atOrigin\(P\.config\(\), S\.returnOrigin\(req\)\);/, f);
  });
});

// ---------------------------------------------------------------------------
// GOOGLE PLAY NOTIFICATIONS: TWO AUDIENCES WHILE THE PUSH ENDPOINT MOVES
// ---------------------------------------------------------------------------
const KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = Object.assign(KEYS.publicKey.export({ format: 'jwk' }), { kid: 'push-1', alg: 'RS256', use: 'sig' });
const EMAIL = 'rtdn-push@sacoro-billing.iam.gserviceaccount.com';
const OLD_AUD = OLD + '/api/billing-webhook?rail=google';
const NEW_AUD = NEW + '/api/billing-webhook?rail=google';
function token(aud){
  const b = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b({ alg: 'RS256', kid: 'push-1', typ: 'JWT' }) + '.' +
    b({ iss: 'https://accounts.google.com', aud: aud, email: EMAIL, email_verified: true, iat: now - 5, exp: now + 3600 });
  return unsigned + '.' + crypto.sign('RSA-SHA256', Buffer.from(unsigned), KEYS.privateKey).toString('base64url');
}
const certs = async () => ({ ok: true, status: 200, json: async () => ({ keys: [JWK] }) });

test('Google: a notification for either listed audience passes, and nothing else does', async () => {
  G.resetCertCache();
  const both = { audience: OLD_AUD + ' ' + NEW_AUD, email: EMAIL };
  assert.equal((await G.verifyPushToken(token(OLD_AUD), both, { fetch: certs })).ok, true, 'the old endpoint, before the edit');
  assert.equal((await G.verifyPushToken(token(NEW_AUD), both, { fetch: certs })).ok, true, 'the new endpoint, after it');
  assert.equal((await G.verifyPushToken(token(NEW_AUD), { audience: OLD_AUD + ',' + NEW_AUD, email: EMAIL }, { fetch: certs })).ok, true,
    'a comma separates them too');
  assert.equal((await G.verifyPushToken(token('https://evil.example/hook'), both, { fetch: certs })).reason, 'bad_audience');
  assert.equal((await G.verifyPushToken(token(NEW_AUD.slice(0, -1)), both, { fetch: certs })).reason, 'bad_audience',
    'each entry is still matched exactly');
  assert.equal((await G.verifyPushToken(token(NEW_AUD), { audience: OLD_AUD, email: EMAIL }, { fetch: certs })).reason, 'bad_audience',
    'one audience behaves exactly as before');
  assert.deepEqual(G.audiences('  ' + OLD_AUD + ' , ' + NEW_AUD + '  '), [OLD_AUD, NEW_AUD]);
  assert.deepEqual(G.audiences(''), []);
});
