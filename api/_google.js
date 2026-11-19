// Velvet Viking -- the Google Play adapter. The ONLY file that knows Google
// Play Billing exists.
//
// It is to the Google rail exactly what _stripe.js is to the web rail:
// everything Google-shaped stops here -- the service-account sign-in, the
// androidpublisher REST paths, the subscriptionsv2 state enum, the Pub/Sub push
// token -- and what leaves is the provider-neutral FACTS shape _stripe.js
// already produces (account, subscription reference, condition, offer, period
// and trial dates). Nothing downstream learns that a purchase came from Play.
//
// NO SDK. Signing a service-account JWT is node's own crypto, and the two REST
// calls this needs are two fetches. The googleapis package is a very large
// dependency tree to put beside a private key.
//
// WHAT THIS FILE WILL NOT DO
//   - decide whether anybody may use SACORO. It maps Google's words onto ours
//     and stops; _entitlement.js decides, from the rows, exactly as it does
//     for the web rail.
//   - attach a purchase to an account. Google never tells us who an athlete
//     is: it echoes back an opaque id WE set (obfuscatedAccountId), and the
//     caller compares that against the authenticated athlete.
//   - trust a notification for STATE. A Real-time developer notification says
//     only that something changed; the state is always re-read from Google.
//   - log a private key, an access token, a push token or a full purchase
//     token.

'use strict';

const crypto = require('crypto');
const Prod = require('./_products.js');

const PROVIDER = 'google';

/* The Play application this server sells for. It is the app id in
   android/app/build.gradle and capacitor.config.json, not configuration: a
   different package is a different app, and a notification naming one is not
   ours to apply. */
const PACKAGE_NAME = 'com.velvetviking.valhalla';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/* Clock skew allowed on a push token's exp / iat. A minute: Pub/Sub mints the
   token at delivery, so anything older than its hour of validity plus this is
   a replay, not a slow network. */
const MAX_SKEW_SEC = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/* The environment names, listed once so the fail-closed messages and the
   documentation name the same variables. VALUES ARE NEVER LOGGED. */
const ENV = {
  serviceAccount: 'VVV_GOOGLE_PLAY_SERVICE_ACCOUNT',
  accountIdSecret: 'VVV_GOOGLE_ACCOUNT_ID_SECRET',
  rtdnAudience: 'VVV_GOOGLE_RTDN_AUDIENCE',
  rtdnServiceAccount: 'VVV_GOOGLE_RTDN_SERVICE_ACCOUNT'
};

function ref(v){ return v ? String(v).slice(0, 8) + '…' : '-'; }
function log(what){ try{ console.log('google: ' + what); }catch(e){} }

// ===========================================================================
// CONFIGURATION
// ===========================================================================

/* The service-account key, as Google issues it (the JSON file), either pasted
   whole or base64-encoded -- Vercel's editor is unkind to multi-line values,
   and base64 is the usual way round that. Returns null rather than throwing:
   an unreadable key is "not configured", and that fails closed. */
function parseServiceAccount(raw){
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let text = s;
  if (s.charAt(0) !== '{'){
    try{ text = Buffer.from(s, 'base64').toString('utf8').trim(); }catch(e){ return null; }
  }
  let j = null;
  try{ j = JSON.parse(text); }catch(e){ return null; }
  if (!j || typeof j !== 'object') return null;
  const email = String(j.client_email || '').trim();
  /* A key pasted through a shell often arrives with literal backslash-n in
     place of newlines; PEM needs the real thing. */
  const key = String(j.private_key || '').replace(/\\n/g, '\n').trim();
  if (!email || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key)) return null;
  return { client_email: email, private_key: key, private_key_id: j.private_key_id || null };
}

/* THE PLAY IDENTIFIERS, under the catalogue's own convention.
 *
 * VVV_PRICE_GOOGLE_STANDARD_MONTHLY = "sacoro_standard:monthly"
 * VVV_PRICE_GOOGLE_STANDARD_YEARLY  = "sacoro_standard:annual"
 *
 * A Play subscription is a PRODUCT with BASE PLANS, so the identifier for one
 * of our offers is the pair. Read through Prod.providerRef() so there is one
 * naming scheme for every rail, and an unset or malformed value makes that
 * offer unpurchasable on Play rather than guessed. */
