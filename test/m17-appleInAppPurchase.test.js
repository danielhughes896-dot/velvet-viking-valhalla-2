'use strict';
// APP STORE IN-APP PURCHASE (founder, 18 November 2026: "once this [Google
// Play] is done you need to do the same for iOS").
//
// The Apple rail, built the way the Play rail was: a channel feeding the
// provider-neutral core, nothing more. What is held here:
//   1. Apple-signed data: the x5c chain to Apple Root CA - G3 (a locally
//      generated test CA stands in for Apple's), the two Apple OIDs, the
//      signature, the bundle id, the environment and the dates; and the real
//      Apple chain against the embedded root;
//   2. the tokens this server signs with the In-App Purchase key: the App
//      Store Server API token and the introductory-offer eligibility JWS, with
//      exactly the claims Apple documents;
//   3. every App Store status on the six-word vocabulary;
//   4. the prepare and verify routes through the real router against a fake
//      App Store Server API and a fake Supabase: somebody else's purchase
//      refused, a second live subscription refused, the one trial spent once
//      and signed "not eligible" afterwards, nothing refused ever finished;
//   5. the webhook branch chosen by the REQUEST, and what it does;
//   6. the runtime: iOS with the plugin uses StoreKit, iOS without it is
//      store_unavailable, Play / the website / the website APK unchanged;
//   7. the Xcode project, the plugin registration and the deployment target.
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
const AP = require('../api/_apple.js');
const AXP = require('../api/_apple-purchase.js');
const account = require('../api/account.js');
const webhook = require('../api/billing-webhook.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const ATHLETE = '11111111-1111-4111-8111-111111111111';
const OTHER   = '22222222-2222-4222-8222-222222222222';
const DAY = 24 * 3600 * 1000;
const NOW = Date.now();
const iso = ms => new Date(ms).toISOString();

const MONTHLY = 'sacoro.standard.monthly';
const ANNUAL = 'sacoro.standard.annual';
const ENV_OFFERS = { VVV_PRICE_APPLE_STANDARD_MONTHLY: MONTHLY, VVV_PRICE_APPLE_STANDARD_YEARLY: ANNUAL };
const SECRET = 'test-apple-account-token-secret';
const APP_APPLE_ID = '6700000001';
const IAP_KEYS = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const IAP_PEM = IAP_KEYS.privateKey.export({ type: 'pkcs8', format: 'pem' });
const BASE_ENV = Object.assign({
  VVV_APPLE_IAP_KEY_ID: 'TESTKEY123', VVV_APPLE_IAP_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
  VVV_APPLE_IAP_PRIVATE_KEY: IAP_PEM, VVV_APPLE_ACCOUNT_TOKEN_SECRET: SECRET,
  VVV_APPLE_APP_APPLE_ID: APP_APPLE_ID, VVV_APPLE_ENVIRONMENTS: 'Production,Sandbox'
}, ENV_OFFERS);
const ACFG = AP.config(BASE_ENV);

// ===========================================================================
// A LOCALLY GENERATED TEST CA, built in DER here (node cannot issue
// certificates), shaped like Apple's: root -> intermediate (CA, Apple's WWDR
// OID) -> leaf (Apple's receipt-signing OID), ECDSA P-256 with SHA-256.
// ===========================================================================
function dlen(n){
  if (n < 128) return Buffer.from([n]);
  const b = []; while (n > 0){ b.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | b.length].concat(b));
}
function der(tag){ const body = Buffer.concat([].slice.call(arguments, 1)); return Buffer.concat([Buffer.from([tag]), dlen(body.length), body]); }
const seq = function(){ return der.apply(null, [0x30].concat([].slice.call(arguments))); };
const set = function(){ return der.apply(null, [0x31].concat([].slice.call(arguments))); };
function oid(s){
  const a = s.split('.').map(Number); const out = [40 * a[0] + a[1]];
  a.slice(2).forEach(n => { const t = [n & 0x7f]; n = Math.floor(n / 128); while (n > 0){ t.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); } out.push(...t); });
  return der(0x06, Buffer.from(out));
}
const int = n => der(0x02, Buffer.from([n]));
const name = cn => seq(set(seq(oid('2.5.4.3'), der(0x0c, Buffer.from(cn)))));
const gtime = ms => der(0x18, Buffer.from(new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'));
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));
const ext = (o, critical, value) => seq(oid(o), ...(critical ? [der(0x01, Buffer.from([0xff]))] : []), der(0x04, value));
let serial = 1;
function makeCert(o){
  const exts = [];
  if (o.ca) exts.push(ext('2.5.29.19', true, seq(der(0x01, Buffer.from([0xff])))));
  (o.oids || []).forEach(x => exts.push(ext(x, false, der(0x05, Buffer.alloc(0)))));
  const tbs = seq(der(0xa0, int(2)), int(serial++), ECDSA_SHA256, name(o.issuer), seq(gtime(o.from), gtime(o.to)),
                  name(o.subject), o.publicKey.export({ type: 'spki', format: 'der' }), der(0xa3, seq(...exts)));
  const sig = crypto.sign('sha256', tbs, o.signKey);
  return seq(tbs, ECDSA_SHA256, der(0x03, Buffer.concat([Buffer.from([0]), sig])));
}
function makeCa(label, o){
  const x = o || {};
  const rootKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const interKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const leafKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const from = NOW - 365 * DAY, to = NOW + 365 * DAY;
  const root = makeCert({ issuer: label + ' Root', subject: label + ' Root', from, to, publicKey: rootKeys.publicKey, signKey: rootKeys.privateKey, ca: true });
  const inter = makeCert({ issuer: label + ' Root', subject: label + ' Intermediate', from, to, publicKey: interKeys.publicKey,
                           signKey: rootKeys.privateKey, ca: true, oids: x.noInterOid ? [] : [AP.OID_INTERMEDIATE] });
  const leaf = makeCert({ issuer: label + ' Intermediate', subject: label + ' Leaf', from: x.leafFrom || from, to: x.leafTo || to,
                          publicKey: leafKeys.publicKey, signKey: interKeys.privateKey, oids: x.noLeafOid ? [] : [AP.OID_LEAF] });
  return { root: new crypto.X509Certificate(root), x5c: [leaf, inter, root].map(b => b.toString('base64')), leafKey: leafKeys.privateKey };
}
const CA = makeCa('Test Apple');
const ROGUE = makeCa('Rogue');
const b64u = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
function signApple(payload, o){
  const x = o || {};
  const ca = x.ca || CA;
  const unsigned = b64u({ alg: x.alg || 'ES256', x5c: x.x5c || ca.x5c }) + '.' + b64u(payload);
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: ca.leafKey, dsaEncoding: 'ieee-p1363' });
  return unsigned + '.' + sig.toString('base64url');
}
const ROOTS = [CA.root];

function txPayload(over){
  return Object.assign({
    transactionId: '2000000000000001', originalTransactionId: '2000000000000001',
    bundleId: 'com.velvetviking.valhalla', productId: MONTHLY, subscriptionGroupIdentifier: '21000001',
    purchaseDate: NOW - DAY, originalPurchaseDate: NOW - DAY, expiresDate: NOW + 6 * DAY,
    quantity: 1, type: 'Auto-Renewable Subscription', appAccountToken: AP.appAccountToken(ATHLETE, SECRET),
    inAppOwnershipType: 'PURCHASED', signedDate: NOW - 1000, environment: 'Sandbox',
    offerType: 1, offerDiscountType: 'FREE_TRIAL', transactionReason: 'PURCHASE', storefront: 'GBR', currency: 'GBP', price: 0
  }, over || {});
}
function renewalPayload(over){
  return Object.assign({ originalTransactionId: '2000000000000001', autoRenewProductId: MONTHLY, productId: MONTHLY,
    autoRenewStatus: 1, signedDate: NOW - 1000, environment: 'Sandbox', recentSubscriptionStartDate: NOW - DAY }, over || {});
}

// ===========================================================================
// 1. APPLE-SIGNED DATA
// ===========================================================================
test('a signed transaction verifies only through a trusted chain, with Apple\'s OIDs and a good signature', () => {
  const v = (jws, o) => AP.verifyTransaction(jws, ACFG, Object.assign({ roots: ROOTS }, o || {}));
  const good = v(signApple(txPayload()));
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.equal(good.transaction.originalTransactionId, '2000000000000001');
  /* the wrong root: a perfectly formed chain, from somebody else's CA */
  assert.equal(v(signApple(txPayload(), { ca: ROGUE })).reason, 'untrusted_chain');
  /* a chain that carries the trusted root in x5c[2] but was not signed by it */
  assert.equal(v(signApple(txPayload(), { ca: ROGUE, x5c: [ROGUE.x5c[0], ROGUE.x5c[1], CA.x5c[2]] })).reason, 'untrusted_chain',
    'the root in x5c was trusted for being there');
  /* a bad signature: the payload edited after signing */
  const parts = signApple(txPayload()).split('.');
  assert.equal(v(parts[0] + '.' + b64u(txPayload({ productId: ANNUAL })) + '.' + parts[2]).reason, 'bad_signature');
  assert.equal(v(parts[0] + '.' + parts[1] + '.' + Buffer.alloc(64).toString('base64url')).reason, 'bad_signature');
  /* the wrong app */
  assert.equal(v(signApple(txPayload({ bundleId: 'com.example.other' }))).reason, 'wrong_bundle');
  /* the wrong environment for this deployment */
  const prodOnly = AP.config(Object.assign({}, BASE_ENV, { VVV_APPLE_ENVIRONMENTS: 'Production' }));
  assert.equal(AP.verifyTransaction(signApple(txPayload()), prodOnly, { roots: ROOTS }).reason, 'wrong_environment');
  assert.equal(v(signApple(txPayload({ environment: 'Xcode' }))).reason, 'wrong_environment', 'Xcode-signed data is not the App Store\'s');
  /* expired: the leaf had lapsed when the data was signed */
  const lapsed = makeCa('Lapsed', { leafFrom: NOW - 400 * DAY, leafTo: NOW - 30 * DAY });
  assert.equal(AP.verifyTransaction(signApple(txPayload(), { ca: lapsed }), ACFG, { roots: [lapsed.root] }).reason, 'certificate_expired');
  /* ...but data signed while it was valid still verifies after it lapses (Apple's own rule) */
  assert.equal(AP.verifyTransaction(signApple(txPayload({ signedDate: NOW - 60 * DAY })), ACFG,
                                    { roots: [lapsed.root] }).ok, false);
  assert.equal(AP.verifyTransaction(signApple(txPayload({ signedDate: NOW - 60 * DAY }), { ca: lapsed }), ACFG,
                                    { roots: [lapsed.root] }).ok, true);
  assert.equal(v(signApple(txPayload({ signedDate: NOW + 3600e3 }))).reason, 'signed_in_future');
  /* Apple's two extensions are required */
  const noLeaf = makeCa('NoLeafOid', { noLeafOid: true });
  assert.equal(AP.verifyTransaction(signApple(txPayload(), { ca: noLeaf }), ACFG, { roots: [noLeaf.root] }).reason, 'leaf_oid_missing');
  const noInter = makeCa('NoInterOid', { noInterOid: true });
  assert.equal(AP.verifyTransaction(signApple(txPayload(), { ca: noInter }), ACFG, { roots: [noInter.root] }).reason, 'intermediate_oid_missing');
  /* shape */
  assert.equal(v(signApple(txPayload(), { x5c: CA.x5c.slice(0, 2) })).reason, 'invalid_chain_length');
  assert.equal(v(signApple(txPayload(), { alg: 'HS256' })).reason, 'bad_algorithm');
  assert.equal(v('not.a.jws').reason, 'malformed');
  /* and with no roots passed, only Apple's root is trusted: the test CA is not */
  assert.equal(AP.verifyTransaction(signApple(txPayload()), ACFG).reason, 'untrusted_chain');
});

