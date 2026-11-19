// Velvet Viking -- the Apple adapter. The ONLY file that knows the App Store
// exists.
//
// It is to the Apple rail exactly what _stripe.js is to the web rail and
// _google.js to the Play rail: everything Apple-shaped stops here -- the
// signed-data (JWS) verification and Apple's certificate chain, the App Store
// Server API and its ES256 token, the status and offer enums, the App Store
// Server Notifications V2 payload, the signed introductory-offer eligibility
// -- and what leaves is the provider-neutral FACTS shape the other two
// adapters already produce. Nothing downstream learns a purchase came from
// Apple.
//
// NO SDK. Verifying an ES256 JWS against an X.509 chain, and signing the two
// ES256 tokens this rail needs, is node's own crypto; the App Store Server
// API call is one fetch. The checks below follow Apple's own App Store Server
// Library (app-store-server-library-node, jws_verification.js) step for step,
// minus the optional OCSP revocation check (see APPLE-IN-APP-PURCHASE.md).
//
// WHAT THIS FILE WILL NOT DO
//   - decide whether anybody may use SACORO. It maps Apple's words onto ours
//     and stops; _entitlement.js decides, from the rows, as for every rail.
//   - attach a purchase to an account. Apple never tells us who an athlete is:
//     it echoes back an appAccountToken WE derived, and the caller compares it
//     with the authenticated athlete.
//   - trust a device or a notification for STATE. Both are prompts to look;
//     the state is always re-read from the App Store Server API.
//   - log a private key, a token, a signed payload or a full transaction id.

'use strict';

const crypto = require('crypto');
const Prod = require('./_products.js');

const PROVIDER = 'apple';

/* The App Store app this server sells for: the bundle id in the Xcode project
   and capacitor.config.json. Not configuration -- a different bundle is a
   different app, and signed data naming one is not ours to apply. */
const BUNDLE_ID = 'com.velvetviking.valhalla';

/* App Store Server API hosts, as Apple's current documentation and its App
   Store Server Library (3.1.0: PRODUCTION_URL / SANDBOX_URL) name them.
   Which one is asked is decided by the ENVIRONMENT field of Apple-signed
   data, never by a request. */
const API_HOSTS = {
  Production: 'https://api.storekit.apple.com',
  Sandbox: 'https://api.storekit-sandbox.apple.com'
};
const ENVIRONMENTS = ['Production', 'Sandbox'];

/* Apple's own skew allowance (MAX_SKEW in the App Store Server Library). */
const MAX_SKEW_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/* THE ONE TRUST ANCHOR: Apple Root CA - G3.
 *
 * Source: https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
 * (Apple PKI, https://www.apple.com/certificateauthority/). This copy was
 * taken from Apple's own App Store Server Library test resources
 * (@apple/app-store-server-library 3.1.0, REAL_APPLE_ROOT_BASE64_ENCODED,
 * MIT licence) because apple.com was not reachable from the build
 * environment, and it is pinned below by its published SHA-256 fingerprint,
 * which a second, independent package (app-store-server-api 1.0.0,
 * APPLE_ROOT_CA_G3_FINGERPRINT) states identically. It is a PUBLIC
 * certificate; nothing here is secret. Valid 30 Apr 2014 to 30 Apr 2039. */
const APPLE_ROOT_CA_G3_BASE64 =
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9v' +
  'dCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UE' +
  'CgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2' +
  'WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmlj' +
  'YXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqG' +
  'SM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxE' +
  'tX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNC' +
  'MEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0P' +
  'AQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3m' +
  'eoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkL' +
  'F1vLUagM6BgD56KyKA==';
const APPLE_ROOT_CA_G3_SHA256 =
  '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79';

/* The certificate extensions Apple's library requires (and so do we): the
   leaf is an App Store receipt-signing certificate, the intermediate is
   Apple's Worldwide Developer Relations CA. */
