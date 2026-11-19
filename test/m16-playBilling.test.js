'use strict';
// GOOGLE PLAY BILLING (founder, 18 November 2026).
//
// "Play Console only shows 'Upload a new APK' instead of 'Create subscription'
// because no uploaded build has the BILLING permission." The fix is a real
// Play Billing rail, built the way STORE-COMMERCIAL-BOUNDARY.md said it would
// be: a channel feeding the provider-neutral core, nothing more.
//
// What is held here:
//   1. the adapter: every subscriptionsv2 state lands on the six-word
//      vocabulary, the offer comes from the environment, and config fails
//      closed naming what is missing;
//   2. the two signatures: the service-account assertion we sign, and the
//      Pub/Sub push token we verify (valid, wrong audience, wrong email,
//      expired, bad signature, and the rest);
//   3. the verify route through the real router against a fake Google and a
//      fake Supabase: somebody else's purchase refused, a second live
//      subscription refused, the one trial spent once, and nothing refused is
//      ever acknowledged;
//   4. the webhook branch chosen by the REQUEST, and what it does;
//   5. the runtime: the Android Play Store build uses Play; iOS, the website
//      and the website-distributed APK are exactly as before; the trial offer
//      only when SACORO's rule allows it;
//   6. the native build and the CI input.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('./fakeSupabase.js');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const S = require('../api/_strava.js');
const E = require('../api/_entitlement.js');
const Prod = require('../api/_products.js');
const Agree = require('../api/_agreements.js');
const G = require('../api/_google.js');
const GP = require('../api/_google-purchase.js');
const account = require('../api/account.js');
const webhook = require('../api/billing-webhook.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const ATHLETE = '11111111-1111-4111-8111-111111111111';
const OTHER   = '22222222-2222-4222-8222-222222222222';
const DAY = 24 * 3600 * 1000;
const NOW = Date.now();
const iso = ms => new Date(ms).toISOString();

const ENV_OFFERS = {
  VVV_PRICE_GOOGLE_STANDARD_MONTHLY: 'sacoro_standard:monthly',
  VVV_PRICE_GOOGLE_STANDARD_YEARLY: 'sacoro_standard:annual'
};
const SECRET = 'test-account-id-secret';
const AUDIENCE = 'https://app.test/api/billing-webhook?rail=google';
const PUSH_EMAIL = 'rtdn-push@sacoro-billing.iam.gserviceaccount.com';

/* Two RSA keys: one is the service account's, one is Google's push signer. */
const SA_KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUSH_KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ROGUE_KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account', client_email: 'play-api@sacoro-billing.iam.gserviceaccount.com',
  private_key_id: 'sa-key-1',
  private_key: SA_KEYS.privateKey.export({ type: 'pkcs8', format: 'pem' })
});
const PUSH_JWK = Object.assign(PUSH_KEYS.publicKey.export({ format: 'jwk' }), { kid: 'push-1', alg: 'RS256', use: 'sig' });

function b64u(x){ return Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url'); }
function signJwt(claims, opts){
  const o = opts || {};
  const header = { alg: o.alg || 'RS256', kid: o.kid === undefined ? 'push-1' : o.kid, typ: 'JWT' };
  const unsigned = b64u(header) + '.' + b64u(claims);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), o.key || PUSH_KEYS.privateKey);
  return unsigned + '.' + sig.toString('base64url');
}
function pushClaims(over){
  const now = Math.floor(Date.now() / 1000);
  return Object.assign({ iss: 'https://accounts.google.com', aud: AUDIENCE, email: PUSH_EMAIL,
                         email_verified: true, iat: now - 5, exp: now + 3600, sub: '1234' }, over || {});
}

/* ONE PLAY SUBSCRIPTION, in Google's shape. */
function playSub(over, item){
  const it = Object.assign({
    productId: 'sacoro_standard',
    expiryTime: iso(NOW + 6 * DAY),
    autoRenewingPlan: { autoRenewEnabled: true },
    offerDetails: { basePlanId: 'monthly', offerId: 'free-trial-7d', offerTags: [] },
    offerPhase: { freeTrial: {} }
  }, item || {});
  return Object.assign({
    kind: 'androidpublisher#subscriptionPurchaseV2',
    startTime: iso(NOW - DAY),
    regionCode: 'GB',
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    latestOrderId: 'GPA.3333-0000-0000-00001',
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    externalAccountIdentifiers: { obfuscatedExternalAccountId: G.obfuscatedAccountId(ATHLETE, SECRET) },
    lineItems: [it]
  }, over || {});
}
const facts = (sub, meta) => G.subscriptionFacts(sub, Object.assign({ env: ENV_OFFERS, purchaseToken: 'tok_abcdefghijklmnop' }, meta || {}));