/* The real chain, from Apple's own App Store Server Library test resources
   (app-store-server-library-node, jws_verification.test.js,
   REAL_APPLE_INTERMEDIATE_BASE64_ENCODED and
   REAL_APPLE_SIGNING_CERTIFICATE_BASE64_ENCODED; MIT licence): Apple's
   Worldwide Developer Relations G6 intermediate and an App Store signing
   leaf valid 19 Sep 2025 to 13 Oct 2027. Public certificates. */
const REAL_INTERMEDIATE =
  'MIIDFjCCApygAwIBAgIUIsGhRwp0c2nvU4YSycafPTjzbNcwCgYIKoZIzj0EAwMwZzEbMBkGA1UE' +
  'AwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhv' +
  'cml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMjEwMzE3MjAzNzEwWhcN' +
  'MzYwMzE5MDAwMDAwWjB1MUQwQgYDVQQDDDtBcHBsZSBXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0' +
  'aW9ucyBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTELMAkGA1UECwwCRzYxEzARBgNVBAoMCkFwcGxl' +
  'IEluYy4xCzAJBgNVBAYTAlVTMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEbsQKC94PrlWmZXnXgtxz' +
  'dVJL8T0SGYngDRGpngn3N6PT8JMEb7FDi4bBmPhCnZ3/sq6PF/cGcKXWsL5vOteRhyJ45x3ASP7c' +
  'OB+aao90fcpxSv/EZFbniAbNgZGhIhpIo4H6MIH3MBIGA1UdEwEB/wQIMAYBAf8CAQAwHwYDVR0j' +
  'BBgwFoAUu7DeoVgziJqkipnevr3rr9rLJKswRgYIKwYBBQUHAQEEOjA4MDYGCCsGAQUFBzABhipo' +
  'dHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFwcGxlcm9vdGNhZzMwNwYDVR0fBDAwLjAsoCqg' +
  'KIYmaHR0cDovL2NybC5hcHBsZS5jb20vYXBwbGVyb290Y2FnMy5jcmwwHQYDVR0OBBYEFD8vlCNR' +
  '01DJmig97bB85c+lkGKZMA4GA1UdDwEB/wQEAwIBBjAQBgoqhkiG92NkBgIBBAIFADAKBggqhkjO' +
  'PQQDAwNoADBlAjBAXhSq5IyKogMCPtw490BaB677CaEGJXufQB/EqZGd6CSjiCtOnuMTbXVXmxxc' +
  'xfkCMQDTSPxarZXvNrkxU3TkUMI33yzvFVVRT4wxWJC994OsdcZ4+RGNsYDyR5gmdr0nDGg=';
const REAL_LEAF =
  'MIIEMTCCA7agAwIBAgIQR8KHzdn554Z/UoradNx9tzAKBggqhkjOPQQDAzB1MUQwQgYDVQQDDDtB' +
  'cHBsZSBXb3JsZHdpZGUgRGV2ZWxvcGVyIFJlbGF0aW9ucyBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0' +
  'eTELMAkGA1UECwwCRzYxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMB4XDTI1MDkx' +
  'OTE5NDQ1MVoXDTI3MTAxMzE3NDcyM1owgZIxQDA+BgNVBAMMN1Byb2QgRUNDIE1hYyBBcHAgU3Rv' +
  'cmUgYW5kIGlUdW5lcyBTdG9yZSBSZWNlaXB0IFNpZ25pbmcxLDAqBgNVBAsMI0FwcGxlIFdvcmxk' +
  'd2lkZSBEZXZlbG9wZXIgUmVsYXRpb25zMRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJV' +
  'UzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABNnVvhcv7iT+7Ex5tBMBgrQspHzIsXRi0Yxfek7l' +
  'v8wEmj/bHiWtNwJqc2BoHzsQiEjP7KFIIKg4Y8y0/nynuAmjggIIMIICBDAMBgNVHRMBAf8EAjAA' +
  'MB8GA1UdIwQYMBaAFD8vlCNR01DJmig97bB85c+lkGKZMHAGCCsGAQUFBwEBBGQwYjAtBggrBgEF' +
  'BQcwAoYhaHR0cDovL2NlcnRzLmFwcGxlLmNvbS93d2RyZzYuZGVyMDEGCCsGAQUFBzABhiVodHRw' +
  'Oi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLXd3ZHJnNjAyMIIBHgYDVR0gBIIBFTCCAREwggENBgoq' +
  'hkiG92NkBQYBMIH+MIHDBggrBgEFBQcCAjCBtgyBs1JlbGlhbmNlIG9uIHRoaXMgY2VydGlmaWNh' +
  'dGUgYnkgYW55IHBhcnR5IGFzc3VtZXMgYWNjZXB0YW5jZSBvZiB0aGUgdGhlbiBhcHBsaWNhYmxl' +
  'IHN0YW5kYXJkIHRlcm1zIGFuZCBjb25kaXRpb25zIG9mIHVzZSwgY2VydGlmaWNhdGUgcG9saWN5' +
  'IGFuZCBjZXJ0aWZpY2F0aW9uIHByYWN0aWNlIHN0YXRlbWVudHMuMDYGCCsGAQUFBwIBFipodHRw' +
  'Oi8vd3d3LmFwcGxlLmNvbS9jZXJ0aWZpY2F0ZWF1dGhvcml0eS8wHQYDVR0OBBYEFIFioG4wMMVA' +
  '1ku9zJmGNPAVn3eqMA4GA1UdDwEB/wQEAwIHgDAQBgoqhkiG92NkBgsBBAIFADAKBggqhkjOPQQD' +
  'AwNpADBmAjEA+qXnREC7hXIWVLsLxznjRpIzPf7VHz9V/CTm8+LJlrQepnmcPvGLNcX6XPnlcgLA' +
  'AjEA5IjNZKgg5pQ79knF4IbTXdKv8vutIDMXDmjPVT3dGvFtsGRwXOywR2kZCdSrfeot';

test('the embedded root is Apple Root CA - G3, and Apple\'s real chain passes every check but the signature', () => {
  assert.equal(AP.APPLE_ROOTS.length, 1, 'the embedded root does not match its published fingerprint');
  const root = AP.APPLE_ROOTS[0];
  assert.equal(root.fingerprint256, '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79');
  assert.match(root.subject, /CN=Apple Root CA - G3/);
  /* Apple's own OIDs are found in Apple's own certificates */
  assert.ok(AP.extensionOids(Buffer.from(REAL_LEAF, 'base64')).indexOf(AP.OID_LEAF) !== -1);
  assert.ok(AP.extensionOids(Buffer.from(REAL_INTERMEDIATE, 'base64')).indexOf(AP.OID_INTERMEDIATE) !== -1);
  /* With Apple's real chain and a forged signature: the chain, the OIDs and
     the dates pass, and the signature is what fails. */
  const signed = Date.parse('2026-06-01T00:00:00Z');
  const jws = b64u({ alg: 'ES256', x5c: [REAL_LEAF, REAL_INTERMEDIATE, AP.APPLE_ROOT_CA_G3_BASE64] }) + '.' +
              b64u({ signedDate: signed }) + '.' + Buffer.alloc(64).toString('base64url');
  assert.equal(AP.verifySignedData(jws, { now: signed + 1000 }).reason, 'bad_signature');
  /* after the leaf's own expiry, data signed then is refused */
  const late = Date.parse('2027-12-01T00:00:00Z');
  const jws2 = b64u({ alg: 'ES256', x5c: [REAL_LEAF, REAL_INTERMEDIATE, AP.APPLE_ROOT_CA_G3_BASE64] }) + '.' +
               b64u({ signedDate: late }) + '.' + Buffer.alloc(64).toString('base64url');
  assert.equal(AP.verifySignedData(jws2, { now: late + 1000 }).reason, 'certificate_expired');
  /* and Apple's real chain is not trusted under a different root */
  assert.equal(AP.verifySignedData(jws, { now: signed + 1000, roots: ROOTS }).reason, 'untrusted_chain');
});