const PLAY_ID = /^[a-z0-9][a-z0-9._]{0,139}$/;
const BASE_PLAN_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
function playOfferRefs(env){
  const out = {};
  Object.keys(Prod.OFFERS).forEach(function(code){
    const v = Prod.providerRef(PROVIDER, code, env);
    if (!v) return;
    const i = v.indexOf(':');
    if (i < 1) return;
    const productId = v.slice(0, i).trim();
    const basePlanId = v.slice(i + 1).trim();
    if (!PLAY_ID.test(productId) || !BASE_PLAN_ID.test(basePlanId)) return;
    out[code] = { offerCode: code, productId: productId, basePlanId: basePlanId,
                  billingPeriod: Prod.OFFERS[code].billingPeriod };
  });
  return out;
}

/* Which of OUR offers a Play product and base plan are. Null for anything not
   configured: an unmapped purchase is refused, never classified by guesswork. */
function offerForPlay(productId, basePlanId, env){
  const refs = playOfferRefs(env);
  const hit = Object.keys(refs).filter(function(k){
    return refs[k].productId === productId && refs[k].basePlanId === basePlanId;
  })[0];
  return hit ? refs[hit] : null;
}

/* Read through a function, never captured at module scope, for the reason
   _stripe.js gives: Vercel evaluates module scope once per cold start, and a
   captured secret outlives its rotation. */
function config(env){
  const e = env || process.env;
  const sa = parseServiceAccount(e[ENV.serviceAccount]);
  const idSecret = String(e[ENV.accountIdSecret] || '').trim();
  const audience = String(e[ENV.rtdnAudience] || '').trim();
  const pushEmail = String(e[ENV.rtdnServiceAccount] || '').trim();
  const offers = playOfferRefs(e);
  const productIds = Object.keys(offers).map(function(k){ return offers[k].productId; })
    .filter(function(v, i, a){ return a.indexOf(v) === i; });

  /* NAMES of what is missing, never values, so a 503 can say why without
     saying anything a log export should not hold. */
  const missing = [];
  if (!sa) missing.push(ENV.serviceAccount);
  if (!idSecret) missing.push(ENV.accountIdSecret);
  if (!Object.keys(offers).length) missing.push(Prod.providerRefEnvName(PROVIDER, 'STANDARD_MONTHLY') +
                                                ' / ' + Prod.providerRefEnvName(PROVIDER, 'STANDARD_YEARLY'));
  const rtdnMissing = [];
  if (!audience) rtdnMissing.push(ENV.rtdnAudience);
  if (!pushEmail) rtdnMissing.push(ENV.rtdnServiceAccount);

  return {
    packageName: PACKAGE_NAME,
    hasServiceAccount: !!sa,
    serviceAccount: function(){ return sa; },
    hasAccountIdSecret: !!idSecret,
    accountIdSecret: function(){ return idSecret; },
    offers: offers,
    /* ONE Play product, two base plans. If the two variables ever name
       different products this is null and the runtime is told nothing is
       configured, rather than offered half a catalogue. */
    productId: productIds.length === 1 ? productIds[0] : null,
    ok: missing.length === 0 && productIds.length === 1,
    missing: missing,
    rtdnAudience: audience,
    rtdnServiceAccount: pushEmail,
    hasRtdn: rtdnMissing.length === 0,
    rtdnMissing: rtdnMissing,
    env: e
  };
}

// ===========================================================================
// WHO AN ATHLETE IS, TO GOOGLE
// ===========================================================================

/* THE OBFUSCATED ACCOUNT ID.
 *
 * Play lets an app attach an opaque string to a purchase (setObfuscatedAccountId,
 * at most 64 characters) and echoes it back on the subscription
 * (externalAccountIdentifiers.obfuscatedExternalAccountId). Google's guidance
 * is a one-way hash of the app's own account id, never the id itself.
 *
 * HMAC-SHA256 of the account id under a server secret, base64url: 43
 * characters. Keyed rather than a bare hash so nobody who knows an athlete's
 * account id can compute their Play identifier, and so a purchase token cannot
 * be moved onto another account by somebody who merely knows that account's
 * id. The server hands each athlete their own value; the client never computes
 * it. */