const OID_LEAF = '1.2.840.113635.100.6.11.1';
const OID_INTERMEDIATE = '1.2.840.113635.100.6.2.1';

/* Loaded once and checked against its fingerprint. If the constant above were
   ever edited by mistake, NOTHING verifies (an empty trust list), rather than
   a different certificate being trusted. */
const APPLE_ROOTS = (function(){
  try{
    const c = new crypto.X509Certificate(Buffer.from(APPLE_ROOT_CA_G3_BASE64, 'base64'));
    return c.fingerprint256 === APPLE_ROOT_CA_G3_SHA256 ? [c] : [];
  }catch(e){ return []; }
})();

/* The environment names, listed once so fail-closed messages and the
   documentation name the same variables. VALUES ARE NEVER LOGGED. */
const ENV = {
  keyId: 'VVV_APPLE_IAP_KEY_ID',
  issuerId: 'VVV_APPLE_IAP_ISSUER_ID',
  privateKey: 'VVV_APPLE_IAP_PRIVATE_KEY',
  accountTokenSecret: 'VVV_APPLE_ACCOUNT_TOKEN_SECRET',
  appAppleId: 'VVV_APPLE_APP_APPLE_ID',
  environments: 'VVV_APPLE_ENVIRONMENTS'
};

function ref(v){ return v ? String(v).slice(0, 6) + '…' : '-'; }
function log(what){ try{ console.log('apple: ' + what); }catch(e){} }

// ===========================================================================
// CONFIGURATION
// ===========================================================================

/* The In-App Purchase key (.p8), pasted whole or base64-encoded. Returns a
   KeyObject or null; an unreadable key is "not configured". */
function parsePrivateKey(raw){
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let pem = s;
  if (s.indexOf('-----BEGIN') === -1){
    try{ pem = Buffer.from(s, 'base64').toString('utf8').trim(); }catch(e){ return null; }
  }
  pem = pem.replace(/\\n/g, '\n');
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) return null;
  try{
    const k = crypto.createPrivateKey(pem);
    if (k.asymmetricKeyType !== 'ec') return null;
    return k;
  }catch(e){ return null; }
}

/* Which Apple environments this deployment accepts. Production only unless
   told otherwise: TestFlight and sandbox testers buy in Sandbox, so a
   deployment used for testing sets "Production,Sandbox". */
function allowedEnvironments(raw){
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return ['Production'];
  const out = s.split(',').map(function(x){ return x.trim().toLowerCase(); }).filter(Boolean)
    .map(function(x){ return x === 'production' ? 'Production' : x === 'sandbox' ? 'Sandbox' : null; });
  if (out.indexOf(null) !== -1) return [];
  return out.filter(function(v, i, a){ return a.indexOf(v) === i; });
}

/* THE APP STORE PRODUCT IDS, under the catalogue's own convention.
 *
 *   VVV_PRICE_APPLE_STANDARD_MONTHLY = sacoro.standard.monthly
 *   VVV_PRICE_APPLE_STANDARD_YEARLY  = sacoro.standard.annual
 *
 * TWO products, one subscription group, each with the seven-day free-trial
 * introductory offer. Whether a given purchase gets that offer is decided by
 * SACORO and signed by this server (introductoryOfferSignature below), so no
 * "no-trial" twin products are needed. */
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._]{0,99}$/;
function appleOfferRefs(env){
  const out = {};
  Object.keys(Prod.OFFERS).forEach(function(code){
    const v = Prod.providerRef(PROVIDER, code, env);
    if (!v || !PRODUCT_ID.test(v)) return;
    out[code] = { offerCode: code, productId: v, billingPeriod: Prod.OFFERS[code].billingPeriod };
  });
  return out;
}
function offerForProduct(productId, env){
  const refs = appleOfferRefs(env);
  const hit = Object.keys(refs).filter(function(k){ return refs[k].productId === productId; })[0];
  return hit ? refs[hit] : null;
}

/* Read through a function, never captured at module scope (a captured secret
   outlives its rotation). */