test('a notification is verified for the app, the environment and, in Production, the app\'s Apple ID', () => {
  const n = (data, o) => AP.verifyNotification(signApple({ notificationType: 'DID_RENEW', notificationUUID: 'u-1', signedDate: NOW - 1000,
    data: Object.assign({ bundleId: 'com.velvetviking.valhalla', environment: 'Production', appAppleId: Number(APP_APPLE_ID) }, data) }), ACFG,
    Object.assign({ roots: ROOTS }, o || {}));
  assert.equal(n({}).ok, true);
  assert.equal(n({ appAppleId: 1 }).reason, 'wrong_app');
  assert.equal(n({ bundleId: 'x.y' }).reason, 'wrong_bundle');
  assert.equal(n({ environment: 'Sandbox', appAppleId: undefined }).ok, true, 'Sandbox carries no app Apple ID');
  assert.equal(AP.verifyNotification(signApple({ notificationType: 'TEST', summary: undefined,
    data: { bundleId: 'com.velvetviking.valhalla', environment: 'Sandbox' } }),
    AP.config(Object.assign({}, BASE_ENV, { VVV_APPLE_ENVIRONMENTS: 'Production' })), { roots: ROOTS }).reason, 'wrong_environment');
});

// ===========================================================================
// 2. WHAT THIS SERVER SIGNS
// ===========================================================================
function decode(jwt){
  const [h, p, s] = jwt.split('.');
  return { header: JSON.parse(Buffer.from(h, 'base64url')), claims: JSON.parse(Buffer.from(p, 'base64url')),
           valid: crypto.verify('sha256', Buffer.from(h + '.' + p), { key: IAP_KEYS.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')) };
}
test('the App Store Server API token: ES256 with the In-App Purchase key, Apple\'s claims', () => {
  const t = decode(AP.apiToken(ACFG, 1800000000));
  assert.equal(t.valid, true);
  assert.deepEqual(t.header, { alg: 'ES256', kid: 'TESTKEY123', typ: 'JWT' });
  assert.deepEqual(t.claims, { iss: '57246542-96fe-1a63-e053-0824d011072a', iat: 1800000000, exp: 1800000300,
                               aud: 'appstoreconnect-v1', bid: 'com.velvetviking.valhalla' });
});

test('the introductory-offer eligibility JWS has exactly the claims Apple documents, and no exp', () => {
  const t = decode(AP.introductoryOfferSignature(ACFG, { productId: MONTHLY, allow: false, transactionId: '704289572311837185',
                                                         nowSec: 1800000000, nonce: 'cfb43594-4f92-4fe2-8b06-d947a848adaa' }));
  assert.equal(t.valid, true);
  assert.deepEqual(t.header, { alg: 'ES256', kid: 'TESTKEY123', typ: 'JWT' });
  assert.deepEqual(t.claims, { iss: '57246542-96fe-1a63-e053-0824d011072a', iat: 1800000000,
    aud: 'introductory-offer-eligibility', bid: 'com.velvetviking.valhalla', nonce: 'cfb43594-4f92-4fe2-8b06-d947a848adaa',
    productId: MONTHLY, allowIntroductoryOffer: false, transactionId: '704289572311837185' });
  assert.equal('exp' in t.claims, false, 'Apple: an exp claim makes the request fail');
  /* only a literal true allows the offer */
  assert.equal(decode(AP.introductoryOfferSignature(ACFG, { productId: MONTHLY, allow: 'yes', transactionId: '1' })).claims.allowIntroductoryOffer, false);
  assert.equal(decode(AP.introductoryOfferSignature(ACFG, { productId: MONTHLY, allow: true, transactionId: '1' })).claims.allowIntroductoryOffer, true);
  /* a fresh nonce each time */
  const a = decode(AP.introductoryOfferSignature(ACFG, { productId: MONTHLY, allow: true, transactionId: '1' })).claims.nonce;
  const b = decode(AP.introductoryOfferSignature(ACFG, { productId: MONTHLY, allow: true, transactionId: '1' })).claims.nonce;
  assert.notEqual(a, b);
  assert.equal(AP.introductoryOfferSignature(ACFG, { productId: MONTHLY, allow: true, transactionId: '' }), null);
  assert.equal(AP.introductoryOfferSignature(ACFG, { productId: 'bad id', allow: true, transactionId: '1' }), null);
});

test('the appAccountToken: a v4 UUID, keyed, one-way, the same every time', () => {
  const t = AP.appAccountToken(ATHLETE, SECRET);
  assert.match(t, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(t, AP.appAccountToken(ATHLETE, SECRET));
  assert.notEqual(t, AP.appAccountToken(OTHER, SECRET));
  assert.notEqual(t, AP.appAccountToken(ATHLETE, 'another'));
  assert.notEqual(t.replace(/-/g, ''), ATHLETE.replace(/-/g, ''));
  assert.equal(AP.sameToken(t, t.toUpperCase()), true, 'Apple may echo it in either case');
  assert.equal(AP.sameToken(t, AP.appAccountToken(OTHER, SECRET)), false);
  assert.equal(AP.appAccountToken(ATHLETE, ''), null);
});

test('configuration fails closed and names what is missing, never a value', () => {
  const none = AP.config({});
  assert.equal(none.ok, false);
  assert.deepEqual(none.missing, ['VVV_APPLE_IAP_KEY_ID', 'VVV_APPLE_IAP_ISSUER_ID', 'VVV_APPLE_IAP_PRIVATE_KEY',
    'VVV_APPLE_ACCOUNT_TOKEN_SECRET', 'VVV_APPLE_APP_APPLE_ID', 'VVV_PRICE_APPLE_STANDARD_MONTHLY / VVV_PRICE_APPLE_STANDARD_YEARLY']);
  assert.equal(ACFG.ok, true);
  assert.deepEqual(ACFG.environments, ['Production', 'Sandbox']);
  assert.deepEqual(AP.config(Object.assign({}, BASE_ENV, { VVV_APPLE_ENVIRONMENTS: '' })).environments, ['Production'], 'Production only by default');
  /* Sandbox only needs no app Apple ID */
  const sb = AP.config(Object.assign({}, BASE_ENV, { VVV_APPLE_ENVIRONMENTS: 'Sandbox', VVV_APPLE_APP_APPLE_ID: '' }));
  assert.equal(sb.ok, true);
  assert.equal(AP.config(Object.assign({}, BASE_ENV, { VVV_APPLE_ENVIRONMENTS: 'Live' })).missing.indexOf('VVV_APPLE_ENVIRONMENTS') !== -1, true);
  /* base64 of the key is accepted; garbage is "not configured" */
  assert.equal(AP.config(Object.assign({}, BASE_ENV, { VVV_APPLE_IAP_PRIVATE_KEY: Buffer.from(IAP_PEM).toString('base64') })).ok, true);
  assert.equal(AP.config(Object.assign({}, BASE_ENV, { VVV_APPLE_IAP_PRIVATE_KEY: 'nope' })).ok, false);
  /* the same product for both offers is a misconfiguration */
  assert.equal(AP.config(Object.assign({}, BASE_ENV, { VVV_PRICE_APPLE_STANDARD_YEARLY: MONTHLY })).ok, false);
  /* two products, the catalogue's own names: no "no-trial" twins */
  assert.deepEqual(Object.keys(ACFG.offers).sort(), ['STANDARD_MONTHLY', 'STANDARD_YEARLY']);
  assert.equal(Prod.providerRefEnvName('apple', 'STANDARD_YEARLY'), 'VVV_PRICE_APPLE_STANDARD_YEARLY');
});

// ===========================================================================
// 3. APPLE'S STATUSES -> THE SIX WORDS
// ===========================================================================
test('every App Store status lands on the six-word vocabulary', () => {
  const f = (status, tx, rn, meta) => AP.subscriptionFacts(txPayload(tx), renewalPayload(rn), status, Object.assign({ env: BASE_ENV }, meta || {}));
  const paid = { offerType: undefined, offerDiscountType: undefined, price: 11990 };
  const cases = [
    ['active, free trial', f(1), 'trialing'],
    ['active, free trial, auto-renew off', f(1, {}, { autoRenewStatus: 0 }), 'trialing'],
    ['active, paid', f(1, paid), 'active'],
    ['active, paid, auto-renew off', f(1, paid, { autoRenewStatus: 0 }), 'cancelled'],
    ['expired', f(2, Object.assign({}, paid, { expiresDate: NOW - DAY })), 'expired'],
    ['billing retry', f(3, Object.assign({}, paid, { expiresDate: NOW - DAY }), { isInBillingRetryPeriod: true }), 'past_due'],
    ['billing grace period', f(4, Object.assign({}, paid, { expiresDate: NOW - DAY }), { gracePeriodExpiresDate: NOW + 3 * DAY }), 'past_due'],
    ['revoked', f(5, Object.assign({}, paid, { revocationDate: NOW - 1000, revocationReason: 0 })), 'revoked'],
    ['refunded while marked active', f(1, Object.assign({}, paid, { revocationDate: NOW - 1000 })), 'revoked']
  ];
  cases.forEach(([n, facts, want]) => {
    assert.ok(facts, n + ' was not classified');
    assert.equal(facts.condition, want, n);
    assert.ok(E.CONDITIONS.indexOf(facts.condition) !== -1);
    assert.equal(facts.provider, 'apple');
    assert.equal(facts.account_id, null, n + ': the adapter named an account');
    assert.equal(facts.subscription_ref, '2000000000000001', 'one subscription is one originalTransactionId');
  });
  const t = f(1);
  assert.equal(t.trial_end, iso(NOW + 6 * DAY));
  assert.equal(t.offer_code, 'STANDARD_MONTHLY');
  assert.equal(t.environment, 'sandbox');
  assert.equal(f(1, { productId: ANNUAL }).offer_code, 'STANDARD_YEARLY');
  const grace = f(4, Object.assign({}, paid, { expiresDate: NOW - DAY }), { gracePeriodExpiresDate: NOW + 3 * DAY });
  assert.equal(grace.grace_period_end, iso(NOW + 3 * DAY), 'Apple\'s grace, and only Apple\'s');
  assert.equal(grace.period_end, null);
  assert.equal(f(3, Object.assign({}, paid, { expiresDate: NOW - DAY })).grace_period_end, null, 'billing retry grants nothing');
  /* the resolver, unchanged, reads these as it reads every rail's rows */
  const row = x => ({ provider: 'apple', product_code: Prod.STANDARD, condition: x.condition, trial_end: x.trial_end,
                      current_period_end: x.period_end, grace_period_end: x.grace_period_end });
  assert.equal(E.isBlockingCommercial(row(t), new Date()), true);
  assert.equal(E.isBlockingCommercial(row(grace), new Date()), true);
  assert.equal(E.isBlockingCommercial(row(f(3, Object.assign({}, paid, { expiresDate: NOW - DAY }))), new Date()), false);
  /* a REFUND notice renames only what Apple's re-read shows has ended */
  assert.equal(f(2, Object.assign({}, paid, { expiresDate: NOW - DAY }), {}, { revoked: true }).condition, 'revoked');
  assert.equal(f(1, paid, {}, { revoked: true }).condition, 'active', 'a notification ended a live subscription');
  /* not ours, or not a status: refused, never guessed */
  assert.equal(f(1, { productId: 'com.example.other' }), null);
  assert.equal(f(9), null);
  assert.equal(f(1, { type: 'Non-Consumable' }), null);
  /* the trial is FREE_TRIAL, not any introductory offer */
  assert.equal(AP.inFreeTrial(txPayload({ offerDiscountType: 'PAY_AS_YOU_GO' })), false);
  assert.equal(AP.inFreeTrial(txPayload({ offerDiscountType: undefined })), true, 'older data: an intro period no longer than the trial');
  assert.equal(AP.inFreeTrial(txPayload({ offerDiscountType: undefined, expiresDate: NOW + 29 * DAY })), false);
});

// ===========================================================================
// 4. THE WORLD: a fake App Store Server API and a fake Supabase, through the
//    real router
// ===========================================================================
function fakeApple(){
  const state = { subs: {}, byTx: {}, requests: [] };
  async function fetchFn(url, init){
    const u = String(url);
    state.requests.push(u);
    const reply = (status, data) => ({ ok: status === 200, status, json: async () => data, text: async () => JSON.stringify(data) });
    const m = /^https:\/\/api\.storekit(-sandbox)?\.apple\.com\/inApps\/v1\/subscriptions\/(\d+)$/.exec(u);
    if (!m) return reply(404, {});
    const auth = String((init && init.headers && init.headers.Authorization) || '');
    const jwt = auth.replace(/^Bearer /, '');
    const d = jwt.split('.').length === 3 ? decode(jwt) : null;
    if (!d || !d.valid || d.claims.aud !== 'appstoreconnect-v1' || d.claims.bid !== 'com.velvetviking.valhalla') return reply(401, { errorCode: 4010000 });
    const orig = state.byTx[m[2]];
    const sub = orig && state.subs[orig];
    if (!sub || (sub.environment === 'Sandbox') !== !!m[1]) return reply(404, { errorCode: 4040010 });
    return reply(200, { environment: sub.environment, bundleId: 'com.velvetviking.valhalla', appAppleId: Number(APP_APPLE_ID),
      data: [{ subscriptionGroupIdentifier: '21000001', lastTransactions: [{ originalTransactionId: orig, status: sub.status,
        signedTransactionInfo: signApple(sub.tx), signedRenewalInfo: signApple(sub.renewal) }] }] });
  }
  return {
    state, fetchFn,
    put(status, tx, renewal){
      const t = txPayload(tx);
      const r = renewalPayload(Object.assign({ originalTransactionId: t.originalTransactionId, productId: t.productId }, renewal || {}));
      state.subs[t.originalTransactionId] = { status, tx: t, renewal: r, environment: t.environment };
      state.byTx[t.transactionId] = t.originalTransactionId;
      state.byTx[t.originalTransactionId] = t.originalTransactionId;
      return signApple(t);
    }
  };
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
  const apple = fakeApple();
  const saved = { sb: S.sb, config: S.config, verifyUser: S.verifyUser, uidFrom: S.userIdFromRequest, fetch: globalThis.fetch, env: {} };
  const env = Object.assign({}, BASE_ENV, { VVV_COMMERCE_ENABLED: '1', VVV_COMMERCIAL_REQUIRED: '1', VVV_ACCOUNT_REQUIRED: '1' }, o.env || {});
  Object.keys(env).forEach(k => { saved.env[k] = process.env[k]; if (env[k] === '') delete process.env[k]; else process.env[k] = env[k]; });
  let signedInAs = ATHLETE;
  S.sb = f.S.sb;
  S.config = () => f.cfg;
  S.verifyUser = async () => ({ uid: signedInAs, email: 'a@b.test' });
  S.userIdFromRequest = async () => signedInAs;
  globalThis.fetch = apple.fetchFn;
  /* THE TEST CA STANDS IN FOR APPLE'S ROOT for the length of this world only,
     beside the real one; removed again in finally. */
  AP.APPLE_ROOTS.push(CA.root);
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
    async notify(payload, x){
      const y = x || {};
      const res = fakeRes();
      const body = { signedPayload: y.signed || signApple(Object.assign({ notificationUUID: y.uuid || crypto.randomUUID(),
        signedDate: NOW - 1000, version: '2.0' }, payload), y.signOpts) };
      await webhook({ method: 'POST', url: y.url || '/api/billing-webhook?rail=apple', query: y.query || { rail: 'apple' },
                      headers: y.headers || {}, body: body }, res);
      return res.result();
    },
    signInAs(uid){ signedInAs = uid; }
  };
  try{ return await run({ f, apple, api }); }
  finally {
    AP.APPLE_ROOTS.splice(AP.APPLE_ROOTS.indexOf(CA.root), 1);
    S.sb = saved.sb; S.config = saved.config; S.verifyUser = saved.verifyUser; S.userIdFromRequest = saved.uidFrom;
    globalThis.fetch = saved.fetch;
    Object.keys(saved.env).forEach(k => { if (saved.env[k] === undefined) delete process.env[k]; else process.env[k] = saved.env[k]; });
  }
}
const appleRows = f => f.rows('subscriptions').filter(r => r.provider === 'apple');
const allows = jws => decode(jws).claims.allowIntroductoryOffer;
const PAID = { offerType: undefined, offerDiscountType: undefined, price: 11990 };

test('prepare: the athlete\'s own token, two products, SACORO\'s trial verdict signed for each, the web checkout\'s refusals', async () => {
  await withWorld({}, async ({ api }) => {
    const r = await api.sub({ action: 'apple_prepare', appTransactionId: '704289572311837185' });
    assert.equal(r.status, 200);
    assert.equal(r.json.purchase_allowed, true);
    assert.equal(r.json.app_account_token, AP.appAccountToken(ATHLETE, SECRET));
    assert.deepEqual(r.json.products, { monthly: MONTHLY, yearly: ANNUAL });
    assert.equal(r.json.trial_eligible, true);
    assert.deepEqual(Object.keys(r.json.intro_offer_signatures).sort(), [ANNUAL, MONTHLY].sort());
    const claims = decode(r.json.intro_offer_signatures[ANNUAL]).claims;
    assert.equal(claims.allowIntroductoryOffer, true);
    assert.equal(claims.productId, ANNUAL);
    assert.equal(claims.transactionId, '704289572311837185');
    assert.ok(r.json.agreements && r.json.agreements.terms);
    assert.equal((await api.sub({ action: 'apple_prepare', appTransactionId: '1' }, 'US')).json.reason, 'country_not_supported');
    /* without the customer's appTransactionID nothing can be signed, so nothing can be bought */
    assert.equal((await api.sub({ action: 'apple_prepare' })).json.intro_offer_signatures, null);
  });
  await withWorld({ env: { VVV_COMMERCE_ENABLED: '' } }, async ({ api }) => {
    const r = await api.sub({ action: 'apple_prepare', appTransactionId: '1' });
    assert.equal(r.json.reason, 'commerce_disabled');
    assert.equal(r.json.app_account_token, null);
    assert.equal(r.json.intro_offer_signatures, null);
  });
  await withWorld({ env: { VVV_APPLE_IAP_PRIVATE_KEY: '' } }, async ({ api }) => {
    const r = await api.sub({ action: 'apple_prepare', appTransactionId: '1' });
    assert.equal(r.json.reason, 'provider_not_configured');
    assert.deepEqual(r.json.products, {});
  });
  await withWorld({ agreements: false }, async ({ api }) => {
    assert.equal((await api.sub({ action: 'apple_prepare', appTransactionId: '1' })).json.reason, 'terms_not_accepted');
  });
});

test('ONE TRIAL ACROSS RAILS: an athlete who had a trial on the web or Play is signed "not eligible" on Apple', async () => {
  for (const provider of ['web', 'google']){
    await withWorld({ seed: { account_commercial: [{ account_id: ATHLETE, trial_consumed_at: iso(NOW - 90 * DAY), trial_consumed_provider: provider }] } },
      async ({ api }) => {
        const r = await api.sub({ action: 'apple_prepare', appTransactionId: '704289572311837185' });
        assert.equal(r.json.purchase_allowed, true);
        assert.equal(r.json.trial_eligible, false, 'a second trial was offered after one on ' + provider);
        assert.equal(allows(r.json.intro_offer_signatures[MONTHLY]), false);
        assert.equal(allows(r.json.intro_offer_signatures[ANNUAL]), false);
      });
  }
});

test('verify: Apple\'s record, tied to this athlete, written to the core, then (and only then) finish', async () => {
  await withWorld({}, async ({ f, apple, api }) => {
    const jws = apple.put(1);
    const r = await api.sub({ action: 'apple_verify', signedTransaction: jws });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.result, 'apple_verified');
    assert.equal(r.json.finish, true);
    assert.equal(r.json.transaction_id, '2000000000000001');
    const rows = appleRows(f);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].account_id, ATHLETE);
    assert.equal(rows[0].provider_subscription_id, '2000000000000001');
    assert.equal(rows[0].condition, 'trialing');
    assert.equal(rows[0].environment, 'sandbox');
    assert.equal(rows[0].agreed_price_minor, 1199);
    const acct = f.rows('account_commercial').filter(a => a.account_id === ATHLETE)[0];
    assert.ok(acct.trial_consumed_at, 'the one trial was not spent');
    assert.equal(acct.trial_consumed_provider, 'apple');
    assert.ok(f.rows('entitlements').filter(e => e.user_id === ATHLETE)[0], 'the gate\'s projection was not refreshed');
    /* the state came from the API (sandbox host), not the device */
    assert.ok(apple.state.requests.every(u => u.indexOf('https://api.storekit-sandbox.apple.com/inApps/v1/subscriptions/') === 0));
    /* again: idempotent */
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: jws })).status, 200);
    assert.equal(appleRows(f).length, 1);
    /* and afterwards the athlete is signed "not eligible" for any future trial */
    const p = await api.sub({ action: 'apple_prepare', appTransactionId: '1' });
    assert.equal(p.json.purchase_allowed, false, 'a live subscriber was offered a second purchase');
  });
});

