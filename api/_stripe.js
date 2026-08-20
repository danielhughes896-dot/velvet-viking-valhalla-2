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
const C = require('./_commerce.js');

const API = 'https://api.stripe.com/v1';
const PROVIDER = 'stripe';

/* Which environment variable holds the Stripe price for each approved period.
   This mapping lives here rather than in _commerce.js because a price id is a
   fact about Stripe, and _commerce.js must read the same whether the offering
   is sold through Stripe, Apple or Google. */
const PRICE_ENV = {
  monthly: 'STRIPE_PRICE_STANDARD_MONTHLY',
  yearly:  'STRIPE_PRICE_STANDARD_YEARLY'
};

/* The Stripe price for a period, or a reason there isn't one. Read at call time
   rather than captured at module scope: Vercel evaluates module scope once per
   cold start, so a captured value would outlive a corrected variable.
   NO PRICE ID IS INVENTED -- until a human creates them in a Stripe account and
   sets them here, checkout refuses. An unset variable must never resolve to
   "charge them something". */
function priceFor(period, env){
  const plan = C.planFor(period);
  if (!plan) return { ok: false, code: 'unknown_billing_period' };
  const e = env || process.env;
  const id = String(e[PRICE_ENV[period]] || '').trim();
  if (!id) return { ok: false, code: 'price_not_configured' };
  /* Shape-checked to catch the commonest configuration mistake -- a product id,
     a lookup key or a whole dashboard URL pasted in -- before it reaches Stripe
     as a confusing 400. */
  if (!/^price_[A-Za-z0-9]+$/.test(id)) return { ok: false, code: 'price_id_malformed' };
  return { ok: true, priceId: id, plan: plan };
}

/* Five minutes, matching the existing generic webhook and Stripe's own
   published tolerance. Long enough for a retry queued behind an outage, short
   enough that a request captured off the wire is useless when replayed. */
const MAX_SKEW_SEC = 5 * 60;

function ref(v){ return v ? String(v).slice(0, 8) + '…' : '-'; }
function log(what){ try{ console.log('stripe: ' + what); }catch(e){} }

/* ---------- configuration ----------
   Read through a function, never captured at module scope: Vercel evaluates
   module scope once per cold start and a captured secret would outlive a
   rotation. `live` is deliberately NOT "a key exists" -- see _access.js for the
   same discipline. Commerce goes live when a human says so, not when a
   credential happens to be present. */