function obfuscatedAccountId(accountId, secret){
  if (!accountId || !secret) return null;
  return crypto.createHmac('sha256', String(secret))
    .update('sacoro-play-account:' + String(accountId))
    .digest('base64url');
}

/* Constant-time comparison of two obfuscated ids. */
function sameObfuscatedId(a, b){
  if (!a || !b) return false;
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ===========================================================================
// SIGNING IN AS THE SERVICE ACCOUNT
// ===========================================================================

function b64url(buf){ return Buffer.from(buf).toString('base64url'); }

/* The OAuth 2.0 JWT-bearer assertion Google's token endpoint exchanges for an
   access token. RS256, signed with the service account's own key. */
function serviceAccountAssertion(sa, nowSec){
  const header = { alg: 'RS256', typ: 'JWT' };
  if (sa.private_key_id) header.kid = sa.private_key_id;
  const claims = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL,
                   iat: nowSec, exp: nowSec + 3600 };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key);
  return unsigned + '.' + b64url(sig);
}

/* One access token per warm instance, reused until five minutes before it
   expires. Keyed on the service account so a rotated key is not served a
   token minted for the old one. */
let tokenCache = { who: null, token: null, expiresAt: 0 };

async function accessToken(gcfg, opts){
  const sa = gcfg.serviceAccount();
  if (!sa) return { ok: false, code: 'google_not_configured' };
  const now = Date.now();
  if (tokenCache.who === sa.client_email + '|' + sa.private_key_id &&
      tokenCache.token && tokenCache.expiresAt - 5 * 60 * 1000 > now){
    return { ok: true, token: tokenCache.token };
  }
  let assertion;
  try{ assertion = serviceAccountAssertion(sa, Math.floor(now / 1000)); }
  catch(e){ log('SERVICE_ACCOUNT_KEY_UNUSABLE'); return { ok: false, code: 'google_key_unusable' }; }

  const fetchFn = (opts && opts.fetch) || globalThis.fetch;
  let r;
  try{
    r = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
            '&assertion=' + encodeURIComponent(assertion)
    });
  }catch(e){ return { ok: false, code: 'google_unreachable', transient: true }; }
  const j = await r.json().catch(function(){ return null; });
  if (!r.ok || !j || !j.access_token){
    /* The status only. Google's error body names the service account. */
    log('TOKEN_REFUSED status=' + r.status);
    return { ok: false, code: 'google_auth_refused', status: r.status, transient: r.status >= 500 };
  }
  tokenCache = { who: sa.client_email + '|' + sa.private_key_id, token: j.access_token,
                 expiresAt: now + (Number(j.expires_in) || 3600) * 1000 };
  return { ok: true, token: j.access_token };
}
function resetTokenCache(){ tokenCache = { who: null, token: null, expiresAt: 0 }; }