test('verify: somebody else\'s purchase is refused and not finished; a recorded purchase never changes hands', async () => {
  await withWorld({}, async ({ f, apple, api }) => {
    const theirs = apple.put(1, { appAccountToken: AP.appAccountToken(OTHER, SECRET) });
    const r = await api.sub({ action: 'apple_verify', signedTransaction: theirs });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'not_your_purchase');
    assert.equal(r.json.finish, undefined, 'a refused transaction was marked for finishing');
    assert.equal(appleRows(f).length, 0);
    /* no token at all is nobody's */
    const none = apple.put(1, { transactionId: '2000000000000009', originalTransactionId: '2000000000000009', appAccountToken: undefined });
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: none })).json.error, 'not_your_purchase');
    /* the DEVICE's copy cannot vouch for itself: Apple's API copy decides */
    const lying = signApple(txPayload({ transactionId: '2000000000000001' }));
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: lying })).status, 403,
      'the device\'s appAccountToken was believed over Apple\'s record');
    /* once recorded for one athlete, another cannot claim it (restore on another account) */
    const mine = apple.put(1, { transactionId: '2000000000000002', originalTransactionId: '2000000000000002' });
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: mine })).status, 200);
    api.signInAs(OTHER);
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: mine })).status, 403);
    assert.equal(appleRows(f)[0].account_id, ATHLETE, 'a purchase changed hands');
  });
});