function config(env){
  const e = env || process.env;
  const secret = String(e.STRIPE_SECRET_KEY || '').trim();
  return {
    hasSecret: !!secret,
    secret: function(){ return secret; },
    hasWebhookSecret: !!String(e.STRIPE_WEBHOOK_SECRET || '').trim(),
    webhookSecret: function(){ return String(e.STRIPE_WEBHOOK_SECRET || '').trim(); },
    /* Test keys are usable; live keys additionally require the commercial flag
       to be on, so a live key sitting in a preview environment cannot charge. */
    isLiveKey: /^sk_live_/.test(secret),
    /* TWO ORIGINS, BECAUSE THERE ARE TWO DEPLOYMENTS.
     *
     * The marketing site and this backend are separate Vercel projects on
     * separate hosts, and Vercel does not route across projects. /account is
     * served by THIS repository's vercel.json; /pricing is a page in the
     * website repository. Building both redirect URLs from one origin sends
     * half of them somewhere that does not exist.
     *
     * VVV_SITE_ORIGIN is reused rather than renamed: _strava.js already uses it
     * to mean "this deployment's public origin", and inventing a second name
     * for the same fact is how two variables drift apart. There is deliberately
     * NO fallback -- a guessed origin becomes a redirect to a 404 that only
     * shows up after a real payment. */
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

async function call(cfg, method, path, params, opts){
  if (!cfg.hasSecret) return { ok: false, code: 'stripe_not_configured' };
  const headers = {
    'Authorization': 'Bearer ' + cfg.secret(),
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  /* Idempotency-Key makes a retried create safe. Without it, a network timeout
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
  const price = priceFor(input.period, input.env);
  if (!price.ok) return { ok: false, code: price.code };

  if (!cfg.appOrigin) return { ok: false, code: 'app_origin_not_configured' };
  const params = {
    mode: 'subscription',
    customer: input.customerId,
    /* Stripe returns the athlete here; the session id lets the success page ask
       our server what happened rather than believing a query string. */
    /* Success returns the athlete to THIS deployment, which serves /account and
       can therefore actually resolve their new entitlement. */
    success_url: cfg.appOrigin + '/account?checkout=complete&session_id={CHECKOUT_SESSION_ID}',
    /* Cancelling returns them to the marketing site's pricing page, which is a
       different project on a different host. */
    cancel_url: cfg.marketingOrigin + '/pricing?checkout=cancelled',
    client_reference_id: input.uid,
    'line_items[0][price]': price.priceId,
    'line_items[0][quantity]': 1,
    subscription_data: {
      trial_period_days: price.plan.trialDays,
      metadata: { vvv_user_id: input.uid, vvv_period: price.plan.period, vvv_tier: price.plan.tier }
    },
    metadata: { vvv_user_id: input.uid, vvv_period: price.plan.period }
  };
  const r = await call(cfg, 'POST', '/checkout/sessions', params, opts);
  if (!r.ok) return r;
  return {
    ok: true,
    sessionId: r.data.id,
    url: r.data.url,
    period: price.plan.period,
    trialDays: price.plan.trialDays
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

function uidOf(obj){
  const o = obj || {};
  const md = o.metadata || {};
  return md.vvv_user_id || o.client_reference_id || null;
}

function periodOf(sub){
  const md = (sub && sub.metadata) || {};
  if (C.isPeriod(md.vvv_period)) return md.vvv_period;
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  const interval = item && item.price && item.price.recurring && item.price.recurring.interval;
  if (interval === 'month') return 'monthly';
  if (interval === 'year') return 'yearly';
  return null;
}

/* One Stripe event -> zero or one Velvet Viking billing event. */
function normaliseEvent(stripeEvent){
  const ev = stripeEvent || {};
  const obj = (ev.data && ev.data.object) || {};
  const type = ev.type || '';

  /* `seq` orders events that arrive out of order. Stripe's `created` is
     seconds, which is coarse enough that two events in the same second would
     tie; the existing reducer treats a tie as "already applied", which is the
     safe direction. */
  const base = {
    provider: PROVIDER,
    provider_event_id: ev.id || null,
    seq: ev.created == null ? null : Number(ev.created),
    occurred_at: ev.created ? new Date(Number(ev.created) * 1000).toISOString() : null
  };

  function out(t, sub, extra){
    const uid = uidOf(sub) || uidOf(obj);
    if (!uid) return null;
    return Object.assign({}, base, {
      type: t,
      user_id: uid,
      period_end: periodEndOf(sub),
      tier: (sub && sub.metadata && sub.metadata.vvv_tier) || 'standard',
      billing_period: periodOf(sub),
      customer_id: (sub && sub.customer) || obj.customer || null,
      sub_id: (sub && sub.id) || obj.subscription || null
    }, extra || {});
  }

  switch (type){
    /* Checkout completing is the FIRST signal, and it is deliberately mapped
       to nothing on its own: the subscription object that follows carries the
       authoritative trial and period dates. Recording it in the ledger without
       moving entitlement is the honest treatment. */
    case 'checkout.session.completed':
      return Object.assign({}, base, {
        type: null, ledger_only: true, user_id: uidOf(obj),
        customer_id: obj.customer || null, sub_id: obj.subscription || null,
        billing_period: C.isPeriod((obj.metadata || {}).vvv_period) ? obj.metadata.vvv_period : null,
        note: 'checkout_completed'
      });

    case 'customer.subscription.created': {
      const s = obj;
      if (s.status === 'trialing') return out('trial_started', s);
      if (s.status === 'active') return out('subscription_started', s);
      return out('subscription_started', s);
    }

    case 'customer.subscription.updated': {
      const s = obj;
      const prev = (ev.data && ev.data.previous_attributes) || {};
      /* Cancellation scheduled, and un-scheduled. Both are about a flag, not
         about access -- access continues to period end either way, which is
         exactly what the existing model expresses without a new state. */
      if (s.cancel_at_period_end === true && prev.cancel_at_period_end === false){
        return out('subscription_cancelled', s);
      }
      if (s.cancel_at_period_end === false && prev.cancel_at_period_end === true){
        return out('subscription_resumed', s);
      }
      if (s.status === 'past_due' || s.status === 'unpaid') return out('payment_failed', s);
      if (s.status === 'active' && (prev.status === 'past_due' || prev.status === 'unpaid' || prev.status === 'trialing')){
        return out(prev.status === 'trialing' ? 'subscription_started' : 'payment_recovered', s);
      }
      if (s.status === 'canceled') return out('subscription_ended', s);
      /* A period rolling forward with no status change is a renewal. */
      if (s.status === 'active' && prev.current_period_end) return out('subscription_renewed', s);
      return Object.assign({}, base, { type: null, ledger_only: true, user_id: uidOf(s), note: 'subscription_updated_no_access_change' });
    }

    case 'customer.subscription.deleted':
      return out('subscription_ended', obj);

    case 'invoice.payment_failed':
      return Object.assign({}, base, {
        type: 'payment_failed', user_id: uidOf(obj),
        customer_id: obj.customer || null, sub_id: obj.subscription || null,
        period_end: null, tier: 'standard', billing_period: null
      });

    case 'invoice.payment_succeeded':
      return Object.assign({}, base, {
        type: 'payment_recovered', user_id: uidOf(obj),
        customer_id: obj.customer || null, sub_id: obj.subscription || null,
        period_end: obj.lines && obj.lines.data && obj.lines.data[0] && obj.lines.data[0].period
          ? new Date(Number(obj.lines.data[0].period.end) * 1000).toISOString() : null,
        tier: 'standard', billing_period: null
      });

    /* A refund or a dispute ends access now. It is a provider EVENT mapped to
       the existing subscription_ended, not a new entitlement state -- the
       access consequence is identical and a separate state would change no
       decision while adding a way for the row to disagree with itself. */
    case 'charge.refunded':
    case 'charge.dispute.created':
      return Object.assign({}, base, {
        type: 'subscription_ended', user_id: uidOf(obj),
        customer_id: obj.customer || null, sub_id: null,
        period_end: null, tier: 'standard', billing_period: null,
        note: type === 'charge.refunded' ? 'refunded' : 'disputed'
      });

    default:
      return null;
  }
}

module.exports = {
  API, PROVIDER, MAX_SKEW_SEC,
  config, encode, call, ensureCustomer, createCheckoutSession, priceFor, PRICE_ENV,
  parseSigHeader, verifySignature, normaliseEvent, periodOf, periodEndOf, uidOf, ref, log
};