// ===========================================================================
// 1. THE ADAPTER
// ===========================================================================
test('every subscriptionsv2 state lands on the six-word vocabulary', () => {
  const cases = [
    ['ACTIVE, free-trial phase', playSub(), 'trialing'],
    ['ACTIVE, paid phase', playSub({}, { offerPhase: { basePrice: {} }, expiryTime: iso(NOW + 20 * DAY) }), 'active'],
    ['ACTIVE, auto-renew off', playSub({}, { offerPhase: { basePrice: {} }, autoRenewingPlan: { autoRenewEnabled: false } }), 'cancelled'],
    ['CANCELED during the free trial', playSub({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }, { autoRenewingPlan: { autoRenewEnabled: false } }), 'trialing'],
    ['CANCELED, paid period still running', playSub({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }, { offerPhase: { basePrice: {} }, autoRenewingPlan: { autoRenewEnabled: false } }), 'cancelled'],
    ['CANCELED, period over', playSub({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }, { offerPhase: { basePrice: {} }, expiryTime: iso(NOW - DAY) }), 'expired'],
    ['IN_GRACE_PERIOD', playSub({ subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' }, { offerPhase: { basePrice: {} } }), 'past_due'],
    ['ON_HOLD', playSub({ subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD' }, { offerPhase: { basePrice: {} }, expiryTime: iso(NOW - DAY) }), 'past_due'],
    ['PAUSED', playSub({ subscriptionState: 'SUBSCRIPTION_STATE_PAUSED' }, { offerPhase: { basePrice: {} }, expiryTime: iso(NOW - DAY) }), 'past_due'],
    ['EXPIRED', playSub({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }, { offerPhase: { basePrice: {} }, expiryTime: iso(NOW - DAY) }), 'expired'],
    ['PENDING_PURCHASE_CANCELED', playSub({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED' }), 'expired']
  ];
  cases.forEach(([name, sub, want]) => {
    const f = facts(sub);
    assert.ok(f, name + ' was not classified');
    assert.equal(f.condition, want, name);
    assert.ok(E.CONDITIONS.indexOf(f.condition) !== -1, name + ' left the vocabulary');
    assert.equal(f.provider, 'google');
    assert.equal(f.account_id, null, name + ': the adapter must never name an account');
  });
  /* Not paid, or not ours: refused, never guessed. */
  assert.equal(facts(playSub({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING' })), null, 'a pending purchase granted something');
  assert.equal(facts(playSub({ subscriptionState: 'SUBSCRIPTION_STATE_UNSPECIFIED' })), null);
  assert.equal(facts(playSub({ subscriptionState: 'SOMETHING_NEW' })), null);
  assert.equal(facts(playSub({}, { productId: 'someone_elses' })), null, 'an unmapped product was classified');
  assert.equal(facts(playSub({}, { offerDetails: { basePlanId: 'weekly' } })), null, 'an unmapped base plan was classified');
});

test('dates: the trial window, paid-through, and grace that is Google\'s alone', () => {
  const t = facts(playSub());
  assert.equal(t.trial_end, iso(NOW + 6 * DAY));
  assert.equal(t.trial_start, iso(NOW - DAY));
  assert.equal(t.offer_code, 'STANDARD_MONTHLY');
  assert.equal(t.billing_period, 'monthly');
  assert.equal(t.acknowledgement_pending, true);
  const y = facts(playSub({}, { offerDetails: { basePlanId: 'annual' }, offerPhase: { basePrice: {} }, expiryTime: iso(NOW + 300 * DAY) }));
  assert.equal(y.offer_code, 'STANDARD_YEARLY');
  assert.equal(y.period_end, iso(NOW + 300 * DAY));
  assert.equal(y.trial_end, null);
  const grace = facts(playSub({ subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' }, { offerPhase: { basePrice: {} }, expiryTime: iso(NOW + 3 * DAY) }));
  assert.equal(grace.grace_period_end, iso(NOW + 3 * DAY), 'Google\'s grace end is the expiry it reports in grace');
  assert.equal(grace.period_end, null, 'the unpaid period is not paid-through');
  const hold = facts(playSub({ subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD' }, { offerPhase: { basePrice: {} }, expiryTime: iso(NOW - DAY) }));
  assert.equal(hold.grace_period_end, null, 'account hold grants nothing');
  /* The resolver, unchanged, reads these the way the web rail's rows read. */
  const sub = f => ({ provider: 'google', product_code: Prod.STANDARD, condition: f.condition, trial_end: f.trial_end,
                      current_period_end: f.period_end, grace_period_end: f.grace_period_end });
  assert.equal(E.isBlockingCommercial(sub(t), new Date()), true);
  assert.equal(E.isBlockingCommercial(sub(grace), new Date()), true);
  assert.equal(E.isBlockingCommercial(sub(hold), new Date()), false);
  /* Sandbox purchases are recorded as sandbox. */
  assert.equal(facts(playSub({ testPurchase: {} })).environment, 'sandbox');
  assert.equal(facts(playSub()).environment, 'production');
});

test('revoked: only when Google\'s own re-read shows the purchase is no longer entitled', () => {
  const ended = playSub({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }, { offerPhase: { basePrice: {} }, expiryTime: iso(NOW - 60000) });
  assert.equal(facts(ended, { revoked: true }).condition, 'revoked');
  assert.equal(facts(ended).condition, 'expired');
  const live = playSub({}, { offerPhase: { basePrice: {} }, expiryTime: iso(NOW + 20 * DAY) });
  assert.equal(facts(live, { revoked: true }).condition, 'active', 'a notification revoked a subscription Google says is live');
});

test('the free-trial phase falls back to the offer and the period only when Google omits offerPhase', () => {
  const short = playSub({}, { offerPhase: undefined, expiryTime: iso(NOW + 6 * DAY) });
  delete short.lineItems[0].offerPhase;
  assert.equal(G.inFreeTrial(short, short.lineItems[0]), true);
  const paid = playSub({}, { expiryTime: iso(NOW + 29 * DAY) });
  delete paid.lineItems[0].offerPhase;
  assert.equal(G.inFreeTrial(paid, paid.lineItems[0]), false);
  const base = playSub({}, { offerDetails: { basePlanId: 'monthly', offerId: null } });
  delete base.lineItems[0].offerPhase;
  assert.equal(G.inFreeTrial(base, base.lineItems[0]), false);
  /* offerPhase, when present, is the authority */
  assert.equal(G.inFreeTrial(playSub(), playSub().lineItems[0]), true);
});

test('configuration fails closed, and says which variables are missing by NAME', () => {
  const none = G.config({});
  assert.equal(none.ok, false);
  assert.deepEqual(none.missing, ['VVV_GOOGLE_PLAY_SERVICE_ACCOUNT', 'VVV_GOOGLE_ACCOUNT_ID_SECRET',
    'VVV_PRICE_GOOGLE_STANDARD_MONTHLY / VVV_PRICE_GOOGLE_STANDARD_YEARLY']);
  assert.equal(none.hasRtdn, false);
  assert.deepEqual(none.rtdnMissing, ['VVV_GOOGLE_RTDN_AUDIENCE', 'VVV_GOOGLE_RTDN_SERVICE_ACCOUNT']);
  const full = G.config(Object.assign({ VVV_GOOGLE_PLAY_SERVICE_ACCOUNT: SERVICE_ACCOUNT, VVV_GOOGLE_ACCOUNT_ID_SECRET: SECRET,
    VVV_GOOGLE_RTDN_AUDIENCE: AUDIENCE, VVV_GOOGLE_RTDN_SERVICE_ACCOUNT: PUSH_EMAIL }, ENV_OFFERS));
  assert.equal(full.ok, true);
  assert.equal(full.hasRtdn, true);
  assert.equal(full.productId, 'sacoro_standard');
  assert.deepEqual(Object.keys(full.offers).sort(), ['STANDARD_MONTHLY', 'STANDARD_YEARLY']);
  /* base64 of the key file is accepted too; garbage is "not configured" */
  assert.equal(G.config(Object.assign({ VVV_GOOGLE_PLAY_SERVICE_ACCOUNT: Buffer.from(SERVICE_ACCOUNT).toString('base64'),
    VVV_GOOGLE_ACCOUNT_ID_SECRET: SECRET }, ENV_OFFERS)).ok, true);
  assert.equal(G.config(Object.assign({ VVV_GOOGLE_PLAY_SERVICE_ACCOUNT: '{"client_email":"x"}', VVV_GOOGLE_ACCOUNT_ID_SECRET: SECRET }, ENV_OFFERS)).ok, false);
  /* a malformed price identifier makes that offer unpurchasable, not guessed */
  assert.equal(Object.keys(G.playOfferRefs({ VVV_PRICE_GOOGLE_STANDARD_MONTHLY: 'price_123' })).length, 0);
  assert.equal(Object.keys(G.playOfferRefs({ VVV_PRICE_GOOGLE_STANDARD_MONTHLY: 'Sacoro Standard:monthly' })).length, 0);
  /* the catalogue's own convention: no second naming scheme */
  assert.equal(Prod.providerRefEnvName('google', 'STANDARD_YEARLY'), 'VVV_PRICE_GOOGLE_STANDARD_YEARLY');
});

test('the obfuscated account id: keyed, one-way, within Play\'s 64 characters', () => {
  const a = G.obfuscatedAccountId(ATHLETE, SECRET);
  assert.equal(a, G.obfuscatedAccountId(ATHLETE, SECRET));
  assert.ok(a.length <= 64 && /^[A-Za-z0-9_-]+$/.test(a));
  assert.notEqual(a, G.obfuscatedAccountId(OTHER, SECRET));
  assert.notEqual(a, G.obfuscatedAccountId(ATHLETE, 'another-secret'));
  assert.equal(a.indexOf(ATHLETE), -1, 'the account id itself leaked into the Play identifier');
  assert.equal(G.obfuscatedAccountId(ATHLETE, ''), null);
  assert.equal(G.sameObfuscatedId(a, a), true);
  assert.equal(G.sameObfuscatedId(a, a.slice(1)), false);
});

// ===========================================================================
// 2. SIGNATURES
// ===========================================================================
test('the service-account assertion is RS256, signed by the key, for the androidpublisher scope', () => {
  const sa = G.parseServiceAccount(SERVICE_ACCOUNT);
  const jwt = G.serviceAccountAssertion(sa, 1800000000);
  const [h, c, s] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT', kid: 'sa-key-1' });
  assert.deepEqual(claims, { iss: 'play-api@sacoro-billing.iam.gserviceaccount.com',
    scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token',
    iat: 1800000000, exp: 1800003600 });
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), SA_KEYS.publicKey, Buffer.from(s, 'base64url')), true);
});

function certsFetch(keys){
  let calls = 0;
  const fn = async (url) => {
    calls++;
    assert.equal(String(url), 'https://www.googleapis.com/oauth2/v3/certs');
    return { ok: true, status: 200, json: async () => ({ keys: keys }) };
  };
  fn.calls = () => calls;
  return fn;
}
const EXPECT = { audience: AUDIENCE, email: PUSH_EMAIL };

test('the Pub/Sub push token: valid passes, every other case is refused with its reason', async () => {
  G.resetCertCache();
  const fetch = certsFetch([PUSH_JWK]);
  const v = (tok, exp) => G.verifyPushToken(tok, exp || EXPECT, { fetch });
  assert.deepEqual(await v(signJwt(pushClaims())), { ok: true, reason: 'verified' });
  assert.equal((await v(signJwt(pushClaims({ iss: 'accounts.google.com' })))).ok, true, 'both issuer spellings are Google\'s');
  assert.equal((await v(signJwt(pushClaims({ aud: 'https://evil.example/hook' })))).reason, 'bad_audience');
  assert.equal((await v(signJwt(pushClaims({ email: 'someone@else.iam.gserviceaccount.com' })))).reason, 'bad_email');
  assert.equal((await v(signJwt(pushClaims({ email_verified: false })))).reason, 'email_unverified');
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await v(signJwt(pushClaims({ iat: now - 7200, exp: now - 3600 })))).reason, 'expired');
  assert.equal((await v(signJwt(pushClaims({ iss: 'https://evil.example' })))).reason, 'bad_issuer');
  assert.equal((await v(signJwt(pushClaims(), { key: ROGUE_KEYS.privateKey }))).reason, 'bad_signature');
  const good = signJwt(pushClaims()).split('.');
  assert.equal((await v(good[0] + '.' + b64u(pushClaims({ email: 'x@y.z' })) + '.' + good[2])).reason, 'bad_signature',
    'claims edited after signing were accepted');
  assert.equal((await v(signJwt(pushClaims(), { alg: 'HS256' }))).reason, 'bad_algorithm');
  assert.equal((await v(signJwt(pushClaims(), { kid: 'nobody' }))).reason, 'unknown_key');
  assert.equal((await v('not.a.jwt')).reason, 'malformed');
  assert.equal((await v(signJwt(pushClaims()), { audience: '', email: PUSH_EMAIL })).reason, 'not_configured',
    'with no audience configured, any Google token would do');
});

test('a rotated Google key is fetched again rather than refused', async () => {
  G.resetCertCache();
  const rotated = Object.assign(ROGUE_KEYS.publicKey.export({ format: 'jwk' }), { kid: 'push-2', alg: 'RS256' });
  let keys = [PUSH_JWK];
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ keys: keys }) });
  assert.equal((await G.verifyPushToken(signJwt(pushClaims()), EXPECT, { fetch })).ok, true);
  keys = [PUSH_JWK, rotated];
  assert.equal((await G.verifyPushToken(signJwt(pushClaims(), { key: ROGUE_KEYS.privateKey, kid: 'push-2' }), EXPECT, { fetch })).ok, true);
  G.resetCertCache();
});

// ===========================================================================
// 3. THE WORLD: a fake Google and a fake Supabase, through the real router
// ===========================================================================
function fakeGoogle(){
  const state = { subs: {}, acks: [], requests: [], tokenCalls: 0 };
  async function fetchFn(url, init){
    const u = String(url);
    const method = (init && init.method) || 'GET';
    state.requests.push({ url: u, method: method });
    const ok = data => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
    const bad = s => ({ ok: false, status: s, json: async () => ({ error: { code: s } }), text: async () => JSON.stringify({ error: { code: s } }) });
    if (u === 'https://oauth2.googleapis.com/token'){
      state.tokenCalls++;
      const form = new URLSearchParams(init.body);
      const [h, c, s] = form.get('assertion').split('.');
      const okSig = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), SA_KEYS.publicKey, Buffer.from(s, 'base64url'));
      return okSig ? ok({ access_token: 'ya29.fake', expires_in: 3600 }) : bad(401);
    }
    if (u === 'https://www.googleapis.com/oauth2/v3/certs') return ok({ keys: [PUSH_JWK] });
    if (!/^Bearer ya29\.fake$/.test(String(init && init.headers && init.headers.Authorization))) return bad(401);
    const get = /\/applications\/com\.velvetviking\.valhalla\/purchases\/subscriptionsv2\/tokens\/([^/]+)$/.exec(u);
    if (get && method === 'GET'){
      const s = state.subs[decodeURIComponent(get[1])];
      return s ? ok(s) : bad(404);
    }
    const ack = /\/applications\/com\.velvetviking\.valhalla\/purchases\/subscriptions\/([^/]+)\/tokens\/([^/]+):acknowledge$/.exec(u);
    if (ack && method === 'POST'){
      const tok = decodeURIComponent(ack[2]);
      const s = state.subs[tok];
      if (!s) return bad(404);
      state.acks.push(tok);
      s.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
      return ok({});
    }
    return bad(404);
  }
  return { state, fetchFn, put(token, sub){ state.subs[token] = sub; return sub; } };
}

function fakeRes(){
  const out = { statusCode: null, headers: {}, body: null };
  return {
    setHeader(k, v){ out.headers[k.toLowerCase()] = v; },
    status(c){ out.statusCode = c; return this; },
    send(b){ out.body = b; return this; },
    end(b){ out.body = b; return this; },
    result(){ return { status: out.statusCode, json: (() => { try{ return JSON.parse(out.body); }catch(e){ return out.body; } })() }; }
  };
}

async function withWorld(opts, run){
  const o = opts || {};
  const f = createFakeSupabase(Object.assign({
    account_commercial: [{ account_id: ATHLETE }, { account_id: OTHER }],
    subscriptions: [], entitlement_grants: [], billing_events: [], entitlements: []
  }, o.seed || {}));
  const google = fakeGoogle();
  const saved = { sb: S.sb, config: S.config, verifyUser: S.verifyUser, uidFrom: S.userIdFromRequest,
                  fetch: globalThis.fetch, env: {} };
  const env = Object.assign({
    VVV_GOOGLE_PLAY_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
    VVV_GOOGLE_ACCOUNT_ID_SECRET: SECRET,
    VVV_GOOGLE_RTDN_AUDIENCE: AUDIENCE,
    VVV_GOOGLE_RTDN_SERVICE_ACCOUNT: PUSH_EMAIL,
    VVV_COMMERCE_ENABLED: '1', VVV_COMMERCIAL_REQUIRED: '1', VVV_ACCOUNT_REQUIRED: '1'
  }, ENV_OFFERS, o.env || {});
  Object.keys(env).forEach(k => { saved.env[k] = process.env[k];
    if (env[k] === '') delete process.env[k]; else process.env[k] = env[k]; });
  let signedInAs = ATHLETE;
  S.sb = f.S.sb;
  S.config = () => f.cfg;
  S.verifyUser = async () => ({ uid: signedInAs, email: 'a@b.test' });
  S.userIdFromRequest = async () => signedInAs;
  globalThis.fetch = google.fetchFn;
  G.resetTokenCache(); G.resetCertCache();
  if (o.agreements !== false){
    [ATHLETE, OTHER].forEach(uid => [['terms', Agree.TERMS_COMMERCIAL_VERSION], ['immediate_start', Agree.IMMEDIATE_START_VERSION]]
      .forEach(pair => f.db.account_agreements.push({ id: f.db.account_agreements.length + 1, user_id: uid,
        agreement_type: pair[0], agreement_version: pair[1], decision: 'accepted', surface: 'checkout',
        decided_at: iso(NOW - DAY), created_at: iso(NOW - DAY) })));
  }
  const api = {
    async sub(body, country){
      const res = fakeRes();
      await account({ method: 'POST', url: '/api/account?resource=subscription', query: { resource: 'subscription' },
                      headers: { 'x-vercel-ip-country': country === undefined ? 'GB' : country }, body: body }, res);
      return res.result();
    },
    async push(notification, o2){
      const x = o2 || {};
      const res = fakeRes();
      const body = { message: { data: Buffer.from(JSON.stringify(Object.assign({ version: '1.0',
        packageName: 'com.velvetviking.valhalla', eventTimeMillis: String(Date.now()) }, notification))).toString('base64'),
        messageId: x.messageId || String(Math.random()).slice(2) }, subscription: 'projects/sacoro-billing/subscriptions/push' };
      await webhook({ method: 'POST', url: x.url || '/api/billing-webhook?rail=google',
        query: x.query || { rail: 'google' },
        headers: Object.assign({ authorization: 'Bearer ' + (x.token || signJwt(pushClaims())) }, x.headers || {}),
        body: body }, res);
      return res.result();
    },
    signInAs(uid){ signedInAs = uid; }
  };
  try{ return await run({ f, google, api }); }
  finally {
    S.sb = saved.sb; S.config = saved.config; S.verifyUser = saved.verifyUser; S.userIdFromRequest = saved.uidFrom;
    globalThis.fetch = saved.fetch;
    G.resetTokenCache(); G.resetCertCache();
    Object.keys(saved.env).forEach(k => { if (saved.env[k] === undefined) delete process.env[k]; else process.env[k] = saved.env[k]; });
  }
}
const TOK = 'gp.tokenAAAAAAAAAAAAAAAAAAAAAAAA-1';
const TOK2 = 'gp.tokenBBBBBBBBBBBBBBBBBBBBBBBB-2';
const googleRows = f => f.rows('subscriptions').filter(r => r.provider === 'google');

test('prepare: the athlete\'s own Play id, the trial verdict, and the same refusals as the web checkout', async () => {
  await withWorld({}, async ({ api }) => {
    const r = await api.sub({ action: 'google_prepare' });
    assert.equal(r.status, 200);
    assert.equal(r.json.purchase_allowed, true);
    assert.equal(r.json.obfuscated_account_id, G.obfuscatedAccountId(ATHLETE, SECRET));
    assert.equal(r.json.product_id, 'sacoro_standard');
    assert.deepEqual(r.json.base_plans, { monthly: 'monthly', yearly: 'annual' });
    assert.equal(r.json.trial_eligible, true);
    assert.equal(r.json.trial_days, Prod.TRIAL_DAYS);
    assert.ok(r.json.agreements && r.json.agreements.terms, 'the ticks need the agreements in force');
    assert.equal((await api.sub({ action: 'google_prepare' }, 'US')).json.reason, 'country_not_supported');
  });
  await withWorld({ env: { VVV_COMMERCE_ENABLED: '' } }, async ({ api }) => {
    const r = await api.sub({ action: 'google_prepare' });
    assert.equal(r.json.purchase_allowed, false);
    assert.equal(r.json.reason, 'commerce_disabled');
    assert.equal(r.json.obfuscated_account_id, null, 'an id for a purchase that cannot be made');
  });
  await withWorld({ env: { VVV_GOOGLE_PLAY_SERVICE_ACCOUNT: '' } }, async ({ api }) => {
    const r = await api.sub({ action: 'google_prepare' });
    assert.equal(r.json.reason, 'provider_not_configured');
    assert.equal(r.json.product_id, null);
  });
  await withWorld({ agreements: false }, async ({ api }) => {
    assert.equal((await api.sub({ action: 'google_prepare' })).json.reason, 'terms_not_accepted');
  });
  await withWorld({ seed: { account_commercial: [{ account_id: ATHLETE, trial_consumed_at: iso(NOW - 90 * DAY), trial_consumed_provider: 'web' }] } },
    async ({ api }) => {
      const r = await api.sub({ action: 'google_prepare' });
      assert.equal(r.json.purchase_allowed, true);
      assert.equal(r.json.trial_eligible, false, 'a second trial was offered to an athlete who had one on the web');
    });
});

test('verify: Google\'s record, tied to this athlete, written to the core, then acknowledged', async () => {
  await withWorld({}, async ({ f, google, api }) => {
    google.put(TOK, playSub());
    const r = await api.sub({ action: 'google_verify', purchaseToken: TOK, productId: 'sacoro_standard' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.result, 'google_verified');
    const rows = googleRows(f);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].account_id, ATHLETE);
    assert.equal(rows[0].provider_subscription_id, TOK);
    assert.equal(rows[0].condition, 'trialing');
    assert.equal(rows[0].offer_code, 'STANDARD_MONTHLY');
    assert.equal(rows[0].agreed_price_minor, 1199, 'the agreement is the catalogue\'s, as on the web rail');
    const acct = f.rows('account_commercial').filter(a => a.account_id === ATHLETE)[0];
    assert.ok(acct.trial_consumed_at, 'the one trial was not spent');
    assert.equal(acct.trial_consumed_provider, 'google');
    assert.deepEqual(google.state.acks, [TOK], 'the server did not acknowledge after verifying');
    const ent = f.rows('entitlements').filter(e => e.user_id === ATHLETE)[0];
    assert.ok(ent, 'the gate\'s projection was not refreshed');
    /* again: idempotent, nothing doubled, no second acknowledgement */
    const again = await api.sub({ action: 'google_verify', purchaseToken: TOK, productId: 'sacoro_standard' });
    assert.equal(again.status, 200);
    assert.equal(googleRows(f).length, 1);
    assert.deepEqual(google.state.acks, [TOK]);
  });
});

test('verify: somebody else\'s purchase is refused, and never acknowledged', async () => {
  await withWorld({}, async ({ f, google, api }) => {
    google.put(TOK, playSub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: G.obfuscatedAccountId(OTHER, SECRET) } }));
    const r = await api.sub({ action: 'google_verify', purchaseToken: TOK, productId: 'sacoro_standard' });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'not_your_purchase');
    assert.equal(googleRows(f).length, 0);
    assert.deepEqual(google.state.acks, [], 'a purchase that is not this athlete\'s was acknowledged');
    /* and a purchase with no id at all is nobody's */
    google.put(TOK2, playSub({ externalAccountIdentifiers: {} }));
    assert.equal((await api.sub({ action: 'google_verify', purchaseToken: TOK2 })).json.error, 'not_your_purchase');
    /* once recorded for one athlete, another cannot claim it */
    google.put(TOK, playSub());
    assert.equal((await api.sub({ action: 'google_verify', purchaseToken: TOK })).status, 200);
    api.signInAs(OTHER);
    const stolen = await api.sub({ action: 'google_verify', purchaseToken: TOK });
    assert.equal(stolen.status, 403);
    assert.equal(googleRows(f)[0].account_id, ATHLETE, 'a purchase changed hands');
  });
});

test('verify: a second live subscription is refused, whichever rail holds the first', async () => {
  const webSub = { id: 'w1', account_id: ATHLETE, provider: 'web', provider_subscription_id: 'sub_web1',
    product_code: Prod.STANDARD, condition: 'active', current_period_end: iso(NOW + 20 * DAY) };
  await withWorld({ seed: { subscriptions: [webSub] } }, async ({ f, google, api }) => {
    google.put(TOK, playSub({}, { offerPhase: { basePrice: {} } }));
    const r = await api.sub({ action: 'google_verify', purchaseToken: TOK, productId: 'sacoro_standard' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'already_subscribed_elsewhere');
    assert.equal(r.json.provider, 'web');
    assert.equal(googleRows(f).length, 0);
    assert.deepEqual(google.state.acks, [], 'the second subscription was kept; Google would have charged twice');
    /* and prepare refuses before Play is ever opened */
    const p = await api.sub({ action: 'google_prepare' });
    assert.equal(p.json.purchase_allowed, false);
    assert.equal(p.json.reason, 'already_subscribed_elsewhere');
  });
});

test('verify: the one trial is spent once, and a second Play trial is refused', async () => {
  await withWorld({}, async ({ f, google, api }) => {
    google.put(TOK, playSub());
    assert.equal((await api.sub({ action: 'google_verify', purchaseToken: TOK })).status, 200);
    const first = f.rows('account_commercial').filter(a => a.account_id === ATHLETE)[0].trial_consumed_at;
    /* the first trial is cancelled and runs out; a second Google account
       starts another free trial for the same athlete */
    google.put(TOK, playSub({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' },
                            { expiryTime: iso(NOW - 60000), offerPhase: { basePrice: {} } }));
    assert.equal((await api.sub({ action: 'google_verify', purchaseToken: TOK })).status, 200);
    google.put(TOK2, playSub());
    const second = await api.sub({ action: 'google_verify', purchaseToken: TOK2 });
    assert.equal(second.status, 409);
    assert.equal(second.json.error, 'trial_already_used');
    assert.deepEqual(google.state.acks, [TOK], 'the second trial was acknowledged');
    assert.equal(f.rows('account_commercial').filter(a => a.account_id === ATHLETE)[0].trial_consumed_at, first);
    /* a paid purchase (no trial) is still allowed */
    google.put(TOK2, playSub({}, { offerPhase: { basePrice: {} }, offerDetails: { basePlanId: 'annual', offerId: null } }));
    assert.equal((await api.sub({ action: 'google_verify', purchaseToken: TOK2 })).status, 200);
  });
});

test('verify: a malformed token never reaches Google; a product that is not ours is refused', async () => {
  await withWorld({}, async ({ google, api }) => {
    assert.equal((await api.sub({ action: 'google_verify', purchaseToken: 'x/../../evil' })).status, 400);
    assert.equal(google.state.requests.length, 0);
    google.put(TOK, playSub({}, { productId: 'other_product' }));
    assert.equal((await api.sub({ action: 'google_verify', purchaseToken: TOK })).json.error, 'unclassifiable');
    google.put(TOK2, playSub());
    assert.equal((await api.sub({ action: 'google_verify', purchaseToken: TOK2, productId: 'other_product' })).json.error, 'product_mismatch');
  });
});

// ===========================================================================
// 4. THE WEBHOOK BRANCH
// ===========================================================================
test('the branch is chosen by the request, never by the body', async () => {
  assert.equal(webhook.railOf({ query: { rail: 'google' } }), 'google');
  assert.equal(webhook.railOf({ url: '/api/billing-webhook?rail=google' }), 'google');
  assert.equal(webhook.railOf({ url: '/api/billing-webhook', body: { message: { data: 'x' } } }), null);
  await withWorld({}, async ({ api }) => {
    /* An RTDN body without ?rail=google is not Google's: refused as before. */
    const res = fakeRes();
    await webhook({ method: 'POST', url: '/api/billing-webhook', headers: { authorization: 'Bearer ' + signJwt(pushClaims()) },
                    body: { message: { data: 'e30=', messageId: '1' } } }, res);
    assert.equal(res.result().status, 501);
    assert.equal(res.result().json.code, 'PROVIDER_NOT_SUPPORTED');
    /* ?rail=google with a Stripe header still goes to Google's verifier, which refuses it. */
    const r = await api.push({ testNotification: { version: '1.0' } }, { token: 'nope', headers: { 'stripe-signature': 't=1,v1=x' } });
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'BAD_PUSH_TOKEN');
  });
  const src = read('api/billing-webhook.js');
  assert.match(src, /if \(railOf\(req\) === 'google'\) return handleGoogle\(req, res, cfg\);/);
});

test('the Google branch fails closed without its configuration, and says which names are missing', async () => {
  await withWorld({ env: { VVV_GOOGLE_RTDN_AUDIENCE: '', VVV_GOOGLE_RTDN_SERVICE_ACCOUNT: '' } }, async ({ api }) => {
    const r = await api.push({ testNotification: {} });
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'GOOGLE_RTDN_NOT_CONFIGURED');
    assert.deepEqual(r.json.missing, ['VVV_GOOGLE_RTDN_AUDIENCE', 'VVV_GOOGLE_RTDN_SERVICE_ACCOUNT']);
  });
  await withWorld({ env: { VVV_GOOGLE_PLAY_SERVICE_ACCOUNT: '' } }, async ({ api }) => {
    const r = await api.push({ testNotification: {} });
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'GOOGLE_NOT_CONFIGURED');
    assert.deepEqual(r.json.missing, ['VVV_GOOGLE_PLAY_SERVICE_ACCOUNT']);
    assert.doesNotMatch(JSON.stringify(r.json), /PRIVATE KEY|test-account-id-secret/);
  });
});

test('notifications: authenticated, re-read from Google, claimed once, and a test publish applies nothing', async () => {
  await withWorld({}, async ({ f, google, api }) => {
    /* wrong audience: refused before anything is read */
    const bad = await api.push({ testNotification: {} }, { token: signJwt(pushClaims({ aud: 'https://other' })) });
    assert.equal(bad.status, 401);
    const t = await api.push({ testNotification: { version: '1.0' } });
    assert.equal(t.status, 200);
    assert.equal(t.json.reason, 'test_notification');
    assert.equal(f.rows('billing_events').length, 0);

    /* A purchase the app has not verified yet: nobody to attribute it to. */
    google.put(TOK, playSub());
    const early = await api.push({ subscriptionNotification: { version: '1.0', notificationType: 4, purchaseToken: TOK } }, { messageId: 'm1' });
    assert.equal(early.status, 200);
    assert.equal(early.json.reason, 'unattributable');
    assert.equal(googleRows(f).length, 0);
    assert.deepEqual(google.state.acks, []);

    /* The app verifies it; the next notification renews it from Google's record,
       whatever the notification itself claimed. */
    assert.equal((await api.sub({ action: 'google_verify', purchaseToken: TOK })).status, 200);
    google.put(TOK, playSub({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' },
                            { offerPhase: { basePrice: {} }, expiryTime: iso(NOW + 30 * DAY) }));
    const renewed = await api.push({ subscriptionNotification: { version: '1.0', notificationType: 2, purchaseToken: TOK } }, { messageId: 'm2' });
    assert.equal(renewed.status, 200);
    assert.equal(renewed.json.applied, true);
    assert.equal(renewed.json.condition, 'active');
    assert.equal(googleRows(f)[0].condition, 'active');
    const dup = await api.push({ subscriptionNotification: { version: '1.0', notificationType: 2, purchaseToken: TOK } }, { messageId: 'm2' });
    assert.equal(dup.status, 200);
    assert.equal(dup.json.reason, 'already_applied');

    /* Revoked: Google's re-read shows it ended, so the row says revoked. */
    google.put(TOK, playSub({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' },
                            { offerPhase: { basePrice: {} }, expiryTime: iso(NOW - 1000) }));
    const rv = await api.push({ subscriptionNotification: { version: '1.0', notificationType: 12, purchaseToken: TOK } }, { messageId: 'm3' });
    assert.equal(rv.json.condition, 'revoked');
    assert.equal(googleRows(f)[0].condition, 'revoked');
    const ev = f.rows('billing_events').map(e => e.provider + ':' + e.provider_event_id + ':' + e.result);
    assert.deepEqual(ev, ['google:m1:unattributable', 'google:m2:processed', 'google:m3:processed']);

    /* A token Google does not know, a one-time product, another package: 200, nothing applied. */
    assert.equal((await api.push({ subscriptionNotification: { notificationType: 4, purchaseToken: 'gp.unknownCCCCCCCCCCCCCCCC' } })).json.reason, 'purchase_not_found');
    assert.equal((await api.push({ oneTimeProductNotification: { notificationType: 1, purchaseToken: TOK } })).json.reason, 'not_entitlement_relevant');
    assert.equal((await api.push({ packageName: 'com.example.other', subscriptionNotification: { notificationType: 4, purchaseToken: TOK } })).json.reason, 'other_package');
  });
});

test('a plan change or resubscribe is attributed through the purchase it replaced', async () => {
  await withWorld({}, async ({ f, google, api }) => {
    google.put(TOK, playSub({}, { offerPhase: { basePrice: {} }, offerDetails: { basePlanId: 'monthly', offerId: null } }));
    assert.equal((await api.sub({ action: 'google_verify', purchaseToken: TOK })).status, 200);
    /* monthly to annual, made in the app: a new token naming the old one */
    google.put(TOK2, playSub({ linkedPurchaseToken: TOK }, { offerPhase: { basePrice: {} }, offerDetails: { basePlanId: 'annual', offerId: null }, expiryTime: iso(NOW + 365 * DAY) }));
    google.put(TOK, playSub({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
                              canceledStateContext: { replacementCancellation: {} } }, { offerPhase: { basePrice: {} }, expiryTime: iso(NOW - 1000) }));
    const r = await api.push({ subscriptionNotification: { notificationType: 4, purchaseToken: TOK2 } }, { messageId: 'm9' });
    assert.equal(r.json.applied, true, JSON.stringify(r.json));
    const rows = googleRows(f);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(x => x.account_id === ATHLETE));
    assert.equal(rows.filter(x => x.provider_subscription_id === TOK2)[0].offer_code, 'STANDARD_YEARLY');
    assert.equal(rows.filter(x => x.provider_subscription_id === TOK)[0].condition, 'expired', 'the replaced purchase was not refreshed');
    assert.ok(google.state.acks.indexOf(TOK2) !== -1, 'the replacement was not acknowledged');
  });
});

// ===========================================================================
// 5. THE RUNTIME
// ===========================================================================
const PINNED = '2026-11-18T09:00:00Z';
const tick = () => new Promise(r => setImmediate(r));
async function settle(n){ for (let i = 0; i < (n || 12); i++) await tick(); }
function prepBody(over){
  return Object.assign({ commerce_enabled: true, provider_configured: true, purchase_allowed: true, reason: 'ok',
    obfuscated_account_id: 'OBF-ID', product_id: 'sacoro_standard', base_plans: { monthly: 'monthly', yearly: 'annual' },
    trial_eligible: true, trial_days: 7, agreements: Agree.currentAgreements() }, over || {});
}
/* Play's own prices, deliberately not the catalogue's, so a screen that typed
   £79.99 would be caught. */
function playProducts(withTrial){
  const annual = [{ basePlanId: 'annual', offerId: null, offerToken: 'TOK_ANNUAL', freeTrial: false,
                    formattedPrice: '€89.99', priceMicros: 89990000, currency: 'EUR', offerTags: [] }];
  const monthly = [{ basePlanId: 'monthly', offerId: null, offerToken: 'TOK_MONTHLY', freeTrial: false,
                     formattedPrice: '€13.49', priceMicros: 13490000, currency: 'EUR', offerTags: [] }];
  if (withTrial !== false){
    annual.push({ basePlanId: 'annual', offerId: 'free-trial-7d', offerToken: 'TOK_ANNUAL_TRIAL', freeTrial: true,
                  formattedPrice: '€89.99', priceMicros: 89990000, currency: 'EUR', offerTags: [] });
    monthly.push({ basePlanId: 'monthly', offerId: 'free-trial-7d', offerToken: 'TOK_MONTHLY_TRIAL', freeTrial: true,
                   formattedPrice: '€13.49', priceMicros: 13490000, currency: 'EUR', offerTags: [] });
  }
  return { found: true, productId: 'sacoro_standard', basePlans: [{ basePlanId: 'annual', offers: annual }, { basePlanId: 'monthly', offers: monthly }] };
}
function playWorld(o){
  const x = o || {};
  const sent = [], purchases = [];
  let listener = null;
  const a = loadApp({ pinnedDate: PINNED, fetch: async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    sent.push({ url: String(url), body: body, auth: init && init.headers && init.headers.Authorization });
    const reply = (status, data) => ({ status: status, ok: status === 200, json: async () => data });
    if (url === '/api/subscription' && body.action === 'google_prepare') return reply(200, prepBody(x.prep));
    if (url === '/api/subscription' && body.action === 'google_verify') return x.verify ? reply(x.verify.status, x.verify.body) : reply(200, { result: 'google_verified' });
    if (url === '/api/session') return reply(200, { signed_in: true, reason: x.sessionReason || 'subscription_trial' });
    return reply(404, {});
  } });
  a.showToast = m => { (a.toasts = a.toasts || []).push(m); };
  const plugin = {
    getProducts: async () => playProducts(x.playTrial),
    purchase: async (p) => { purchases.push(p);
      setTimeout(() => listener(x.outcome || { status: 'purchased', purchase: { purchaseToken: 'PT_1', productIds: ['sacoro_standard'],
        purchaseState: 'purchased', isAcknowledged: false } }), 1);
      return { launched: true }; },
    addListener: (name, cb) => { assert.equal(name, 'purchaseUpdated'); listener = cb; return Promise.resolve({ remove(){} }); },
    queryActivePurchases: async () => ({ purchases: x.active || [] }),
    openManageSubscription: async (p) => { (a.opened = a.opened || []).push(p); return { opened: true }; }
  };
  a.window.Capacitor = { isNativePlatform: () => true, getPlatform: () => (x.platform || 'android'),
                         Plugins: x.noPlugin ? {} : { SacoroBilling: plugin } };
  a.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14; wv)' + (x.marker === false ? '' : ' SACORO-Store-Build');
  a.cloudSession = { access_token: 'tok-athlete', user_id: 'u1', expires_at: Date.now() + 3600e3 };
  return { a, sent, purchases, plugin };
}
function atTrial(a, period){
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  a.journeyWrite({ v: 1, step: 'trial', built: true, drives: [], slide: 0, period: period || 'yearly' });
  a.renderApp = () => {};
  return a;
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('who uses Play: only the Android store build with the billing plugin', () => {
  const play = playWorld().a;
  assert.equal(play.playPurchasesAvailable(), true);
  assert.equal(play.journeyPaymentProvider().id, 'store');
  assert.equal(play.journeyPaymentProvider().showsPrices, true);
  assert.equal(play.journeyPaymentProvider().available, true);
  /* iOS: still a store build, still nothing sold in the app */
  const ios = playWorld({ platform: 'ios' }).a;
  assert.equal(ios.playPurchasesAvailable(), false);
  assert.equal(ios.journeyPaymentProvider().showsPrices, false);
  /* an Android store build without the plugin: as before */
  const old = playWorld({ noPlugin: true }).a;
  assert.equal(old.playPurchasesAvailable(), false);
  assert.equal(old.journeyPaymentProvider().available, false);
  /* the website-distributed APK is the web rail, plugin or not */
  const apk = playWorld({ marker: false }).a;
  assert.equal(apk.playPurchasesAvailable(), false);
  assert.equal(apk.journeyPaymentProvider().id, 'app');
  /* the website */
  const web = loadApp({ pinnedDate: PINNED });
  assert.equal(web.playPurchasesAvailable(), false);
  assert.equal(web.journeyPaymentProvider().id, 'web');
});

test('iOS and a store build without the plugin still answer store_unavailable', async () => {
  for (const w of [playWorld({ platform: 'ios' }), playWorld({ noPlugin: true })]){
    const a = atTrial(w.a);
    assert.deepEqual(JSON.parse(JSON.stringify(await a.journeyPaymentProvider().start('yearly'))), { ok: false, code: 'store_unavailable' });
    const h = a.renderJourneyTrial();
    assert.match(h, /Subscriptions are not available in the app yet/);
    assert.doesNotMatch(h, /€|£|journey-agree|journey-trial-start/);
    assert.equal(w.sent.filter(s => /google_/.test(JSON.stringify(s.body))).length, 0, 'iOS asked the Play routes');
  }
});

test('the Play trial screen shows Play\'s localised prices, not the catalogue\'s', async () => {
  const { a } = playWorld();
  atTrial(a);
  assert.match(a.renderJourneyTrial(), /One moment\./);
  await settle();
  const h = a.renderJourneyTrial();
  const t = text(h);
  assert.match(t, /Start Your 7-Day Free Trial/);
  assert.match(t, /Annual €89\.99 \/ year/);
  assert.match(t, /Monthly €13\.49 \/ month/);
  assert.doesNotMatch(h, /£79\.99|£11\.99/, 'a catalogue price was typed onto the Play screen');
  assert.match(t, /Day 8: €89\.99 , then annually/);
  assert.match(h, /data-action="journey-agree" data-kind="terms"/);
  assert.match(h, /data-action="journey-agree" data-kind="immediate_start"/);
  assert.match(h, /data-action="journey-trial-start" disabled>Start My Free Trial</);
  assert.match(t, /Payment is handled by Google Play\./);
  assert.doesNotMatch(h, /api\/checkout|Secure payment setup/, 'the web checkout leaked into the Play build');
});

test('the trial offer is passed to Play only when SACORO\'s rule allows it and Play offers one', async () => {
  /* eligible, Play offers a trial: the trial offer */
  let w = playWorld();
  atTrial(w.a);
  w.a.journeyAgreed.terms = true; w.a.journeyAgreed.immediate_start = true;
  let res = await w.a.playStart('yearly');
  assert.equal(res.verified, true);
  assert.deepEqual(JSON.parse(JSON.stringify(w.purchases)), [{ productId: 'sacoro_standard', basePlanId: 'annual',
    offerToken: 'TOK_ANNUAL_TRIAL', obfuscatedAccountId: 'OBF-ID' }]);
  /* not eligible under SACORO's rule: the base plan, even though Play would give a trial */
  w = playWorld({ prep: { trial_eligible: false } });
  atTrial(w.a);
  await w.a.playStart('monthly');
  assert.equal(w.purchases[0].offerToken, 'TOK_MONTHLY');
  await settle();
  w.a.playEnsureLoaded(); await settle();
  assert.doesNotMatch(text(w.a.renderJourneyTrial()), /Free Trial|Day 8/, 'a trial was promised to an athlete who has had one');
  /* eligible, but Play offers no trial to this Google account: the base plan */
  w = playWorld({ playTrial: false });
  atTrial(w.a);
  await w.a.playStart('yearly');
  assert.equal(w.purchases[0].offerToken, 'TOK_ANNUAL');
  /* the server says no: Play is never opened */
  w = playWorld({ prep: { purchase_allowed: false, reason: 'terms_not_accepted', obfuscated_account_id: null } });
  res = await w.a.playStart('yearly');
  assert.deepEqual(JSON.parse(JSON.stringify(res)), { ok: false, code: 'terms_not_accepted' });
  assert.equal(w.purchases.length, 0);
});

test('after the purchase: the token goes to the server with the athlete\'s token, then the gate, then the journey moves on', async () => {
  const w = playWorld();
  const a = atTrial(w.a);
  await settle();
  a.journeyAgreed.terms = true; a.journeyAgreed.immediate_start = true;
  a.handleJourneyTrialStart();
  await new Promise(r => setTimeout(r, 20)); await settle();
  const verify = w.sent.filter(s => s.body.action === 'google_verify');
  assert.equal(verify.length, 1);
  assert.deepEqual(verify[0].body, { action: 'google_verify', purchaseToken: 'PT_1', productId: 'sacoro_standard' });
  assert.equal(verify[0].auth, 'Bearer tok-athlete');
  assert.ok(w.sent.some(s => s.url === '/api/session'), 'the gate was not asked again');
  assert.equal(a.journeyStep(), 'arrive', 'the journey did not move on to Welcome to SACORO');
  assert.ok(a.toasts.indexOf('Your free trial has started') !== -1);
  /* the device acknowledged nothing: there is no such call */
  assert.equal(Object.keys(w.plugin).indexOf('acknowledge'), -1);
});

test('cancel and error: short plain messages, and the athlete stays where they were', async () => {
  for (const [outcome, says] of [[{ status: 'cancelled', responseCode: 1 }, 'Purchase cancelled. Nothing has been charged.'],
                                 [{ status: 'error', responseCode: 6 }, 'Google Play could not complete the purchase. Nothing has been charged.'],
                                 [{ status: 'pending', purchase: { purchaseToken: 'PT_2', purchaseState: 'pending' } }, 'Your payment is pending with Google Play. SACORO opens as soon as it is confirmed.']]){
    const w = playWorld({ outcome: outcome });
    const a = atTrial(w.a);
    await settle();
    a.handleJourneyTrialStart();
    await new Promise(r => setTimeout(r, 20)); await settle();
    assert.equal(a.journeyTrialNote, says);
    assert.equal(a.journeyStep(), 'trial');
    assert.equal(w.sent.filter(s => s.body.action === 'google_verify').length, 0, 'a purchase that did not complete was sent for verification');
    assert.doesNotMatch(says, /—/);
  }
  /* the server refuses a second trial */
  const w = playWorld({ verify: { status: 409, body: { error: 'trial_already_used' } } });
  const a = atTrial(w.a);
  await settle();
  a.handleJourneyTrialStart();
  await new Promise(r => setTimeout(r, 20)); await settle();
  assert.equal(a.journeyTrialNote, 'This account has already had its free trial. Nothing has been charged.');
});

test('recovery: an unacknowledged purchase is sent again on start and resume; acknowledged ones are left alone', async () => {
  const w = playWorld({ active: [
    { purchaseToken: 'PT_OPEN', productIds: ['sacoro_standard'], purchaseState: 'purchased', isAcknowledged: false },
    { purchaseToken: 'PT_DONE', productIds: ['sacoro_standard'], purchaseState: 'purchased', isAcknowledged: true },
    { purchaseToken: 'PT_PEND', productIds: ['sacoro_standard'], purchaseState: 'pending', isAcknowledged: false }] });
  w.a.renderApp = () => {};
  w.a.cloudSignedIn = () => true;
  const n = await w.a.playRecoverPurchases(true);
  assert.equal(n, 1);
  assert.deepEqual(w.sent.filter(s => s.body.action === 'google_verify').map(s => s.body.purchaseToken), ['PT_OPEN']);
  assert.ok(w.sent.some(s => s.url === '/api/session'));
  /* rate-limited on resume, not on start */
  assert.equal(await w.a.playRecoverPurchases(false), 0);
  const src = read('protected/velvet-viking-valhalla.html');
  assert.match(src, /try\{ playRecoverPurchases\(false\); \}catch\(e\)\{\}/, 'resume does not recover');
  assert.match(src, /try \{ playRecoverPurchases\(true\); \} catch\(e\)\{\}/, 'start does not recover');
  /* nothing at all outside the Play build */
  const web = loadApp({ pinnedDate: PINNED });
  assert.equal(await web.playRecoverPurchases(true), 0);
});

test('Settings in the Play build: Play prices to subscribe, Google Play to manage', async () => {
  const w = playWorld();
  const a = w.a;
  a.renderApp = () => {};
  const needs = { signed_in: true, commercial_required: true, access: false, state: null, checkout_configured: false };
  a.renderPlaySubscriptionActions(needs);
  await settle();
  const h = a.renderSubscriptionActions(needs);
  assert.match(text(h), /Annual €89\.99 \/ year/);
  assert.match(h, /data-action="play-start"/);
  assert.doesNotMatch(h, /subscription-resubscribe|subscription-manage|mailto:/, 'the web controls appeared in the Play build');
  const managed = a.renderSubscriptionActions({ signed_in: true, commercial_required: true, access: true, state: 'trial',
                                                management_provider: 'google', manageable_here: false });
  assert.match(managed, /data-action="play-manage"[^>]*>[^]*Manage in Google Play<\/button>/);
  a.handlePlayManage();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(a.opened)), [{ productId: 'sacoro_standard' }]);
  const web = a.renderSubscriptionActions({ signed_in: true, commercial_required: true, access: true, state: 'active',
                                            management_provider: 'web', manageable_here: true });
  assert.match(web, /Manage or cancel your subscription where you bought it/);
  /* iOS Settings are exactly as before */
  const ios = playWorld({ platform: 'ios' }).a;
  assert.match(ios.renderSubscriptionActions(needs), /Manage or cancel your subscription where you bought it/);
});