function config(env){
  const e = env || process.env;
  const keyId = String(e[ENV.keyId] || '').trim();
  const issuerId = String(e[ENV.issuerId] || '').trim();
  const key = parsePrivateKey(e[ENV.privateKey]);
  const secret = String(e[ENV.accountTokenSecret] || '').trim();
  const appAppleId = String(e[ENV.appAppleId] || '').trim();
  const environments = allowedEnvironments(e[ENV.environments]);
  const offers = appleOfferRefs(e);
  const productIds = Object.keys(offers).map(function(k){ return offers[k].productId; });

  /* NAMES of what is missing, never values. */
  const missing = [];
  if (!keyId) missing.push(ENV.keyId);
  if (!issuerId) missing.push(ENV.issuerId);
  if (!key) missing.push(ENV.privateKey);
  if (!secret) missing.push(ENV.accountTokenSecret);
  if (!environments.length) missing.push(ENV.environments);
  /* Apple's own verifier refuses Production data without the app's Apple ID
     to compare notifications against; so does this one. */
  if (environments.indexOf('Production') !== -1 && !/^\d{1,20}$/.test(appAppleId)) missing.push(ENV.appAppleId);
  if (Object.keys(offers).length !== Object.keys(Prod.OFFERS).length){
    missing.push(Prod.providerRefEnvName(PROVIDER, 'STANDARD_MONTHLY') + ' / ' +
                 Prod.providerRefEnvName(PROVIDER, 'STANDARD_YEARLY'));
  }
  const distinct = productIds.filter(function(v, i, a){ return a.indexOf(v) === i; }).length === productIds.length;

  return {
    bundleId: BUNDLE_ID,
    keyId: keyId,
    issuerId: issuerId,
    privateKey: function(){ return key; },
    hasAccountTokenSecret: !!secret,
    accountTokenSecret: function(){ return secret; },
    appAppleId: appAppleId,
    environments: environments,
    offers: offers,
    ok: missing.length === 0 && distinct,
    missing: missing,
    env: e
  };
}

// ===========================================================================
// WHO AN ATHLETE IS, TO APPLE
// ===========================================================================

/* THE appAccountToken.
 *
 * StoreKit lets an app attach a UUID to a purchase
 * (Product.PurchaseOption.appAccountToken) and Apple returns it in every
 * signed transaction for that purchase. It is derived here, never on the
 * phone: the first 16 bytes of HMAC-SHA256(secret, "sacoro-apple-account:" +
 * account id), shaped as an RFC 4122 version-4 UUID. Keyed, so nobody who
 * knows an athlete's account id can compute it; one-way, so it never reveals
 * the account id. Lower case, as Apple returns it. */