async function call(gcfg, method, url, body, opts){
  const t = await accessToken(gcfg, opts);
  if (!t.ok) return t;
  const fetchFn = (opts && opts.fetch) || globalThis.fetch;
  let r;
  try{
    r = await fetchFn(url, {
      method: method,
      headers: Object.assign({ 'Authorization': 'Bearer ' + t.token },
                             body === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }catch(e){ return { ok: false, code: 'google_unreachable', transient: true }; }
  const text = await r.text().catch(function(){ return ''; });
  let json = null;
  try{ json = text ? JSON.parse(text) : {}; }catch(e){ json = null; }
  if (!r.ok){
    return { ok: false, status: r.status,
             code: (r.status === 404 || r.status === 410) ? 'purchase_not_found' : 'google_http_' + r.status,
             transient: r.status >= 500 || r.status === 429 };
  }
  return { ok: true, data: json || {} };
}

/* A purchase token is opaque, but it has a shape, and checking it keeps
   anything else out of a URL. */
const TOKEN_SHAPE = /^[A-Za-z0-9._\-]{16,2048}$/;
function tokenLooksValid(t){ return TOKEN_SHAPE.test(String(t || '')); }
function productLooksValid(p){ return PLAY_ID.test(String(p || '')); }

/* THE TRUE STATE. purchases.subscriptionsv2.get, read with the service
   account. Everything this rail believes about a purchase comes from here. */
async function fetchSubscription(gcfg, purchaseToken, opts){
  if (!tokenLooksValid(purchaseToken)) return { ok: false, code: 'purchase_token_malformed' };
  const r = await call(gcfg, 'GET', API + encodeURIComponent(gcfg.packageName) +
    '/purchases/subscriptionsv2/tokens/' + encodeURIComponent(purchaseToken), undefined, opts);
  if (!r.ok) return r;
  return { ok: true, subscription: r.data };
}

/* ACKNOWLEDGED BY THE SERVER, AFTER IT HAS VERIFIED AND RECORDED THE PURCHASE.
 *
 * Google refunds and revokes a subscription that is not acknowledged within
 * three days. That is the backstop this design leans on: a purchase the server
 * refuses (somebody else's, a second live subscription, a second trial) is
 * simply never acknowledged, and Google gives the money back. The device never
 * acknowledges, so the only path to an acknowledged purchase runs through the
 * checks in _google-purchase.js. */
async function acknowledge(gcfg, productId, purchaseToken, opts){
  if (!productLooksValid(productId)) return { ok: false, code: 'product_id_malformed' };
  if (!tokenLooksValid(purchaseToken)) return { ok: false, code: 'purchase_token_malformed' };
  return call(gcfg, 'POST', API + encodeURIComponent(gcfg.packageName) +
    '/purchases/subscriptions/' + encodeURIComponent(productId) +
    '/tokens/' + encodeURIComponent(purchaseToken) + ':acknowledge', {}, opts);
}

// ===========================================================================
// GOOGLE'S WORDS -> OURS
// ===========================================================================

function asIso(v, nowMs){
  if (v == null || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* The line item that is ours. SACORO sells one product, so a subscription has
   one line item; if Google ever returns several, the one whose product and
   base plan map to a configured offer is the one that counts. */
function ourLineItem(sub, env){
  const items = (sub && Array.isArray(sub.lineItems)) ? sub.lineItems : [];
  for (let i = 0; i < items.length; i++){
    const it = items[i] || {};
    const base = it.offerDetails && it.offerDetails.basePlanId;
    if (offerForPlay(it.productId, base, env)) return it;
  }
  return null;
}

/* IS THE CURRENT PHASE THE FREE TRIAL?
 *
 * Google says so directly: lineItems[].offerPhase.freeTrial is present while
 * the free trial runs (and basePrice once it has converted). That is the
 * authority.
 *
 * Fallback, only when a response carries no offerPhase at all: the purchase
 * was made with an OFFER (only the free-trial offer exists on the base plans
 * GOOGLE-PLAY-BILLING.md asks for) and the current period, from start to
 * expiry, is no longer than the trial. Written down rather than implied, and
 * never consulted when Google has said which phase it is. */
function inFreeTrial(sub, item){
  const it = item || {};
  if (it.offerPhase && typeof it.offerPhase === 'object'){
    return !!it.offerPhase.freeTrial;
  }
  const offerId = it.offerDetails && it.offerDetails.offerId;
  const start = Date.parse(sub && sub.startTime);
  const end = Date.parse(it.expiryTime);
  if (!offerId || !isFinite(start) || !isFinite(end)) return false;
  return (end - start) <= (Prod.TRIAL_DAYS + 1) * DAY_MS;
}

/* Google's subscriptionState -> the canonical condition, before the trial and
   revocation refinements below. An unknown or not-yet-paid state is null, and
   null is refused rather than guessed into something that grants access. */
const STATE_CONDITION = {
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_CANCELED: 'cancelled',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'past_due',
  SUBSCRIPTION_STATE_ON_HOLD: 'past_due',
  SUBSCRIPTION_STATE_PAUSED: 'past_due',
  SUBSCRIPTION_STATE_EXPIRED: 'expired',
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: 'expired'
};

/* ONE PLAY SUBSCRIPTION -> THE FACTS THE CANONICAL MODEL NEEDS.
 *
 * The same shape _stripe.js's subscriptionFacts() returns, so
 * _billing-apply.js writes it without knowing which rail it came from. What
 * each Google state becomes, and why:
 *
 *   ACTIVE, free-trial phase      trialing    trial_end = expiryTime
 *   ACTIVE, paid phase            active      (cancelled if auto-renew is off)
 *   CANCELED, free-trial phase    trialing    with cancel_at_period_end: the
 *                                             web rail's Stripe trial behaves
 *                                             the same way, the trial still
 *                                             runs to its end, and this is
 *                                             what spends the one trial
 *   CANCELED, expiry in future    cancelled   the paid period runs to expiryTime
 *   CANCELED, expiry passed       expired
 *   IN_GRACE_PERIOD               past_due    grace_period_end = expiryTime,
 *                                             which Google extends to the end of
 *                                             ITS grace; nothing of ours added
 *   ON_HOLD                       past_due    no grace: Google says no access
 *   PAUSED                        past_due    no grace, no access (Play's own
 *                                             pause; see GOOGLE-PLAY-BILLING.md)
 *   EXPIRED                       expired
 *   PENDING_PURCHASE_CANCELED     expired
 *   PENDING / anything else       null        nothing has been paid; refused
 *
 * REVOKED. subscriptionsv2 has no "revoked" state: a revoked or refunded
 * subscription simply stops being entitled. `meta.revoked` is set by the
 * webhook when Google's notification said SUBSCRIPTION_REVOKED or voided the
 * purchase -- and even then it only renames a subscription that Google's own
 * re-read already shows is no longer entitled. A notification can never make a
 * live subscription read as revoked, and can never grant anything.
 *
 * current_period_end is PAID-THROUGH, as COMMERCIAL-CORE.md requires. For Play
 * that is expiryTime while a period is paid for; in grace and on hold it is
 * null, because the period that expiryTime describes is the unpaid one. */
function subscriptionFacts(sub, meta){
  const s = sub || {};
  const m = meta || {};
  const env = m.env || process.env;
  const nowMs = m.now != null ? new Date(m.now).getTime() : Date.now();
  const item = ourLineItem(s, env);
  if (!item) return null;

  const base = item.offerDetails && item.offerDetails.basePlanId;
  const offer = offerForPlay(item.productId, base, env);
  if (!offer) return null;

  const state = String(s.subscriptionState || '');
  let condition = STATE_CONDITION[state] || null;
  if (!condition) return null;

  const expiry = asIso(item.expiryTime);
  const expiryMs = expiry ? Date.parse(expiry) : NaN;
  const autoRenew = !!(item.autoRenewingPlan && item.autoRenewingPlan.autoRenewEnabled);
  const trial = (state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_CANCELED') &&
                inFreeTrial(s, item) && isFinite(expiryMs) && expiryMs > nowMs;

  if (trial) condition = 'trialing';
  else if (state === 'SUBSCRIPTION_STATE_ACTIVE' && !autoRenew) condition = 'cancelled';
  else if (state === 'SUBSCRIPTION_STATE_CANCELED' && !(isFinite(expiryMs) && expiryMs > nowMs)) condition = 'expired';

  /* Entitled right now, by Google's own account of it. Used only to decide
     whether a revocation notice may rename the row. */
  const entitledNow = isFinite(expiryMs) && expiryMs > nowMs &&
    (state === 'SUBSCRIPTION_STATE_ACTIVE' || state === 'SUBSCRIPTION_STATE_CANCELED' ||
     state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD');
  if (m.revoked && !entitledNow) condition = 'revoked';

  const pastDue = condition === 'past_due';
  const cancelCtx = s.canceledStateContext || {};
  const userCancel = cancelCtx.userInitiatedCancellation || {};
  const ext = s.externalAccountIdentifiers || {};
  const outOfApp = s.outOfAppPurchaseContext || {};
  const expiredExt = outOfApp.expiredExternalAccountIdentifiers || {};
  const start = asIso(s.startTime);

  return {
    provider: PROVIDER,
    provider_event_id: m.eventId || null,
    /* Kept for the ledger: which notification (or a pulled verify) told us. */
    event_type: m.type || 'verify',
    occurred_at: m.occurredAt || new Date(nowMs).toISOString(),
    /* NEVER FROM GOOGLE. The caller binds the account after comparing the
       obfuscated id with the authenticated athlete or a known purchase. */
    account_id: null,
    subscription_ref: m.purchaseToken || null,
    customer_ref: null,
    condition: condition,
    offer_code: offer.offerCode,
    billing_period: offer.billingPeriod,
    product_id: item.productId,
    base_plan_id: base,
    offer_id: (item.offerDetails && item.offerDetails.offerId) || null,
    trial_start: trial ? start : null,
    trial_end: trial ? expiry : null,
    period_start: trial ? start : null,
    period_end: pastDue ? null : expiry,
    /* GRACE IS GOOGLE'S TO GIVE. Only IN_GRACE_PERIOD carries one, and it is
       the instant Google says entitlement lasts until. */
    grace_period_end: state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' ? expiry : null,
    cancelled_at: asIso(userCancel.cancelTime),
    cancel_at_period_end: !autoRenew && !pastDue && condition !== 'expired' && condition !== 'revoked',
    google_state: state,
    acknowledgement_pending: s.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
    environment: s.testPurchase ? 'sandbox' : 'production',
    obfuscated_account_id: ext.obfuscatedExternalAccountId || null,
    linked_purchase_token: s.linkedPurchaseToken || null,
    expired_purchase_token: outOfApp.expiredPurchaseToken || null,
    expired_obfuscated_account_id: expiredExt.obfuscatedExternalAccountId || null
  };
}

// ===========================================================================
// THE PUSH TOKEN ON A REAL-TIME DEVELOPER NOTIFICATION
// ===========================================================================

/* Google's signing keys, as a JWK set, cached per warm instance for an hour and
   refetched when a token names a key we have not seen (Google rotates them). */
let certCache = { keys: null, fetchedAt: 0 };
function resetCertCache(){ certCache = { keys: null, fetchedAt: 0 }; }

async function googleCerts(opts, force){
  const fresh = certCache.keys && (Date.now() - certCache.fetchedAt) < 60 * 60 * 1000;
  if (fresh && !force) return { ok: true, keys: certCache.keys };
  const fetchFn = (opts && opts.fetch) || globalThis.fetch;
  try{
    const r = await fetchFn(CERTS_URL, { method: 'GET' });
    const j = await r.json().catch(function(){ return null; });
    if (!r.ok || !j || !Array.isArray(j.keys)) return { ok: false, reason: 'certs_unavailable' };
    certCache = { keys: j.keys, fetchedAt: Date.now() };
    return { ok: true, keys: j.keys };
  }catch(e){ return { ok: false, reason: 'certs_unavailable' }; }
}

function decodePart(part){
  try{ return JSON.parse(Buffer.from(String(part), 'base64url').toString('utf8')); }
  catch(e){ return null; }
}

/* VERIFY A PUB/SUB PUSH TOKEN.
 *
 * Pub/Sub, configured with OIDC authentication, signs a Google ID token for
 * the push subscription's service account and sends it as
 * `Authorization: Bearer <jwt>`. It is accepted only when every one of these
 * holds, and the first one that fails is the reason given:
 *
 *   RS256, signed by a key in Google's published set (kid)
 *   iss  accounts.google.com or https://accounts.google.com
 *   aud  exactly VVV_GOOGLE_RTDN_AUDIENCE
 *   email exactly VVV_GOOGLE_RTDN_SERVICE_ACCOUNT, and email_verified
 *   exp in the future, iat not in the future (a minute of skew either way)
 *
 * Without the audience and the service account configured nothing verifies:
 * "any Google-signed token" is not authentication of OUR subscription. */
async function verifyPushToken(token, expect, opts){
  const e = expect || {};
  if (!e.audience || !e.email) return { ok: false, reason: 'not_configured' };
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (!header || !claims) return { ok: false, reason: 'malformed' };
  if (header.alg !== 'RS256') return { ok: false, reason: 'bad_algorithm' };
  if (!header.kid) return { ok: false, reason: 'no_key_id' };

  let certs = await googleCerts(opts, false);
  let jwk = certs.ok ? certs.keys.filter(function(k){ return k.kid === header.kid; })[0] : null;
  if (!jwk){
    certs = await googleCerts(opts, true);
    jwk = certs.ok ? certs.keys.filter(function(k){ return k.kid === header.kid; })[0] : null;
  }
  if (!certs.ok) return { ok: false, reason: certs.reason };
  if (!jwk) return { ok: false, reason: 'unknown_key' };

  let valid = false;
  try{
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    valid = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key,
                          Buffer.from(parts[2], 'base64url'));
  }catch(err){ valid = false; }
  if (!valid) return { ok: false, reason: 'bad_signature' };

  const nowSec = e.nowSec != null ? e.nowSec : Math.floor(Date.now() / 1000);
  if (ISSUERS.indexOf(claims.iss) === -1) return { ok: false, reason: 'bad_issuer' };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (aud.indexOf(e.audience) === -1) return { ok: false, reason: 'bad_audience' };
  if (claims.email !== e.email) return { ok: false, reason: 'bad_email' };
  if (claims.email_verified !== true && claims.email_verified !== 'true') return { ok: false, reason: 'email_unverified' };
  if (!(Number(claims.exp) > nowSec - MAX_SKEW_SEC)) return { ok: false, reason: 'expired' };
  if (claims.iat != null && Number(claims.iat) > nowSec + MAX_SKEW_SEC) return { ok: false, reason: 'issued_in_future' };
  return { ok: true, reason: 'verified' };
}

/* The DeveloperNotification inside a Pub/Sub push body. Returns null for a body
   that is not one; the caller answers that with a 400. */
function decodePush(body){
  const b = body || {};
  const msg = b.message || {};
  if (!msg.messageId || typeof msg.data !== 'string') return null;
  let n = null;
  try{ n = JSON.parse(Buffer.from(msg.data, 'base64').toString('utf8')); }catch(e){ n = null; }
  if (!n || typeof n !== 'object') return null;
  return { messageId: String(msg.messageId), notification: n };
}

/* What a notification ASKS us to look at, and nothing more. The type is kept
   for the ledger and for one thing only: whether a re-read that shows the
   subscription is no longer entitled should be recorded as revoked. */
const SUBSCRIPTION_REVOKED = 12;
const PRODUCT_TYPE_SUBSCRIPTION = 1;
function notificationTarget(n){
  const x = n || {};
  if (x.testNotification) return { kind: 'test' };
  if (x.subscriptionNotification && x.subscriptionNotification.purchaseToken){
    const type = Number(x.subscriptionNotification.notificationType);
    return { kind: 'subscription', purchaseToken: String(x.subscriptionNotification.purchaseToken),
             type: 'rtdn_' + (isFinite(type) ? type : 'unknown'), revoked: type === SUBSCRIPTION_REVOKED };
  }
  if (x.voidedPurchaseNotification && x.voidedPurchaseNotification.purchaseToken &&
      Number(x.voidedPurchaseNotification.productType) === PRODUCT_TYPE_SUBSCRIPTION){
    return { kind: 'subscription', purchaseToken: String(x.voidedPurchaseNotification.purchaseToken),
             type: 'rtdn_voided', revoked: true };
  }
  return { kind: 'ignored' };
}

module.exports = {
  PROVIDER, PACKAGE_NAME, ENV, TOKEN_URL, SCOPE, API, CERTS_URL, ISSUERS, STATE_CONDITION,
  config, parseServiceAccount, playOfferRefs, offerForPlay,
  obfuscatedAccountId, sameObfuscatedId,
  serviceAccountAssertion, accessToken, resetTokenCache, call,
  tokenLooksValid, productLooksValid, fetchSubscription, acknowledge,
  inFreeTrial, subscriptionFacts,
  googleCerts, resetCertCache, verifyPushToken, decodePush, notificationTarget,
  ref, log
};