test('the Play copy keeps the house rules', () => {
  const src = read('protected/velvet-viking-valhalla.html');
  const block = src.slice(src.indexOf('---------- GOOGLE PLAY PURCHASES (the Play Store build)'), src.indexOf('function handlePlayManage('));
  assert.ok(block.length > 1000);
  assert.doesNotMatch(block, /—|\\u2014|&mdash;/);
  ['Manage in Google Play', 'Start My Free Trial', 'Subscribe'].forEach(l => assert.ok(src.indexOf(l) !== -1));
  assert.equal((src.match(/<style\b/g) || []).length, 1, 'a second style tag');
});

// ===========================================================================
// 6. THE NATIVE BUILD AND CI
// ===========================================================================
test('the manifest names the BILLING permission, and the build carries the current Play Billing Library', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /<uses-permission android:name="com\.android\.vending\.BILLING" \/>/);
  const gradle = read('android/app/build.gradle');
  const v = /implementation "com\.android\.billingclient:billing:(\d+)\.(\d+)\.(\d+)"/.exec(gradle);
  assert.ok(v, 'the Play Billing Library is not a dependency');
  assert.ok(Number(v[1]) >= 8, 'Play requires Billing Library 8 or later for new uploads');
});

test('versionCode 12, versionName 1.11: Play requires a new version for every upload', () => {
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /versionCode 12\s+versionName "1\.11"/);
});