function appAccountToken(accountId, secret){
  if (!accountId || !secret) return null;
  const b = crypto.createHmac('sha256', String(secret))
    .update('sacoro-apple-account:' + String(accountId)).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
function sameToken(a, b){
  if (!a || !b) return false;
  const x = Buffer.from(String(a).toLowerCase(), 'utf8');
  const y = Buffer.from(String(b).toLowerCase(), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ===========================================================================
// THE CERTIFICATE EXTENSIONS (a minimal DER walk)
// ===========================================================================

/* Node's X509Certificate does not expose arbitrary extensions, and Apple's
   check is "does the certificate carry extension X". This walks exactly as
   far as needed: Certificate -> tbsCertificate -> [3] extensions -> each
   Extension's OID. Anything malformed throws, and the caller treats a throw
   as "not Apple's". */
function tlv(buf, off){
  if (off + 2 > buf.length) throw new Error('der');
  const tag = buf[off];
  let len = buf[off + 1];
  let hdr = 2;
  if (len & 0x80){
    const n = len & 0x7f;
    if (n < 1 || n > 4 || off + 2 + n > buf.length) throw new Error('der');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[off + 2 + i];
    hdr = 2 + n;
  }
  const start = off + hdr;
  const end = start + len;
  if (end > buf.length) throw new Error('der');
  return { tag: tag, start: start, end: end };
}
function kids(buf, node){
  const out = [];
  let o = node.start;
  while (o < node.end){ const c = tlv(buf, o); out.push(c); o = c.end; }
  return out;
}
function oidText(bytes){
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let v = 0;
  for (let i = 1; i < bytes.length; i++){
    v = v * 128 + (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)){ parts.push(v); v = 0; }
  }
  return parts.join('.');
}
function extensionOids(der){
  const cert = tlv(der, 0);
  const tbs = kids(der, cert)[0];
  const ext = kids(der, tbs).filter(function(k){ return k.tag === 0xa3; })[0];
  if (!ext) return [];
  const seq = kids(der, ext)[0];
  return kids(der, seq).map(function(e){
    const id = kids(der, e)[0];
    return id && id.tag === 0x06 ? oidText(der.subarray(id.start, id.end)) : null;
  }).filter(Boolean);
}

// ===========================================================================
// APPLE-SIGNED DATA (JWS)
// ===========================================================================

function b64urlJson(part){
  try{ return JSON.parse(Buffer.from(String(part), 'base64url').toString('utf8')); }
  catch(e){ return null; }
}
function within(cert, atMs){
  const from = Date.parse(cert.validFrom), to = Date.parse(cert.validTo);
  return isFinite(from) && isFinite(to) && from <= atMs + MAX_SKEW_MS && to >= atMs - MAX_SKEW_MS;
}

/* VERIFY ONE APPLE-SIGNED PAYLOAD: a signed transaction, signed renewal info
 * or a notification's signedPayload. Accepted only when all of these hold, and
 * the first that fails is the reason:
 *
 *   three parts, header alg ES256, x5c of exactly three certificates
 *   the intermediate (x5c[1]) is signed by a TRUSTED root (Apple Root CA - G3;
 *     the root in x5c[2] is never trusted for being there) and names it as
 *     issuer; the leaf (x5c[0]) is signed by the intermediate and names it;
 *     the intermediate is a CA
 *   the leaf carries 1.2.840.113635.100.6.11.1 and the intermediate
 *     1.2.840.113635.100.6.2.1
 *   signedDate is not in the future, and all three certificates were valid at
 *     signedDate (Apple's library does the same with online checks off, so a
 *     transaction signed before a certificate rotation still verifies)
 *   the ES256 signature verifies with the leaf's P-256 key
 *
 * `opts.roots` exists for tests (a locally generated CA); production code
 * never passes it. */
function verifySignedData(jws, opts){
  const o = opts || {};
  const roots = o.roots || APPLE_ROOTS;
  const nowMs = o.now != null ? new Date(o.now).getTime() : Date.now();
  const parts = String(jws || '').split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return { ok: false, reason: 'malformed' };
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (!header || !payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' };
  if (header.alg !== 'ES256') return { ok: false, reason: 'bad_algorithm' };
  if (!Array.isArray(header.x5c) || header.x5c.length !== 3) return { ok: false, reason: 'invalid_chain_length' };

  let leaf, inter;
  try{
    leaf = new crypto.X509Certificate(Buffer.from(String(header.x5c[0]), 'base64'));
    inter = new crypto.X509Certificate(Buffer.from(String(header.x5c[1]), 'base64'));
  }catch(e){ return { ok: false, reason: 'invalid_certificate' }; }

  let root = null;
  for (let i = 0; i < roots.length; i++){
    try{
      if (inter.issuer === roots[i].subject && inter.verify(roots[i].publicKey)){ root = roots[i]; break; }
    }catch(e){ /* not this root */ }
  }
  if (!root) return { ok: false, reason: 'untrusted_chain' };
  let chained = false;
  try{ chained = leaf.issuer === inter.subject && leaf.verify(inter.publicKey) && inter.ca === true; }
  catch(e){ chained = false; }
  if (!chained) return { ok: false, reason: 'untrusted_chain' };
  try{
    if (extensionOids(leaf.raw).indexOf(OID_LEAF) === -1) return { ok: false, reason: 'leaf_oid_missing' };
    if (extensionOids(inter.raw).indexOf(OID_INTERMEDIATE) === -1) return { ok: false, reason: 'intermediate_oid_missing' };
  }catch(e){ return { ok: false, reason: 'invalid_certificate' }; }

  const signedMs = payload.signedDate != null ? Number(payload.signedDate) : nowMs;
  if (!isFinite(signedMs)) return { ok: false, reason: 'malformed' };
  if (signedMs > nowMs + MAX_SKEW_MS) return { ok: false, reason: 'signed_in_future' };
  if (!within(leaf, signedMs) || !within(inter, signedMs) || !within(root, signedMs)){
    return { ok: false, reason: 'certificate_expired' };
  }

  let valid = false;
  try{
    const key = leaf.publicKey;
    valid = key.asymmetricKeyType === 'ec' &&
      crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]),
                    { key: key, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
  }catch(e){ valid = false; }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  return { ok: true, reason: 'verified', header: header, payload: payload };
}

function environmentAllowed(acfg, environment){
  return ENVIRONMENTS.indexOf(environment) !== -1 && acfg.environments.indexOf(environment) !== -1;
}

/* A signed transaction (from the device, the API or a notification). */
function verifyTransaction(jws, acfg, opts){
  const v = verifySignedData(jws, opts);
  if (!v.ok) return v;
  const t = v.payload;
  if (t.bundleId !== BUNDLE_ID) return { ok: false, reason: 'wrong_bundle' };
  if (!environmentAllowed(acfg, t.environment)) return { ok: false, reason: 'wrong_environment' };
  return { ok: true, reason: 'verified', transaction: t };
}
/* Signed renewal info: no bundle id in it (Apple's library checks the
   environment only); it is only ever read beside a transaction we verified. */
function verifyRenewalInfo(jws, acfg, opts){
  const v = verifySignedData(jws, opts);
  if (!v.ok) return v;
  if (!environmentAllowed(acfg, v.payload.environment)) return { ok: false, reason: 'wrong_environment' };
  return { ok: true, reason: 'verified', renewal: v.payload };
}
/* An App Store Server Notification V2 signedPayload. */
function verifyNotification(signedPayload, acfg, opts){
  const v = verifySignedData(signedPayload, opts);
  if (!v.ok) return v;
  const n = v.payload;
  const d = n.data || n.summary || {};
  if (d.bundleId !== BUNDLE_ID) return { ok: false, reason: 'wrong_bundle' };
  if (!environmentAllowed(acfg, d.environment)) return { ok: false, reason: 'wrong_environment' };
  if (d.environment === 'Production' && String(d.appAppleId) !== String(acfg.appAppleId)){
    return { ok: false, reason: 'wrong_app' };
  }
  return { ok: true, reason: 'verified', notification: n };
}

// ===========================================================================
// TOKENS THIS SERVER SIGNS WITH THE IN-APP PURCHASE KEY (ES256)
// ===========================================================================

function b64url(x){ return Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url'); }
function signEs256(acfg, claims){
  const header = { alg: 'ES256', kid: acfg.keyId, typ: 'JWT' };
  const unsigned = b64url(header) + '.' + b64url(claims);
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: acfg.privateKey(), dsaEncoding: 'ieee-p1363' });
  return unsigned + '.' + sig.toString('base64url');
}

/* The App Store Server API bearer token: iss, iat, exp, aud
   appstoreconnect-v1, bid. Five minutes, as Apple's own library signs it
   (Apple allows at most an hour); one is minted per call. */
function apiToken(acfg, nowSec){
  const iat = nowSec != null ? nowSec : Math.floor(Date.now() / 1000);
  return signEs256(acfg, { iss: acfg.issuerId, iat: iat, exp: iat + 5 * 60,
                           aud: 'appstoreconnect-v1', bid: BUNDLE_ID });
}

/* THE SIGNED INTRODUCTORY-OFFER ELIGIBILITY.
 *
 * StoreKit's Product.PurchaseOption.introductoryOfferEligibility(compactJWS:)
 * carries this into the purchase, and the App Store applies or removes the
 * product's introductory offer accordingly ("Generating JWS to sign App Store
 * requests", Apple). The claims, exactly as Apple documents them and as its
 * own IntroductoryOfferEligibilitySignatureCreator sends them:
 *
 *   header  alg ES256, kid = In-App Purchase key id, typ JWT
 *   payload iss (issuer id), iat, aud "introductory-offer-eligibility",
 *           bid, nonce (a fresh UUID), productId, allowIntroductoryOffer,
 *           transactionId (the customer's appTransactionID)
 *
 * NO exp: Apple says an exp claim makes the request fail, and expires it from
 * iat itself. allowIntroductoryOffer is SACORO's one-trial-per-athlete verdict
 * and nothing else. */
const APP_TRANSACTION_ID = /^[A-Za-z0-9._-]{1,64}$/;
function introductoryOfferSignature(acfg, o){
  const x = o || {};
  if (!PRODUCT_ID.test(String(x.productId || ''))) return null;
  if (!APP_TRANSACTION_ID.test(String(x.transactionId || ''))) return null;
  return signEs256(acfg, {
    iss: acfg.issuerId,
    iat: x.nowSec != null ? x.nowSec : Math.floor(Date.now() / 1000),
    aud: 'introductory-offer-eligibility',
    bid: BUNDLE_ID,
    nonce: x.nonce || crypto.randomUUID(),
    productId: String(x.productId),
    allowIntroductoryOffer: x.allow === true,
    transactionId: String(x.transactionId)
  });
}

// ===========================================================================
// THE TRUE STATE: App Store Server API, Get All Subscription Statuses
// ===========================================================================

const TRANSACTION_ID = /^\d{1,20}$/;
function transactionIdLooksValid(t){ return TRANSACTION_ID.test(String(t == null ? '' : t)); }

async function fetchStatuses(acfg, transactionId, environment, opts){
  if (!transactionIdLooksValid(transactionId)) return { ok: false, code: 'transaction_id_malformed' };
  const host = API_HOSTS[environment];
  if (!host || !environmentAllowed(acfg, environment)) return { ok: false, code: 'wrong_environment' };
  let token;
  try{ token = apiToken(acfg, opts && opts.nowSec); }
  catch(e){ log('IAP_KEY_UNUSABLE'); return { ok: false, code: 'apple_key_unusable' }; }
  const fetchFn = (opts && opts.fetch) || globalThis.fetch;
  let r;
  try{
    r = await fetchFn(host + '/inApps/v1/subscriptions/' + encodeURIComponent(String(transactionId)), {
      method: 'GET', headers: { 'Authorization': 'Bearer ' + token }
    });
  }catch(e){ return { ok: false, code: 'apple_unreachable', transient: true }; }
  const j = await r.json().catch(function(){ return null; });
  if (!r.ok){
    /* The status only; Apple's error body names nothing secret, but the
       transaction id stays out of the logs. */
    log('API_REFUSED status=' + r.status);
    return { ok: false, status: r.status,
             code: r.status === 404 ? 'purchase_not_found' : r.status === 401 ? 'apple_auth_refused' : 'apple_http_' + r.status,
             transient: r.status >= 500 || r.status === 429 };
  }
  return { ok: true, statuses: j || {} };
}

/* The last transaction and renewal info Apple holds for ONE subscription
   (originalTransactionId), both re-verified: the API response itself is not
   signed, only these two fields are. */
function ourLastTransaction(statuses, originalTransactionId, acfg, opts){
  const groups = (statuses && Array.isArray(statuses.data)) ? statuses.data : [];
  for (let g = 0; g < groups.length; g++){
    const list = Array.isArray(groups[g] && groups[g].lastTransactions) ? groups[g].lastTransactions : [];
    for (let i = 0; i < list.length; i++){
      const it = list[i] || {};
      if (String(it.originalTransactionId) !== String(originalTransactionId)) continue;
      const tx = verifyTransaction(it.signedTransactionInfo, acfg, opts);
      if (!tx.ok) return { ok: false, code: 'apple_data_unverified', reason: tx.reason };
      if (String(tx.transaction.originalTransactionId) !== String(originalTransactionId)){
        return { ok: false, code: 'apple_data_unverified', reason: 'mismatch' };
      }
      let renewal = null;
      if (it.signedRenewalInfo){
        const rn = verifyRenewalInfo(it.signedRenewalInfo, acfg, opts);
        if (!rn.ok) return { ok: false, code: 'apple_data_unverified', reason: rn.reason };
        renewal = rn.renewal;
      }
      return { ok: true, status: Number(it.status), transaction: tx.transaction, renewal: renewal };
    }
  }
  return { ok: false, code: 'purchase_not_found' };
}

// ===========================================================================
// APPLE'S WORDS -> OURS
// ===========================================================================

function asIso(ms){
  if (ms == null || ms === '') return null;
  const d = new Date(Number(ms));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* The status values of Get All Subscription Statuses. */
const STATUS = { ACTIVE: 1, EXPIRED: 2, BILLING_RETRY: 3, GRACE_PERIOD: 4, REVOKED: 5 };

/* IS THIS TRANSACTION THE FREE TRIAL?
 * offerType 1 is an introductory offer, and offerDiscountType FREE_TRIAL says
 * which kind. The only introductory offer APPLE-IN-APP-PURCHASE.md asks for is
 * the free trial, so an introductory transaction with no offerDiscountType
 * (older data) counts as the trial only when its period is no longer than the
 * trial. */
function inFreeTrial(tx){
  const t = tx || {};
  if (Number(t.offerType) !== 1) return false;
  if (t.offerDiscountType) return t.offerDiscountType === 'FREE_TRIAL';
  const start = Number(t.purchaseDate), end = Number(t.expiresDate);
  return isFinite(start) && isFinite(end) && (end - start) <= (Prod.TRIAL_DAYS + 1) * DAY_MS;
}

/* ONE APPLE SUBSCRIPTION -> THE FACTS THE CANONICAL MODEL NEEDS.
 *
 * The same shape _stripe.js and _google.js produce. What each status becomes:
 *
 *   1 active, free-trial transaction   trialing   trial_end = expiresDate
 *                                                  (cancel_at_period_end when
 *                                                  auto-renew is off)
 *   1 active, paid                     active     (cancelled when auto-renew
 *                                                  is off: access to expiry)
 *   2 expired                          expired
 *   3 billing retry                    past_due   no grace: Apple gives none
 *   4 billing grace period             past_due   grace_period_end = Apple's
 *                                                  gracePeriodExpiresDate
 *   5 revoked                          revoked    (Family Sharing loss, refund)
 *   revocationDate on the transaction  revoked    (a refund)
 *   anything else                      null       refused, never guessed
 *
 * A REFUND or REVOKE notification only RENAMES a subscription that Apple's own
 * re-read shows is no longer entitled, exactly as on the Play rail; it can
 * never end a live one, and never grants anything. */
function subscriptionFacts(tx, renewal, status, meta){
  const t = tx || {};
  const rn = renewal || {};
  const m = meta || {};
  const env = m.env || process.env;
  const nowMs = m.now != null ? new Date(m.now).getTime() : Date.now();
  if (t.type && t.type !== 'Auto-Renewable Subscription') return null;
  const offer = offerForProduct(t.productId, env);
  if (!offer) return null;

  const expiresMs = Number(t.expiresDate);
  const expiry = asIso(t.expiresDate);
  const autoRenew = Number(rn.autoRenewStatus) === 1;
  const st = Number(status);
  let condition = null;
  let trial = false;
  if (st === STATUS.ACTIVE){
    trial = inFreeTrial(t) && isFinite(expiresMs) && expiresMs > nowMs;
    condition = trial ? 'trialing' : (autoRenew ? 'active' : 'cancelled');
  }
  else if (st === STATUS.EXPIRED) condition = 'expired';
  else if (st === STATUS.BILLING_RETRY || st === STATUS.GRACE_PERIOD) condition = 'past_due';
  else if (st === STATUS.REVOKED) condition = 'revoked';
  if (!condition) return null;
  if (t.revocationDate) { condition = 'revoked'; trial = false; }

  const entitledNow = (st === STATUS.ACTIVE && isFinite(expiresMs) && expiresMs > nowMs) || st === STATUS.GRACE_PERIOD;
  if (m.revoked && !entitledNow) condition = 'revoked';

  const pastDue = condition === 'past_due';
  return {
    provider: PROVIDER,
    provider_event_id: m.eventId || null,
    event_type: m.type || 'verify',
    occurred_at: m.occurredAt || new Date(nowMs).toISOString(),
    /* NEVER FROM APPLE. The caller binds the account. */
    account_id: null,
    /* One Apple subscription is one originalTransactionId for life: renewals,
       plan changes within the group and resubscribes all keep it. */
    subscription_ref: t.originalTransactionId != null ? String(t.originalTransactionId) : null,
    customer_ref: null,
    condition: condition,
    offer_code: offer.offerCode,
    billing_period: offer.billingPeriod,
    product_id: t.productId,
    trial_start: trial ? asIso(t.purchaseDate) : null,
    trial_end: trial ? expiry : null,
    period_start: asIso(t.purchaseDate),
    period_end: pastDue ? null : expiry,
    grace_period_end: st === STATUS.GRACE_PERIOD && condition === 'past_due' ? asIso(rn.gracePeriodExpiresDate) : null,
    cancelled_at: null,
    cancel_at_period_end: !autoRenew && !pastDue && condition !== 'expired' && condition !== 'revoked',
    apple_status: st,
    environment: t.environment === 'Sandbox' ? 'sandbox' : 'production',
    app_account_token: t.appAccountToken ? String(t.appAccountToken).toLowerCase() : null,
    transaction_id: t.transactionId != null ? String(t.transactionId) : null,
    original_transaction_id: t.originalTransactionId != null ? String(t.originalTransactionId) : null
  };
}

/* What a verified notification ASKS us to look at, and nothing more. */
function notificationTarget(n){
  const x = n || {};
  if (x.notificationType === 'TEST') return { kind: 'test' };
  const d = x.data || {};
  if (d.signedTransactionInfo){
    return { kind: 'subscription', signedTransactionInfo: d.signedTransactionInfo,
             type: 'assn_' + String(x.notificationType || 'unknown').toLowerCase() +
                   (x.subtype ? '_' + String(x.subtype).toLowerCase() : ''),
             revoked: x.notificationType === 'REFUND' || x.notificationType === 'REVOKE' };
  }
  return { kind: 'ignored' };
}

module.exports = {
  PROVIDER, BUNDLE_ID, API_HOSTS, ENVIRONMENTS, ENV, STATUS,
  APPLE_ROOT_CA_G3_BASE64, APPLE_ROOT_CA_G3_SHA256, APPLE_ROOTS, OID_LEAF, OID_INTERMEDIATE,
  config, parsePrivateKey, allowedEnvironments, appleOfferRefs, offerForProduct,
  appAccountToken, sameToken, extensionOids,
  verifySignedData, verifyTransaction, verifyRenewalInfo, verifyNotification,
  apiToken, introductoryOfferSignature, transactionIdLooksValid, fetchStatuses, ourLastTransaction,
  inFreeTrial, subscriptionFacts, notificationTarget, ref, log
};