test('verify: a second live subscription is refused, whichever rail holds the first', async () => {
  const webSub = { id: 'w1', account_id: ATHLETE, provider: 'web', provider_subscription_id: 'sub_web1',
    product_code: Prod.STANDARD, condition: 'active', current_period_end: iso(NOW + 20 * DAY) };
  await withWorld({ seed: { subscriptions: [webSub] } }, async ({ f, apple, api }) => {
    const r = await api.sub({ action: 'apple_verify', signedTransaction: apple.put(1, PAID) });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'already_subscribed_elsewhere');
    assert.equal(r.json.provider, 'web');
    assert.equal(appleRows(f).length, 0);
    const p = await api.sub({ action: 'apple_prepare', appTransactionId: '1' });
    assert.equal(p.json.purchase_allowed, false);
    assert.equal(p.json.reason, 'already_subscribed_elsewhere');
    assert.equal(p.json.intro_offer_signatures, null, 'a signature for a purchase that may not be made');
  });
});

test('verify: the one trial is spent once; a second Apple trial is refused; a paid purchase afterwards is fine', async () => {
  await withWorld({}, async ({ f, apple, api }) => {
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: apple.put(1) })).status, 200);
    const first = f.rows('account_commercial').filter(a => a.account_id === ATHLETE)[0].trial_consumed_at;
    /* that trial lapses */
    apple.put(2, Object.assign({}, PAID, { expiresDate: NOW - 60000 }));
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: apple.put(2, Object.assign({}, PAID, { expiresDate: NOW - 60000 })) })).status, 200);
    /* prepare now signs "not eligible" for both products */
    const p = await api.sub({ action: 'apple_prepare', appTransactionId: '1' });
    assert.equal(p.json.trial_eligible, false);
    assert.equal(allows(p.json.intro_offer_signatures[MONTHLY]), false);
    /* a trial that slipped through anyway (another Apple Account) is refused, never finished */
    const second = apple.put(1, { transactionId: '2000000000000005', originalTransactionId: '2000000000000005' });
    const r = await api.sub({ action: 'apple_verify', signedTransaction: second });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'trial_already_used');
    assert.equal(r.json.finish, undefined);
    assert.equal(f.rows('account_commercial').filter(a => a.account_id === ATHLETE)[0].trial_consumed_at, first);
    /* a paid purchase (what Apple sells under the "not eligible" signature) is accepted */
    const paid = apple.put(1, Object.assign({}, PAID, { transactionId: '2000000000000006', originalTransactionId: '2000000000000006', productId: ANNUAL, expiresDate: NOW + 360 * DAY }));
    const ok = await api.sub({ action: 'apple_verify', signedTransaction: paid });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(appleRows(f).filter(x => x.provider_subscription_id === '2000000000000006')[0].offer_code, 'STANDARD_YEARLY');
  });
});

test('verify: a plan change keeps the one subscription (same originalTransactionId), and a forged or wrong-environment transaction is refused', async () => {
  await withWorld({}, async ({ f, apple, api }) => {
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: apple.put(1, PAID) })).status, 200);
    /* monthly -> annual within the group: a new transaction, the same original */
    const up = apple.put(1, Object.assign({}, PAID, { transactionId: '2000000000000077', productId: ANNUAL, expiresDate: NOW + 365 * DAY }));
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: up })).status, 200);
    assert.equal(appleRows(f).length, 1);
    assert.equal(appleRows(f)[0].offer_code, 'STANDARD_YEARLY');
    /* forged */
    const forged = signApple(txPayload(), { ca: ROGUE });
    const r = await api.sub({ action: 'apple_verify', signedTransaction: forged });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'bad_transaction');
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: 'nope' })).status, 400);
  });
  await withWorld({ env: { VVV_APPLE_ENVIRONMENTS: 'Production' } }, async ({ apple, api }) => {
    const r = await api.sub({ action: 'apple_verify', signedTransaction: apple.put(1) });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'wrong_environment', 'a sandbox purchase was accepted by a Production-only deployment');
    assert.equal(apple.state.requests.length, 0, 'Apple was asked about a transaction already refused');
  });
});

// ===========================================================================
// 5. THE WEBHOOK BRANCH
// ===========================================================================
test('the Apple branch is chosen by the request, never by the body', async () => {
  assert.equal(webhook.railOf({ query: { rail: 'apple' } }), 'apple');
  assert.equal(webhook.railOf({ url: '/api/billing-webhook?rail=apple' }), 'apple');
  await withWorld({}, async ({ api }) => {
    /* An Apple body without ?rail=apple is not Apple's: refused as before. */
    const r = await api.notify({ notificationType: 'TEST', data: { bundleId: 'com.velvetviking.valhalla', environment: 'Sandbox' } },
                               { url: '/api/billing-webhook', query: {} });
    assert.equal(r.status, 501);
    /* ?rail=apple with a Stripe header still goes to Apple's verifier */
    const s = await api.notify({}, { signed: 'a.b.c', headers: { 'stripe-signature': 't=1,v1=x' } });
    assert.equal(s.status, 401);
    assert.equal(s.json.code, 'BAD_SIGNED_PAYLOAD');
  });
  assert.match(read('api/billing-webhook.js'), /if \(railOf\(req\) === 'apple'\) return handleApple\(req, res, cfg\);/);
});

test('the Apple branch fails closed without configuration, naming the variables, never the values', async () => {
  await withWorld({ env: { VVV_APPLE_IAP_PRIVATE_KEY: '', VVV_APPLE_ACCOUNT_TOKEN_SECRET: '' } }, async ({ api }) => {
    const r = await api.notify({ notificationType: 'TEST', data: { bundleId: 'com.velvetviking.valhalla', environment: 'Sandbox' } });
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'APPLE_NOT_CONFIGURED');
    assert.deepEqual(r.json.missing, ['VVV_APPLE_IAP_PRIVATE_KEY', 'VVV_APPLE_ACCOUNT_TOKEN_SECRET']);
    assert.doesNotMatch(JSON.stringify(r.json), /PRIVATE KEY|test-apple-account-token-secret/);
  });
});