test('the plugin is registered, and it never acknowledges a purchase on the device', () => {
  const main = read('android/app/src/main/java/com/velvetviking/valhalla/MainActivity.java');
  const reg = main.indexOf('registerPlugin(SacoroBillingPlugin.class);');
  assert.ok(reg !== -1, 'SacoroBilling is not registered');
  assert.ok(reg < main.indexOf('super.onCreate(savedInstanceState);'), 'registered after the bridge was built');
  const plugin = read('android/app/src/main/java/com/velvetviking/valhalla/SacoroBillingPlugin.java');
  assert.match(plugin, /@CapacitorPlugin\(name = "SacoroBilling"\)/);
  const code = plugin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(code, /acknowledgePurchase|AcknowledgePurchaseParams|consumeAsync/, 'the device acknowledges purchases');
  ['isReady', 'connect', 'getProducts', 'purchase', 'queryActivePurchases', 'openManageSubscription'].forEach(m =>
    assert.match(code, new RegExp('@PluginMethod\\s+public void ' + m + '\\(')));
  assert.match(code, /setObfuscatedAccountId\(accountId\)/);
  assert.match(code, /notifyListeners\(EVENT_PURCHASE, ev, true\)/);
  assert.match(plugin, /"https:\/\/play\.google\.com\/store\/account\/subscriptions\?package=" \+ Uri\.encode\(pkg\)/);
});

