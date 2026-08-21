// Velvet Viking -- the Stripe adapter. The ONLY file that knows Stripe exists.
//
// Everything Stripe-shaped stops here: its event names, its object shapes, its
// signature scheme, its status vocabulary. What leaves this file is Velvet
// Viking's own event vocabulary from _billing.js, which is why the entitlement
// resolver, the coaching engine and every website component remain unable to
// tell which provider paid.
//
// NO SDK. Stripe's REST API over form encoding is a dozen lines and adds no
// dependency, no bundled transitive tree and nothing to keep patched. The SDK
// buys retries and typing; neither is worth a supply-chain surface on the file
// that holds the secret key.
//
// WHAT THIS FILE WILL NOT DO
//   - decide whether anyone may use Valhalla. That is _access.js, and it reads
//     an entitlement row, never a Stripe status.
//   - invent an entitlement state for a Stripe status it does not recognise.
//     An unmapped event is dropped and recorded, not guessed at.
//   - trust an amount, a price or a customer from anything a browser sent.
//   - log a key, a signature, a full customer id or an email.

'use strict';

const crypto = require('crypto');
const Prod = require('./_products.js');

const API = 'https://api.stripe.com/v1';

/* THE PROVIDER IS 'web', NOT 'stripe'.
 *
 * The canonical model's provider axis answers "which commercial rail did this
 * arrive on" -- web, apple or google -- because that is the axis the product,
 * the entitlement resolver and the store-policy rules turn on. Stripe is the
 * processor BENEATH the web rail, not a peer of the App Store.
 *
 * Naming the processor here would have made the provider column mean two
 * different things at once, and would have forced a translation every time a
 * web subscription was compared with an Apple one. The Stripe-specific facts
 * -- session ids, price ids, event ids -- stay inside this file as metadata. */
const PROVIDER = 'web';

/* Stripe subscription status -> the canonical condition vocabulary. Explicit,
 * because a status this file does not recognise must not be guessed into a
 * condition that grants access. */
const CONDITION_OF = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'expired',
  incomplete: 'past_due',
  incomplete_expired: 'expired',
  paused: 'past_due'
};

/* Five minutes, matching Stripe's own published tolerance. Long enough for a
 * retry queued behind an outage, short enough that a request captured off the
 * wire is useless by the time anyone replays it. */
const MAX_SKEW_SEC = 5 * 60;

function ref(v){ return v ? String(v).slice(0, 8) + '…' : '-'; }
function log(what){ try{ console.log('stripe: ' + what); }catch(e){} }

/* ---------- configuration ----------
   Read through a function, never captured at module scope: Vercel evaluates
   module scope once per cold start and a captured secret would outlive a
   rotation. `live` is deliberately NOT "a key exists" -- commerce goes live
   when a human says so, not when a credential happens to be present. */
function config(env){
  const e = env || process.env;
  const secret = String(e.STRIPE_SECRET_KEY || '').trim();
  return {
    hasSecret: !!secret,
    secret: function(){ return secret; },
    hasWebhookSecret: !!String(e.STRIPE_WEBHOOK_SECRET || '').trim(),
    webhookSecret: function(){ return String(e.STRIPE_WEBHOOK_SECRET || '').trim(); },
    isLiveKey: /^sk_live_/.test(secret),
    /* Which billing environment a Stripe test key represents, so sandbox rows
       are never mistaken for production ones in the ledger. */
    environment: /^sk_live_/.test(secret) ? 'production' : 'sandbox',
    appOrigin: String(e.VVV_SITE_ORIGIN || '').trim().replace(/\/+$/, ''),
    marketingOrigin: String(e.VVV_MARKETING_ORIGIN || 'https://velvetviking.co.uk').trim().replace(/\/+$/, '')
  };
}

/* ---------- REST ----------
   Form encoding, because that is what Stripe accepts. Nested keys use Stripe's
   bracket convention. */