test('notifications: verified, re-read from Apple, claimed once; TEST applies nothing', async () => {
  await withWorld({}, async ({ f, apple, api }) => {
    const sandbox = d => Object.assign({ bundleId: 'com.velvetviking.valhalla', environment: 'Sandbox' }, d || {});
    /* forged: refused before anything is read */
    const bad = await api.notify({ notificationType: 'TEST', data: sandbox() }, { signOpts: { ca: ROGUE } });
    assert.equal(bad.status, 401);
    const t = await api.notify({ notificationType: 'TEST', data: sandbox() });
    assert.equal(t.status, 200);
    assert.equal(t.json.reason, 'test_notification');
    assert.equal(f.rows('billing_events').length, 0);
    assert.equal(apple.state.requests.length, 0);

    /* a purchase the app has not verified yet: nobody to attribute it to */
    const jws = apple.put(1);
    const early = await api.notify({ notificationType: 'SUBSCRIBED', subtype: 'INITIAL_BUY', data: sandbox({ signedTransactionInfo: jws }) }, { uuid: 'n1' });
    assert.equal(early.status, 200);
    assert.equal(early.json.reason, 'unattributable');
    assert.equal(appleRows(f).length, 0);

    /* the app verifies; the renewal then comes from Apple's record, whatever
       the notification itself carried */
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: jws })).status, 200);
    apple.put(1, Object.assign({}, PAID, { transactionId: '2000000000000011', expiresDate: NOW + 30 * DAY }));
    const renewed = await api.notify({ notificationType: 'DID_RENEW', data: sandbox({ signedTransactionInfo: jws }) }, { uuid: 'n2' });
    assert.equal(renewed.status, 200);
    assert.equal(renewed.json.applied, true);
    assert.equal(renewed.json.condition, 'active');
    assert.equal(appleRows(f)[0].condition, 'active');
    const dup = await api.notify({ notificationType: 'DID_RENEW', data: sandbox({ signedTransactionInfo: jws }) }, { uuid: 'n2' });
    assert.equal(dup.json.reason, 'already_applied');

    /* refunded: Apple's re-read shows it revoked */
    apple.put(5, Object.assign({}, PAID, { transactionId: '2000000000000011', expiresDate: NOW + 30 * DAY, revocationDate: NOW - 1000 }));
    const rf = await api.notify({ notificationType: 'REFUND', data: sandbox({ signedTransactionInfo: jws }) }, { uuid: 'n3' });
    assert.equal(rf.json.condition, 'revoked');
    assert.equal(appleRows(f)[0].condition, 'revoked');
    assert.deepEqual(f.rows('billing_events').map(e => e.provider + ':' + e.provider_event_id + ':' + e.result),
      ['apple:n1:unattributable', 'apple:n2:processed', 'apple:n3:processed']);
    assert.ok(f.rows('billing_events').every(e => e.environment === 'sandbox'));

    /* nothing to look at, or a transaction Apple does not know */
    assert.equal((await api.notify({ notificationType: 'EXTERNAL_PURCHASE_TOKEN', data: sandbox() })).json.reason, 'not_entitlement_relevant');
    const unknown = signApple(txPayload({ transactionId: '2999999999999999', originalTransactionId: '2999999999999999' }));
    assert.equal((await api.notify({ notificationType: 'DID_RENEW', data: sandbox({ signedTransactionInfo: unknown }) })).json.reason, 'purchase_not_found');
  });
});

// ===========================================================================
// 6. THE RUNTIME
// ===========================================================================
const PINNED = '2026-11-18T09:00:00Z';
const tick = () => new Promise(r => setImmediate(r));
async function settle(n){ for (let i = 0; i < (n || 12); i++) await tick(); }
function prepBody(over){
  return Object.assign({ commerce_enabled: true, provider_configured: true, purchase_allowed: true, reason: 'ok',
    app_account_token: '0b8e0e2a-5a0f-4c3e-9a6b-2f1d3c4b5a69', products: { monthly: MONTHLY, yearly: ANNUAL },
    trial_eligible: true, trial_days: 7, intro_offer_signatures: { [MONTHLY]: 'JWS_MONTHLY', [ANNUAL]: 'JWS_ANNUAL' },
    agreements: Agree.currentAgreements() }, over || {});
}
/* Apple's own prices, deliberately not the catalogue's. */
function storeProducts(){
  const intro = { paymentMode: 'freeTrial', freeTrial: true, period: { unit: 'week', value: 1 }, periodCount: 1, displayPrice: '€0.00' };
  return { products: [
    { id: ANNUAL, displayName: 'SACORO Standard', displayPrice: '€89.99', price: '89.99', currency: 'EUR', isAutoRenewable: true,
      period: { unit: 'year', value: 1 }, introductoryOffer: intro, isEligibleForIntroOffer: true },
    { id: MONTHLY, displayName: 'SACORO Standard', displayPrice: '€13.49', price: '13.49', currency: 'EUR', isAutoRenewable: true,
      period: { unit: 'month', value: 1 }, introductoryOffer: intro, isEligibleForIntroOffer: true }], invalidProductIds: [] };
}
function iosWorld(o){
  const x = o || {};
  const sent = [], purchases = [], finished = [];
  let listener = null;
  const a = loadApp({ pinnedDate: PINNED, fetch: async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    sent.push({ url: String(url), body: body, auth: init && init.headers && init.headers.Authorization });
    const reply = (status, data) => ({ status: status, ok: status === 200, json: async () => data });
    if (url === '/api/subscription' && body.action === 'apple_prepare') return reply(200, prepBody(x.prep));
    if (url === '/api/subscription' && body.action === 'apple_verify'){
      return x.verify ? reply(x.verify.status, x.verify.body) : reply(200, { result: 'apple_verified', finish: true, transaction_id: '2000000000000001' });
    }
    if (url === '/api/session') return reply(200, { signed_in: true, reason: x.sessionReason || 'subscription_trial' });
    return reply(404, {});
  } });
  a.showToast = m => { (a.toasts = a.toasts || []).push(m); };
  const tx = { jws: 'SIGNED.TX.JWS', transactionId: '2000000000000001', originalTransactionId: '2000000000000001',
               productId: ANNUAL, isAutoRenewable: true };
  const plugin = {
    getProducts: async () => storeProducts(),
    appTransactionId: async () => ({ appTransactionId: '704289572311837185' }),
    purchase: async (p) => { purchases.push(p); return x.outcome || { status: 'success', transaction: tx }; },
    finish: async (p) => { finished.push(p.transactionId); return { finished: true }; },
    unfinishedTransactions: async () => ({ transactions: x.unfinished || [] }),
    currentEntitlements: async () => ({ transactions: [] }),
    restorePurchases: async () => (x.restore || { status: 'synced', transactions: [tx] }),
    showManageSubscriptions: async () => { (a.managed = (a.managed || 0) + 1); return { shown: true }; },
    addListener: (name, cb) => { assert.equal(name, 'transactionUpdated'); listener = cb; return Promise.resolve({ remove(){} }); }
  };
  a.window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios',
                         Plugins: x.noPlugin ? {} : { SacoroAppStore: plugin } };
  a.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
  a.cloudSession = { access_token: 'tok-athlete', user_id: 'u1', expires_at: Date.now() + 3600e3 };
  return { a, sent, purchases, finished, plugin, emit: ev => listener && listener(ev) };
}
function atTrial(a, period){
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  a.journeyWrite({ v: 1, step: 'trial', built: true, drives: [], slide: 0, period: period || 'yearly' });
  a.renderApp = () => {};
  return a;
}
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('who uses StoreKit: only the iOS build with the plugin; Play, the website and the website APK unchanged', () => {
  const ios = iosWorld().a;
  assert.equal(ios.applePurchasesAvailable(), true);
  assert.equal(ios.playPurchasesAvailable(), false);
  assert.equal(ios.journeyPaymentProvider().id, 'store');
  assert.equal(ios.journeyPaymentProvider().showsPrices, true);
  /* an older iOS build, no plugin: nothing sold, as before */
  const old = iosWorld({ noPlugin: true }).a;
  assert.equal(old.applePurchasesAvailable(), false);
  assert.equal(old.journeyPaymentProvider().available, false);
  /* the website */
  const web = loadApp({ pinnedDate: PINNED });
  assert.equal(web.applePurchasesAvailable(), false);
  assert.equal(web.journeyPaymentProvider().id, 'web');
  /* Android: an Android shell carrying a StoreKit-named plugin is still not Apple */
  const android = loadApp({ pinnedDate: PINNED });
  android.window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { SacoroAppStore: iosWorld().plugin } };
  android.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14; wv)';
  assert.equal(android.applePurchasesAvailable(), false);
  assert.equal(android.journeyPaymentProvider().id, 'app', 'the website-distributed APK is still the web rail');
  android.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 14; wv) SACORO-Store-Build';
  assert.equal(android.applePurchasesAvailable(), false);
});

test('iOS without the plugin still answers store_unavailable and shows no price', async () => {
  const w = iosWorld({ noPlugin: true });
  const a = atTrial(w.a);
  assert.deepEqual(JSON.parse(JSON.stringify(await a.journeyPaymentProvider().start('yearly'))), { ok: false, code: 'store_unavailable' });
  const h = a.renderJourneyTrial();
  assert.match(h, /Subscriptions are not available in the app yet/);
  assert.doesNotMatch(h, /€|£|journey-agree|journey-trial-start|Restore Purchases/);
  assert.equal(w.sent.filter(s => /apple_/.test(JSON.stringify(s.body))).length, 0);
});

test('the iOS trial screen: Apple\'s prices, the 3.1.2 disclosures, the ticks, Restore Purchases', async () => {
  const { a } = iosWorld();
  atTrial(a);
  assert.match(a.renderJourneyTrial(), /One moment\./);
  await settle();
  const h = a.renderJourneyTrial();
  const t = text(h);
  assert.match(t, /Start Your 7-Day Free Trial/);
  assert.match(t, /Annual €89\.99 \/ year/);
  assert.match(t, /Monthly €13\.49 \/ month/);
  assert.doesNotMatch(h, /£79\.99|£11\.99/, 'a catalogue price was typed onto the App Store screen');
  assert.match(t, /Day 8: €89\.99 , then annually/);
  /* 3.1.2: title, length, price per period, auto-renewal, Terms and Privacy links */
  assert.match(t, /SACORO Standard, 1 year subscription at €89\.99 per year\. Free for the first 7 days, then it renews annually until you cancel\./);
  assert.match(t, /Payment is handled by the App Store\./);
  const defs = Agree.currentAgreements();
  assert.ok(h.indexOf('data-href="' + defs.terms.url + '">Terms of Service</a> and ') !== -1, 'no Terms link beside the purchase');
  assert.ok(h.indexOf('data-href="' + defs.privacy.url + '">Privacy Policy</a></p>') !== -1, 'no Privacy Policy link beside the purchase');
  assert.match(h, /data-action="journey-agree" data-kind="terms"/);
  assert.match(h, /data-action="journey-trial-start" disabled>Start My Free Trial</);
  assert.match(h, /data-action="journey-restore"[^>]*>Restore Purchases</);
  assert.doesNotMatch(h, /api\/checkout|Secure payment setup|Google Play/);
  /* monthly says monthly */
  a.journeyWrite({ v: 1, step: 'trial', built: true, drives: [], slide: 0, period: 'monthly' });
  assert.match(text(a.renderJourneyTrial()), /1 month subscription at €13\.49 per month\. Free for the first 7 days, then it renews monthly until you cancel\./);
});