test('the CI Play build: an input, off by default, that marks only the runner\'s copy', () => {
  const wf = read('.github/workflows/build-apk.yml');
  assert.match(wf, /play_store_build:\s*\n\s*description:[^\n]*\n\s*required: false\s*\n\s*type: boolean\s*\n\s*default: false/);
  const mark = wf.indexOf('Mark this as a Play Store build');
  assert.ok(mark > wf.indexOf('run: npm test'), 'the marker is written before the suite, which pins its absence');
  assert.ok(mark < wf.indexOf('run: npx cap sync android'), 'the marker is written after the native project is synced');
  assert.match(wf.slice(mark, wf.indexOf('run: npx cap sync android')),
    /if: \$\{\{ github\.event\.inputs\.play_store_build == 'true' \}\}[\s\S]*appendUserAgent='SACORO-Store-Build'/);
  assert.match(wf, /velvet-viking-valhalla-PLAY-STORE'/, 'the Play bundle is not named apart');
  assert.match(wf, /github\.event\.inputs\.play_store_build != 'true'/, 'a Play build is published as the website APK');
  /* and the repository's own config stays the website-distributed one */
  assert.equal(read('capacitor.config.json').indexOf('SACORO-Store-Build'), -1);
});

test('the documents say what is now true', () => {
  const doc = read('GOOGLE-PLAY-BILLING.md');
  ['sacoro_standard', 'monthly', 'annual', 'free-trial-7d', 'com.android.vending.BILLING',
   'VVV_GOOGLE_PLAY_SERVICE_ACCOUNT', 'VVV_GOOGLE_ACCOUNT_ID_SECRET', 'VVV_GOOGLE_RTDN_AUDIENCE',
   'VVV_GOOGLE_RTDN_SERVICE_ACCOUNT', 'VVV_PRICE_GOOGLE_STANDARD_MONTHLY', 'VVV_PRICE_GOOGLE_STANDARD_YEARLY',
   'projects/sacoro-billing/topics/sacoro-play-billing', 'https://app.velvetviking.co.uk/api/billing-webhook?rail=google',
   'play_store_build', 'internal testing'].forEach(s => assert.ok(doc.indexOf(s) !== -1, 'GOOGLE-PLAY-BILLING.md does not mention ' + s));
  const boundary = read('STORE-COMMERCIAL-BOUNDARY.md');
  assert.doesNotMatch(boundary, /There is no Apple or Google purchase code in the repository at all/);
  assert.match(boundary, /_google\.js/);
});