function encode(obj, prefix, out){
  out = out || [];
  Object.keys(obj || {}).forEach(function(k){
    const v = obj[k];
    if (v === undefined || v === null) return;
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (typeof v === 'object' && !Array.isArray(v)) encode(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  });
  return out;
}

/* The Stripe price id for an approved offer, read from the canonical
   catalogue's own environment convention (VVV_PRICE_WEB_STANDARD_MONTHLY and
   friends) rather than a second naming scheme of this file's invention. Two
   conventions for one fact is how a price ends up configured in the variable
   nobody reads.

   NO PRICE ID IS INVENTED. Until a human creates them in a Stripe account and
   sets them, checkout refuses: an unset variable must never resolve to
   "charge them something". */
function priceFor(offerCode, env){
  if (!Prod.isOffer(offerCode)) return { ok: false, code: 'unknown_offer' };
  const id = Prod.providerRef(PROVIDER, offerCode, env);
  if (!id) return { ok: false, code: 'price_not_configured' };
  /* A Stripe price id looks like price_XXXX. Checking the shape catches the
     commonest configuration mistake -- a product id, a lookup key or a whole
     dashboard URL pasted in -- before it reaches Stripe as a confusing 400. */
  if (!/^price_[A-Za-z0-9]+$/.test(id)) return { ok: false, code: 'price_id_malformed' };
  return { ok: true, priceId: id, offer: Prod.offer(offerCode) };
}

async function call(cfg, method, path, params, opts){
  if (!cfg.hasSecret) return { ok: false, code: 'stripe_not_configured' };
  const headers = {
    'Authorization': 'Bearer ' + cfg.secret(),
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  /* Idempotency-Key makes a retried create safe. Without it a network timeout
     on checkout creation is indistinguishable from a failure, and retrying
     produces a second session -- which is how duplicate charges begin. */
  if (opts && opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const fetchFn = (opts && opts.fetch) || globalThis.fetch;
  const r = await fetchFn(API + path, {
    method: method,
    headers: headers,
    body: method === 'GET' ? undefined : encode(params).join('&')
  });
  const text = await r.text();
  let json = null;
  try{ json = JSON.parse(text); }catch(e){ /* handled below */ }
  if (!r.ok || !json || json.error){
    const err = (json && json.error) || {};
    /* A code, never Stripe's message: its error bodies echo the request, and
       the request carries the customer id and the price. */
    return {
      ok: false,
      status: r.status,
      code: err.code ? 'stripe_' + err.code : 'stripe_http_' + r.status,
      transient: r.status >= 500 || r.status === 429
    };
  }
  return { ok: true, data: json };
}

/* ---------- customer mapping ----------
   The Valhalla user id is the durable key and travels in metadata. Email is
   passed for the receipt Stripe sends, never as the relational key: an athlete
   who changes their email must not acquire a second customer, and two athletes
   who share one inbox must not collapse into one. */
async function ensureCustomer(cfg, uid, email, existingCustomerId, opts){
  if (existingCustomerId) return { ok: true, customerId: existingCustomerId, created: false };
  const r = await call(cfg, 'POST', '/customers', {
    email: email || undefined,
    metadata: { vvv_user_id: uid }
  }, Object.assign({ idempotencyKey: 'cust:' + uid }, opts || {}));
  if (!r.ok) return r;
  return { ok: true, customerId: r.data.id, created: true };
}

/* ---------- checkout ----------
   The browser names a PERIOD. This resolves the period to a price id from the
   environment and hands Stripe that. No amount, no currency and no price id
   ever crosses the wire from a client. */
async function createCheckoutSession(cfg, input, opts){
  const price = priceFor(input.offerCode, input.env);
  if (!price.ok) return { ok: false, code: price.code };

  if (!cfg.appOrigin) return { ok: false, code: 'app_origin_not_configured' };
  const params = {
    mode: 'subscription',
    customer: input.customerId,
    /* Success returns the athlete to THIS deployment, which serves /account and
       can therefore resolve their new entitlement. The session id lets that
       page ask our server what happened rather than believing a query string. */
    success_url: cfg.appOrigin + '/account?checkout=complete&session_id={CHECKOUT_SESSION_ID}',
    /* Cancelling returns them to the marketing site's pricing page, which is a
       different project on a different host. */
    cancel_url: cfg.marketingOrigin + '/pricing?checkout=cancelled',
    client_reference_id: input.uid,
    'line_items[0][price]': price.priceId,
    'line_items[0][quantity]': 1,
    /* PAYMENT METHOD REQUIRED UPFRONT, SAID OUT LOUD.
       Stripe's default for a subscription Checkout is already 'always', so this
       line changes no behaviour today. It is here because the commercial model
       HQ chose rests entirely on it -- a fourteen-day trial that converts
       automatically is a different product from a card-free trial -- and a
       requirement that important must not be a default somebody could flip in
       a dashboard, or that Stripe could change, without a diff. */
    payment_method_collection: 'always',
    subscription_data: {
      trial_period_days: price.offer.trialDays,
      /* Everything needed to reconstruct the purchase from a webhook alone,
         because a webhook may arrive before, after, or instead of the browser
         ever returning to the success page. */
      metadata: {
        vvv_account_id: input.accountId, vvv_offer: price.offer.code,
        vvv_period: price.offer.billingPeriod, vvv_product: price.offer.product
      }
    },
    metadata: {
      vvv_account_id: input.accountId, vvv_offer: price.offer.code,
      vvv_period: price.offer.billingPeriod
    }
  };
  const r = await call(cfg, 'POST', '/checkout/sessions', params, opts);
  if (!r.ok) return r;
  return {
    ok: true,
    sessionId: r.data.id,
    url: r.data.url,
    offerCode: price.offer.code,
    period: price.offer.billingPeriod,
    trialDays: price.offer.trialDays
  };
}

/* ---------- webhook signature ----------
   Stripe signs "<timestamp>.<raw body>" with HMAC-SHA256 and sends it as
   `t=…,v1=…`. The raw bytes matter: a re-serialised body has a different
   signature, which is why the caller must preserve them. */
function parseSigHeader(header){
  const out = { t: null, v1: [] };
  String(header || '').split(',').forEach(function(part){
    const i = part.indexOf('=');
    if (i < 1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') out.t = v;
    else if (k === 'v1') out.v1.push(v);
  });
  return out;
}

function verifySignature(rawBody, header, secret, nowSec){
  if (!secret) return { ok: false, reason: 'not_configured' };
  const p = parseSigHeader(header);
  if (!p.t || !p.v1.length) return { ok: false, reason: 'unsigned' };
  const ts = Number(p.t);
  if (!isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowSec - ts) > MAX_SKEW_SEC) return { ok: false, reason: 'stale_timestamp' };

  const expected = crypto.createHmac('sha256', secret)
    .update(p.t + '.' + String(rawBody)).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  /* Stripe may send several v1 signatures during a secret rotation. Any one
     matching is valid; all are compared in constant time and none short
     circuits on length, because throwing on a wrong length leaks the length. */
  let matched = false;
  for (let i = 0; i < p.v1.length; i++){
    const b = Buffer.from(String(p.v1[i]).trim().toLowerCase(), 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) matched = true;
  }
  return matched ? { ok: true, reason: 'verified' } : { ok: false, reason: 'bad_signature' };
}

/* ---------- event translation ----------
   Stripe's vocabulary in, Velvet Viking's out. Every branch is explicit and an
   unrecognised type produces null rather than a guess: Stripe emits well over a
   hundred event types and the vast majority mean nothing to an entitlement. */
function periodEndOf(sub){
  const s = sub || {};
  const secs = s.current_period_end || (s.trial_end && !s.current_period_end ? s.trial_end : null);
  return secs ? new Date(Number(secs) * 1000).toISOString() : null;
}

/* The ACCOUNT this belongs to. Carried in metadata we set at checkout, with
   client_reference_id as the fallback Stripe echoes back on the session. */
function accountOf(obj){
  const o = obj || {};
  const md = o.metadata || {};
  return md.vvv_account_id || o.client_reference_id || null;
}

/* The offer this subscription is for, from metadata first and from the price's
   recurring interval as a fallback -- so a subscription created outside our own
   checkout is still classifiable. */
function offerOf(sub){
  const md = (sub && sub.metadata) || {};
  if (Prod.isOffer(md.vvv_offer)) return md.vvv_offer;
  const p = periodOf(sub);
  const o = p ? Prod.offerForPeriod(p) : null;
  return o ? o.code : null;
}

/* Stripe status -> canonical condition. An unrecognised status returns null so
   the caller refuses rather than inventing one that grants access. */
function conditionOf(status){
  return CONDITION_OF[String(status || '')] || null;
}

function periodOf(sub){
  const md = (sub && sub.metadata) || {};
  if (Prod.BILLING_PERIODS.indexOf(md.vvv_period) !== -1) return md.vvv_period;
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  const interval = item && item.price && item.price.recurring && item.price.recurring.interval;
  if (interval === 'month') return 'monthly';
  if (interval === 'year') return 'yearly';
  return null;
}

/* ONE STRIPE EVENT -> THE FACTS THE CANONICAL MODEL NEEDS.
 *
 * This returns subscription FACTS, not a state transition. The old design
 * translated each event into a verb -- trial_started, payment_failed -- and let
 * a reducer move a state machine. That put two state machines in the system:
 * Stripe's and ours, and they could disagree after a missed or reordered event.
 *
 * Stripe already maintains the authoritative subscription object. So every
 * relevant event is treated the same way: read the current subscription off the
 * event and write it down. An out-of-order delivery then cannot corrupt
 * anything -- it simply restates a fact, and provider_updated_at records which
 * telling was newer.
 *
 * Returns null for the many event types that carry no subscription. */
function normaliseEvent(stripeEvent){
  const ev = stripeEvent || {};
  const obj = (ev.data && ev.data.object) || {};
  const type = String(ev.type || '');

  /* Only subscription-bearing events. An invoice or a charge tells us nothing
     the subscription object does not already say more reliably. */
  const isSub = /^customer\.subscription\./.test(type);
  if (!isSub) return null;

  const account_id = accountOf(obj);
  const condition = conditionOf(obj.status);
  /* An unrecognised Stripe status must not be guessed into a condition that
     grants access. Deleted subscriptions are the one case where Stripe's status
     may lag, and 'expired' is unambiguous there. */
  let finalCondition = type === 'customer.subscription.deleted' ? 'expired' : condition;

  /* REVOKED, AND WHERE IT LEGITIMATELY COMES FROM.
   *
   * 'expired' means the period ran out and nothing is owed. 'revoked' means the
   * provider pulled the purchase -- a dispute or a chargeback -- and it must
   * outrank every date on the row, because a refunded subscription whose period
   * ends next month must not keep granting access for a month.
   *
   * Stripe has no 'revoked' status, so this reads the one documented field that
   * says why a subscription ended: cancellation_details.reason. Its published
   * values are cancellation_requested, payment_disputed and payment_failed, and
   * only the disputed one is a revocation -- somebody asking to cancel, or a
   * card that stopped working, is an ordinary ending and stays 'expired'.
   *
   * NOTHING IS INFERRED BEYOND THAT. A refund issued from the dashboard with no
   * dispute produces no subscription event at all, so it is an operator action
   * against the subscriptions row, not something this file pretends to see. */
  if (finalCondition === 'expired'){
    const why = obj.cancellation_details && obj.cancellation_details.reason;
    if (why === 'payment_disputed') finalCondition = 'revoked';
  }
  if (!finalCondition) return null;

  const secs = function(v){ return v ? new Date(Number(v) * 1000).toISOString() : null; };

  return {
    provider: PROVIDER,
    provider_event_id: ev.id || null,
    /* Stripe's own type, kept for the ledger so an operator can see what
       arrived without needing this file to have named it. */
    stripe_type: type,
    occurred_at: secs(ev.created),
    account_id: account_id,
    subscription_ref: obj.id || null,
    customer_ref: obj.customer || null,
    condition: finalCondition,
    offer_code: offerOf(obj),
    billing_period: periodOf(obj),
    /* What this athlete agreed to, read from the catalogue that sold the offer
       rather than from the Stripe payload -- Stripe reports what it will
       charge, which is the same number today and not necessarily the same fact.
       Recorded once, at the start of the relationship. */
    agreed_price_minor: (function(){ const o = offerOf(obj); const x = o && Prod.offer(o); return x ? x.priceMinor : null; })(),
    agreed_currency: (function(){ const o = offerOf(obj); const x = o && Prod.offer(o); return x ? x.currency : null; })(),
    catalogue_version: Prod.CATALOGUE_VERSION,
    trial_start: secs(obj.trial_start),
    trial_end: secs(obj.trial_end),
    period_start: secs(obj.current_period_start),
    period_end: periodEndOf(obj),
    /* When the provider says the relationship actually ended, as distinct from
       cancel_at_period_end, which says it is going to. */
    cancelled_at: secs(obj.canceled_at),
    cancel_at_period_end: !!obj.cancel_at_period_end,
    /* Why it ended, in Stripe's own words, so an operator can tell a dispute
       from a request without this file having to name every value. */
    cancellation_reason: (obj.cancellation_details && obj.cancellation_details.reason) || null
  };
}

module.exports = {
  API, PROVIDER, MAX_SKEW_SEC,
  config, encode, call, ensureCustomer, createCheckoutSession, priceFor, PROVIDER, CONDITION_OF,
  parseSigHeader, verifySignature, normaliseEvent, periodOf, periodEndOf, accountOf, offerOf, conditionOf, ref, log
};