test('an athlete who has had a trial sees Subscribe and no trial, and the purchase carries the server\'s signature', async () => {
  const w = iosWorld({ prep: { trial_eligible: false } });
  const a = atTrial(w.a);
  a.renderJourneyTrial();
  await settle();
  const t = text(a.renderJourneyTrial());
  assert.doesNotMatch(t, /Free Trial|Day 8|Free for the first/, 'a trial was promised to an athlete who has had one');
  assert.match(t, /It renews annually until you cancel\./);
  assert.match(a.renderJourneyTrial(), /data-action="journey-trial-start" disabled>Subscribe</);
  a.journeyAgreed.terms = true; a.journeyAgreed.immediate_start = true;
  await a.appleStart('monthly');
  assert.deepEqual(JSON.parse(JSON.stringify(w.purchases)), [{ productId: MONTHLY,
    appAccountToken: '0b8e0e2a-5a0f-4c3e-9a6b-2f1d3c4b5a69', introOfferEligibilityJWS: 'JWS_MONTHLY' }]);
  assert.equal(w.sent.filter(s => s.body.action === 'apple_prepare')[0].body.appTransactionId, '704289572311837185');
  /* the server says no: StoreKit is never opened */
  const n = iosWorld({ prep: { purchase_allowed: false, reason: 'terms_not_accepted', app_account_token: null, intro_offer_signatures: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(await n.a.appleStart('yearly'))), { ok: false, code: 'terms_not_accepted' });
  assert.equal(n.purchases.length, 0);
  /* no signature: nothing is bought on Apple's own trial rule */
  const s = iosWorld({ prep: { intro_offer_signatures: null } });
  assert.deepEqual(JSON.parse(JSON.stringify(await s.a.appleStart('yearly'))), { ok: false, code: 'store_unavailable' });
  assert.equal(s.purchases.length, 0);
});

test('after the purchase: the signed transaction to the server with the athlete\'s token, finish only after, then the gate, then the journey', async () => {
  const w = iosWorld();
  const a = atTrial(w.a);
  await settle();
  a.journeyAgreed.terms = true; a.journeyAgreed.immediate_start = true;
  a.handleJourneyTrialStart();
  await settle(30);
  const verify = w.sent.filter(s => s.body.action === 'apple_verify');
  assert.equal(verify.length, 1);
  assert.deepEqual(verify[0].body, { action: 'apple_verify', signedTransaction: 'SIGNED.TX.JWS' });
  assert.equal(verify[0].auth, 'Bearer tok-athlete');
  assert.deepEqual(w.finished, ['2000000000000001']);
  const order = w.sent.map(s => s.body.action || s.url);
  assert.ok(order.indexOf('/api/session') > order.indexOf('apple_verify'), 'the gate was not asked after the server verified');
  assert.equal(a.journeyStep(), 'arrive', 'the journey did not move on to Welcome to SACORO');
  assert.ok(a.toasts.indexOf('Your free trial has started') !== -1);
});

test('refused, cancelled, pending: plain messages, the athlete stays, and nothing is finished', async () => {
  for (const [o, says] of [[{ outcome: { status: 'userCancelled' } }, 'Purchase cancelled. Nothing has been charged.'],
                           [{ outcome: { status: 'pending' } }, 'Your purchase is waiting for approval. SACORO opens as soon as it is confirmed.'],
                           [{ verify: { status: 409, body: { error: 'trial_already_used' } } }, 'This account has already had its free trial, so this purchase was not added to SACORO. Use Manage Subscriptions to cancel it.'],
                           [{ verify: { status: 403, body: { error: 'not_your_purchase' } } }, 'That App Store subscription belongs to a different SACORO account.'],
                           [{ verify: { status: 503, body: { error: 'unavailable' } } }, 'Your purchase is being confirmed. SACORO finishes this the next time it opens.'],
                           [{ verify: { status: 400, body: { error: 'bad_transaction' } } }, 'SACORO could not confirm this purchase yet. It stays with your Apple Account, and SACORO tries again the next time it opens.']]){
    const w = iosWorld(o);
    const a = atTrial(w.a);
    await settle();
    a.handleJourneyTrialStart();
    await settle(30);
    assert.equal(a.journeyTrialNote, says);
    assert.equal(a.journeyStep(), 'trial');
    assert.deepEqual(w.finished, [], 'a transaction the server did not admit was finished');
    assert.doesNotMatch(says, /—/);
  }
  /* already subscribed on another rail: the athlete HAS access, so the journey
     goes on, and the toast says what to do about the App Store purchase */
  const w = iosWorld({ verify: { status: 409, body: { error: 'already_subscribed_elsewhere', provider: 'web' } } });
  const a = atTrial(w.a);
  await settle();
  a.handleJourneyTrialStart();
  await settle(30);
  assert.ok(a.toasts.indexOf('You already have a subscription on this account, so this purchase was not added to SACORO. Use Manage Subscriptions to cancel it.') !== -1);
  assert.equal(a.journeyStep(), 'arrive');
  assert.deepEqual(w.finished, []);
});

test('recovery, updates and Restore Purchases all go through the server, and finish only what it admits', async () => {
  const w = iosWorld({ unfinished: [{ jws: 'UNFINISHED', transactionId: '2000000000000031', isAutoRenewable: true }] });
  w.a.renderApp = () => {};
  w.a.cloudSignedIn = () => true;
  assert.equal(await w.a.appleRecoverPurchases(true), 1);
  assert.deepEqual(w.sent.filter(s => s.body.action === 'apple_verify').map(s => s.body.signedTransaction), ['UNFINISHED']);
  assert.deepEqual(w.finished, ['2000000000000001'], 'finish names the transaction the server admitted');
  assert.equal(await w.a.appleRecoverPurchases(false), 0, 'rate-limited on resume');
  /* a renewal from StoreKit's update stream */
  await w.emit({ jws: 'RENEWAL', transactionId: '2000000000000032', isAutoRenewable: true });
  assert.ok(w.sent.some(s => s.body.signedTransaction === 'RENEWAL'));
  /* restore */
  const r = iosWorld();
  r.a.renderApp = () => {};
  const res = await r.a.appleRestore();
  assert.equal(res.ok, true);
  const none = iosWorld({ restore: { status: 'synced', transactions: [] } });
  assert.equal((await none.a.appleRestore()).code, 'apple_restore_none');
  const src = read('protected/velvet-viking-valhalla.html');
  assert.match(src, /try\{ appleRecoverPurchases\(false\); \}catch\(e\)\{\}/, 'resume does not recover');
  assert.match(src, /try \{ appleRecoverPurchases\(true\); \} catch\(e\)\{\}/, 'start does not recover');
  const web = loadApp({ pinnedDate: PINNED });
  assert.equal(await web.appleRecoverPurchases(true), 0);
});

test('Settings in the iOS build: App Store prices to subscribe, Restore Purchases, Manage Subscriptions', async () => {
  const w = iosWorld();
  const a = w.a;
  a.renderApp = () => {};
  const needs = { signed_in: true, commercial_required: true, access: false, state: null, checkout_configured: false };
  a.renderAppleSubscriptionActions(needs);
  await settle();
  const h = a.renderSubscriptionActions(needs);
  assert.match(text(h), /Annual €89\.99 \/ year/);
  assert.match(h, /data-action="apple-start"/);
  assert.match(h, /data-action="apple-restore"[^>]*>Restore Purchases</);
  assert.match(text(h), /renews annually until you cancel/);
  assert.doesNotMatch(h, /subscription-resubscribe|subscription-manage|mailto:/, 'the web controls appeared in the iOS build');
  const managed = a.renderSubscriptionActions({ signed_in: true, commercial_required: true, access: true, state: 'trial',
                                                management_provider: 'apple', manageable_here: false });
  assert.match(managed, /data-action="apple-manage"[^>]*>[^]*Manage Subscriptions<\/button>/);
  a.handleAppleManage();
  await settle();
  assert.equal(a.managed, 1);
  /* bought on the web: told where, no Apple controls */
  assert.match(a.renderSubscriptionActions({ signed_in: true, commercial_required: true, access: true, state: 'active',
    management_provider: 'web', manageable_here: true }), /Manage or cancel your subscription where you bought it/);
  /* an iOS build without the plugin: exactly as before */
  assert.match(iosWorld({ noPlugin: true }).a.renderSubscriptionActions(needs), /Manage or cancel your subscription where you bought it/);
});

test('the App Store copy keeps the house rules', () => {
  const src = read('protected/velvet-viking-valhalla.html');
  const block = src.slice(src.indexOf('---------- APP STORE PURCHASES (the iOS build)'), src.indexOf('function journeyPaymentProvider('));
  assert.ok(block.length > 1000);
  assert.doesNotMatch(block, /—|\\u2014|&mdash;/);
  assert.doesNotMatch(block, /font-size:\s*(?:[0-9]|10)(?:\.\d+)?px/, 'text under 11px');
  assert.doesNotMatch(block, /style="[^"]*border[^"]*1px/, 'a plain 1px hairline');
  ['Restore Purchases', 'Manage Subscriptions', 'Start My Free Trial', 'Subscribe', 'Try Again'].forEach(l =>
    assert.ok(block.indexOf('>' + l + '<') !== -1 || block.indexOf(' ' + l + '<') !== -1 || block.indexOf("'" + l + "'") !== -1, l));
  assert.equal((src.match(/<style\b/g) || []).length, 1, 'a second style tag');
});

// ===========================================================================
// 7. THE NATIVE PROJECT
// ===========================================================================
test('the Xcode project compiles the plugin and the bridge controller into the App target', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  for (const f of ['SacoroAppStorePlugin.swift', 'SacoroBridgeViewController.swift']){
    const ref = new RegExp('([0-9A-F]{24}) /\\* ' + f.replace('.', '\\.') + ' \\*/ = \\{isa = PBXFileReference; lastKnownFileType = sourcecode\\.swift; path = ' + f.replace('.', '\\.') + '; sourceTree = "<group>"; \\};').exec(pbx);
    assert.ok(ref, f + ' has no file reference');
    const build = new RegExp('([0-9A-F]{24}) /\\* ' + f.replace('.', '\\.') + ' in Sources \\*/ = \\{isa = PBXBuildFile; fileRef = ' + ref[1]).exec(pbx);
    assert.ok(build, f + ' has no build file');
    const sources = pbx.slice(pbx.indexOf('/* Begin PBXSourcesBuildPhase section */'), pbx.indexOf('/* End PBXSourcesBuildPhase section */'));
    assert.ok(sources.indexOf(build[1] + ' /* ' + f + ' in Sources */') !== -1, f + ' is not in the Sources build phase');
    const group = pbx.slice(pbx.indexOf('504EC3061FED79650016851F /* App */ = {'), pbx.indexOf('path = App;'));
    assert.ok(group.indexOf(ref[1] + ' /* ' + f + ' */') !== -1, f + ' is not in the App group');
    assert.ok(fs.existsSync(path.join(ROOT, 'ios', 'App', 'App', f)), f + ' is missing on disk');
    /* every id unique */
    assert.equal(pbx.split(ref[1]).length - 1, 3);
  }
  /* iOS 16: AppTransaction.appTransactionID, which the signed trial eligibility needs */
  assert.equal((pbx.match(/IPHONEOS_DEPLOYMENT_TARGET = 16\.0;/g) || []).length, 4);
  assert.doesNotMatch(pbx, /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/);
  assert.match(read('ios/App/Podfile'), /platform :ios, '16\.0'/);
  assert.equal((pbx.match(/MARKETING_VERSION = 1\.1;/g) || []).length, 2);
  /* the build number is still CI's, per run */
  assert.match(read('.github/workflows/build-ios.yml'), /CURRENT_PROJECT_VERSION="\$BUILD_NUMBER" build/);
  assert.match(read('.github/workflows/build-ios.yml'), /xcodebuild -workspace ios\/App\/App\.xcworkspace -scheme App/);
});

test('the plugin is registered at launch, and finishes only on the web layer\'s word', () => {
  const vc = read('ios/App/App/SacoroBridgeViewController.swift');
  assert.match(vc, /class SacoroBridgeViewController: CAPBridgeViewController/);
  assert.match(vc, /override func capacitorDidLoad\(\) \{[^}]*bridge\?\.registerPluginInstance\(SacoroAppStorePlugin\(\)\)/);
  assert.match(read('ios/App/App/SceneDelegate.swift'), /window\?\.rootViewController = SacoroBridgeViewController\(\)/);
  assert.match(read('ios/App/App/Base.lproj/Main.storyboard'), /customClass="SacoroBridgeViewController" customModule="App" customModuleProvider="target"/);
  const sw = read('ios/App/App/SacoroAppStorePlugin.swift');
  const code = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(code, /public class SacoroAppStorePlugin: CAPPlugin, CAPBridgedPlugin/);
  assert.match(code, /public let jsName = "SacoroAppStore"/);
  ['getProducts', 'appTransactionId', 'purchase', 'finish', 'unfinishedTransactions', 'currentEntitlements', 'restorePurchases', 'showManageSubscriptions']
    .forEach(m => {
      assert.match(code, new RegExp('CAPPluginMethod\\(name: "' + m + '", returnType: CAPPluginReturnPromise\\)'), m + ' is not exported');
      assert.match(code, new RegExp('@objc func ' + m + '\\(_ call: CAPPluginCall\\)'), m + ' is not implemented');
    });
  assert.match(code, /override public func load\(\) \{[\s\S]*Transaction\.updates/, 'the update listener does not start at load');
  assert.match(code, /notifyListeners\(SacoroAppStorePlugin\.eventTransaction, data: data, retainUntilConsumed: true\)/);
  assert.match(code, /\.appAccountToken\(token\)/);
  assert.match(code, /\.introductoryOfferEligibility\(compactJWS: eligibilityJWS\)/);
  assert.match(code, /product\.purchase\(options: options\)/);
  assert.match(code, /AppStore\.sync\(\)/);
  assert.match(code, /AppStore\.showManageSubscriptions\(in: scene\)/);
  assert.match(code, /result\.jwsRepresentation/);
  assert.match(code, /AppTransaction\.shared/);
  /* .finish() appears once, inside finish(): never on purchase, update or restore */
  assert.equal((code.match(/\.finish\(\)/g) || []).length, 1);
  const finishFn = code.slice(code.indexOf('@objc func finish('), code.indexOf('private func collect('));
  assert.match(finishFn, /await transaction\.finish\(\)/);
  /* StoreKit 2 needs no entitlement file, and HealthKit is still nowhere */
  assert.equal(fs.existsSync(path.join(ROOT, 'ios', 'App', 'App', 'App.entitlements')), false);
  assert.doesNotMatch(sw, /HealthKit/);
});

test('the documents say what is now true', () => {
  const doc = read('APPLE-IN-APP-PURCHASE.md');
  ['sacoro.standard.monthly', 'sacoro.standard.annual', '£11.99', '£79.99', '7-day', 'VVV_APPLE_IAP_KEY_ID',
   'VVV_APPLE_IAP_ISSUER_ID', 'VVV_APPLE_IAP_PRIVATE_KEY', 'VVV_APPLE_ACCOUNT_TOKEN_SECRET', 'VVV_APPLE_APP_APPLE_ID',
   'VVV_APPLE_ENVIRONMENTS', 'VVV_PRICE_APPLE_STANDARD_MONTHLY', 'VVV_PRICE_APPLE_STANDARD_YEARLY',
   'https://app.velvetviking.co.uk/api/billing-webhook?rail=apple', 'introductoryOfferEligibility', 'Paid Apps Agreement',
   'Restore Purchases', '3.1.2', 'TestFlight', 'https://developer.apple.com/documentation/storekit/generating-jws-to-sign-app-store-requests']
    .forEach(s => assert.ok(doc.indexOf(s) !== -1, 'APPLE-IN-APP-PURCHASE.md does not mention ' + s));
  const boundary = read('STORE-COMMERCIAL-BOUNDARY.md');
  assert.match(boundary, /_apple\.js/);
  assert.doesNotMatch(boundary, /There is still no Apple purchase code in the repository/);
  const ios = read('IOS-READINESS.md');
  assert.match(ios, /option B/i);
  assert.match(ios, /APPLE-IN-APP-PURCHASE\.md/);
});

test('a refusal BEFORE the App Store sheet says nothing was charged; one AFTER says where to cancel', async () => {
  const before = iosWorld({ prep: { purchase_allowed: false, reason: 'already_subscribed_elsewhere', app_account_token: null, intro_offer_signatures: null } });
  const a = atTrial(before.a);
  const res = await a.appleStart('yearly');
  assert.equal(res.afterPurchase, undefined);
  assert.equal(a.appleCopy(res.code, !!res.afterPurchase), 'You already have a subscription on this account.');
  assert.equal(before.purchases.length, 0);
  const after = iosWorld({ verify: { status: 409, body: { error: 'already_subscribed_elsewhere' } } });
  const r2 = await after.a.appleStart('yearly');
  assert.equal(r2.afterPurchase, true);
  assert.match(after.a.appleCopy(r2.code, true), /Use Manage Subscriptions to cancel it\./);
  /* and nothing said after a purchase claims nothing was charged */
  ['apple_verify_later', 'apple_verify_failed', 'trial_already_used', 'not_your_purchase'].forEach(c =>
    assert.doesNotMatch(after.a.appleCopy(c, true), /Nothing has been charged/));
});

test('a resubscribe outside the app cannot become a second trial: Apple\'s free week grants nothing, the paid renewal does', async () => {
  /* the athlete had the trial on the web, then paid on Apple (trial signed away) */
  await withWorld({ seed: { account_commercial: [{ account_id: ATHLETE, trial_consumed_at: iso(NOW - 120 * DAY), trial_consumed_provider: 'web' }] } },
    async ({ f, apple, api }) => {
      const paid = apple.put(1, PAID);
      assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: paid })).status, 200);
      /* it lapses */
      apple.put(2, Object.assign({}, PAID, { expiresDate: NOW - 10 * DAY }));
      const sandbox = d => Object.assign({ bundleId: 'com.velvetviking.valhalla', environment: 'Sandbox' }, d || {});
      assert.equal((await api.notify({ notificationType: 'EXPIRED', data: sandbox({ signedTransactionInfo: paid }) }, { uuid: 'e1' })).json.condition, 'expired');
      /* resubscribed in Settings: Apple applies its own intro offer */
      apple.put(1, { transactionId: '2000000000000041', purchaseDate: NOW - 1000, expiresDate: NOW + 7 * DAY });
      const again = await api.notify({ notificationType: 'SUBSCRIBED', subtype: 'RESUBSCRIBE', data: sandbox({ signedTransactionInfo: paid }) }, { uuid: 'e2' });
      assert.equal(again.status, 200);
      assert.equal(again.json.reason, 'trial_already_used');
      assert.equal(appleRows(f)[0].condition, 'expired', 'Apple\'s free week was granted as a second SACORO trial');
      /* day 8, the first paid period: admitted */
      apple.put(1, Object.assign({}, PAID, { transactionId: '2000000000000042', expiresDate: NOW + 30 * DAY }));
      const renewed = await api.notify({ notificationType: 'DID_RENEW', data: sandbox({ signedTransactionInfo: paid }) }, { uuid: 'e3' });
      assert.equal(renewed.json.condition, 'active');
    });
  /* the athlete's OWN first trial on Apple is still recorded on every later telling */
  await withWorld({}, async ({ f, apple, api }) => {
    const jws = apple.put(1);
    assert.equal((await api.sub({ action: 'apple_verify', signedTransaction: jws })).status, 200);
    apple.put(1, {}, { autoRenewStatus: 0 });
    const sandbox = { bundleId: 'com.velvetviking.valhalla', environment: 'Sandbox', signedTransactionInfo: jws };
    const r = await api.notify({ notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: 'AUTO_RENEW_DISABLED', data: sandbox }, { uuid: 'c1' });
    assert.equal(r.json.applied, true);
    assert.equal(appleRows(f)[0].cancel_at_period_end, true);
  });
});
