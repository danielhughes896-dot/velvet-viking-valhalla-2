// Velvet Viking -- the Stripe adapter. The ONLY file that knows Stripe exists.
//
// Everything Stripe-shaped stops here: its event names, its object shapes, its
// signature scheme, its status vocabulary. What leaves this file is Velvet
// Viking's own provider-neutral event vocabulary, which is why the entitlement
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
    /* THE API VERSION OUR OWN CALLS ASK FOR.
     *
     * Unset by default, and that is deliberate rather than lazy: this file will
     * not invent a version. Which version the live account defaults to, and
     * which one the live webhook endpoint is pinned to, are facts about a
     * Stripe account that nobody has read yet -- and pinning the wrong one is
     * a worse failure than pinning none, because it would silently change the
     * shape of every object the adapter parses.
     *
     * WHY IT IS WORTH SETTING ANYWAY, once the value is known. Webhook payloads
     * render in the version pinned on the ENDPOINT; our REST calls render in
     * the ACCOUNT default. Those are two separate settings and nothing keeps
     * them equal, so the pushed path and the pulled path can be handed
     * different shapes for the same subscription -- and Phase 2 rests on those
     * two routes producing identical facts. Setting this to the endpoint's
     * version makes them provably the same.
     *
     * The period fallback above means correctness no longer DEPENDS on this.
     * It is the belt to that pair of braces, not the other way round. */
    apiVersion: String(e.STRIPE_API_VERSION || '').trim(),
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
  /* ONE PLACE. Every Stripe request in this codebase goes through call(), so
     the version is pinned here or not at all -- a header repeated at each call
     site is a header that will eventually be missing from one of them. Sent
     only when configured: an empty Stripe-Version is not "the default", it is a
     malformed request. */
  if (cfg.apiVersion) headers['Stripe-Version'] = cfg.apiVersion;
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

/* ---------- pause ----------
 *
 * THE POLICY IS NOT HERE. _pause.js decides whether an athlete may pause, for
 * how long, and how often; this turns an already-made decision into the two
 * Stripe calls that carry it out. That split is why the rule survives a change
 * of provider: what moves is this file, and nothing that reasons about an
 * athlete.
 *
 * WHY behavior = 'void' AND NOT 'mark_uncollectible' OR 'keep_as_draft'. All
 * three are documented Stripe behaviours and they mean genuinely different
 * things to the athlete:
 *
 *   void                 invoices are still raised for the paused period and
 *                        then voided. Nothing is collected, and nothing is owed
 *                        afterwards.
 *   keep_as_draft        the invoices wait as drafts and can be finalised
 *                        later -- a DEFERRAL, so the athlete comes back to a
 *                        bill for the months they did not use.
 *   mark_uncollectible   the debt is recorded and written off, which puts a
 *                        bad-debt mark against somebody who did nothing wrong.
 *
 * Valhalla promised a pause, not a deferral and not a write-off, so 'void' is
 * the only one that matches what was said.
 *
 * resumes_at is Stripe's own automatic resume. Nothing in Valhalla has to run a
 * job, and no athlete has to come back and press anything -- a pause that needs
 * either is a cancellation with a friendlier name.
 *
 * NOTHING IS INFERRED. Stripe's subscription STATUS does not change while
 * collection is paused, so this file does not invent a condition for it: the
 * pause lives in our own columns and the resolver reads it there. (Stripe does
 * have a distinct 'paused' status, but it means something else entirely -- a
 * trial that ended with no payment method -- and CONDITION_OF maps it to
 * past_due, which is what it actually is.) */
async function pauseCollection(cfg, subscriptionId, instruction, opts){
  const i = instruction || {};
  if (!subscriptionId) return { ok: false, code: 'no_subscription_id' };
  if (i.action !== 'suspend_collection') return { ok: false, code: 'not_a_pause_instruction' };
  const resumes = i.resumesAt ? Date.parse(i.resumesAt) : NaN;
  if (!isFinite(resumes)) return { ok: false, code: 'no_resume_date' };
  /* An open-ended pause is the failure the policy exists to prevent, and it is
     the one this call could still produce by omitting a field. Refused here as
     well as there: a second check costs nothing and this is the one that talks
     to the money. */
  if (i.chargeForPausedPeriod) return { ok: false, code: 'deferral_not_supported' };

  return call(cfg, 'POST', '/subscriptions/' + encodeURIComponent(subscriptionId), {
    pause_collection: { behavior: 'void', resumes_at: Math.floor(resumes / 1000) }
  }, Object.assign({ idempotencyKey: 'pause:' + subscriptionId + ':' + Math.floor(resumes / 1000) },
                   opts || {}));
}

/* Clearing the pause. Stripe unsets pause_collection when it is sent EMPTY, and
   encode() drops nulls and undefineds -- so a null here would send no field at
   all and silently leave the subscription paused. The empty string is the
   difference between resuming somebody and appearing to. */
async function resumeCollection(cfg, subscriptionId, opts){
  if (!subscriptionId) return { ok: false, code: 'no_subscription_id' };
  return call(cfg, 'POST', '/subscriptions/' + encodeURIComponent(subscriptionId), {
    pause_collection: ''
  }, Object.assign({ idempotencyKey: 'resume:' + subscriptionId }, opts || {}));
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

/* ---------- reading the provider back ----------
 *
 * A webhook is a NOTIFICATION, not the only way to learn a fact. It can be
 * delayed behind a queue, dropped by a bad deployment, or simply arrive after
 * the athlete's browser has already come back from Checkout. When that happens
 * the athlete has paid and Valhalla does not yet know, which is the worst
 * minute in the whole commercial journey to be wrong in.
 *
 * So the same facts can be PULLED. Both of these read Stripe server-side with
 * the secret key; neither trusts anything the browser said beyond an opaque
 * identifier that is then checked against the authenticated athlete.
 */
async function fetchCheckoutSession(cfg, sessionId, opts){
  if (!sessionId) return { ok: false, code: 'no_session_id' };
  /* Shape-checked before it is put in a URL. A Checkout Session id is
     cs_<alnum>; anything else is a client sending us something it made up, and
     it is refused here rather than becoming a request to Stripe. */
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId))) return { ok: false, code: 'session_id_malformed' };
  const r = await call(cfg, 'GET', '/checkout/sessions/' + encodeURIComponent(sessionId), null, opts);
  if (!r.ok) return r;
  return { ok: true, session: r.data };
}

async function fetchSubscription(cfg, subscriptionId, opts){
  if (!subscriptionId) return { ok: false, code: 'no_subscription_id' };
  if (!/^sub_[A-Za-z0-9_]+$/.test(String(subscriptionId))) return { ok: false, code: 'subscription_id_malformed' };
  const r = await call(cfg, 'GET', '/subscriptions/' + encodeURIComponent(subscriptionId), null, opts);
  if (!r.ok) return r;
  return { ok: true, subscription: r.data };
}

/* ---------- ending it, and changing your mind ----------
 *
 * CANCELLING IS NOT DELETING. `cancel_at_period_end` stops the renewal and
 * leaves the month the athlete already paid for exactly where it is --
 * _entitlement.js treats a cancelled subscription with a future period end as
 * live access, deliberately, because confiscating a paid month is how a
 * cancellation becomes a chargeback.
 *
 * Stripe's DELETE /subscriptions/:id ends it immediately and refunds nothing.
 * It is not used here and there is no code path to it: an athlete pressing
 * "cancel" in an account screen means "do not charge me again", never "take the
 * rest of what I paid for away".
 *
 * NO TRAINING HISTORY IS TOUCHED BY EITHER CALL. Cancellation is a billing
 * fact; plans, activities and execution history belong to the athlete and
 * survive it. Nothing in this file can reach them.
 */
async function cancelAtPeriodEnd(cfg, subscriptionId, opts){
  if (!subscriptionId) return { ok: false, code: 'no_subscription_id' };
  return call(cfg, 'POST', '/subscriptions/' + encodeURIComponent(subscriptionId), {
    cancel_at_period_end: 'true'
  }, Object.assign({ idempotencyKey: 'cancel:' + subscriptionId }, opts || {}));
}

/* Undoing a cancellation before the period runs out. Stripe keeps the same
   subscription, so this is a reversal rather than a new purchase -- no second
   trial, no second agreed price, no second row. */
async function clearCancelAtPeriodEnd(cfg, subscriptionId, opts){
  if (!subscriptionId) return { ok: false, code: 'no_subscription_id' };
  return call(cfg, 'POST', '/subscriptions/' + encodeURIComponent(subscriptionId), {
    cancel_at_period_end: 'false'
  }, Object.assign({ idempotencyKey: 'uncancel:' + subscriptionId }, opts || {}));
}

/* ---------- event translation ----------
   Stripe's vocabulary in, Velvet Viking's out. Every branch is explicit and an
   unrecognised type produces null rather than a guess: Stripe emits well over a
   hundred event types and the vast majority mean nothing to an entitlement. */
/* WHERE THE BILLING PERIOD LIVES, ASKED IN BOTH PLACES STRIPE PUTS IT.
 *
 * Stripe used to render current_period_start / current_period_end on the
 * SUBSCRIPTION. Newer API versions render them on each subscription ITEM
 * instead, because a subscription can in principle carry items on different
 * cycles. Which shape arrives depends on the API version in play, and that is
 * two separate settings -- the account default for our REST calls, the
 * endpoint's pin for webhook payloads -- neither of which this file controls.
 *
 * READING ONLY THE TOP LEVEL WAS A SILENT, DELAYED LOCKOUT. trial_end is
 * top-level in every version, so a fourteen-day trial resolved perfectly; the
 * period fields came back undefined, the row was written with a null
 * current_period_end, and _entitlement.js reads a null period on an `active`
 * subscription as EXPIRED. The athlete would have been refused the moment their
 * trial converted -- a fortnight after paying, having passed every test anybody
 * ran on the day.
 *
 * So the adapter asks both places, in the order of authority: the subscription
 * first, because when it is present it is the whole subscription's period; then
 * the first item, which is the same instant for the single-item subscriptions
 * Valhalla sells. Absent from both stays null, which is the existing
 * fail-closed behaviour and is left exactly as it was.
 *
 * VALHALLA SELLS ONE PRICE, so items.data[0] is the only item there is. A
 * multi-item subscription would need a rule about WHICH item's period governs,
 * and that rule would be a product decision rather than an adapter one -- named
 * here so the next person meets the question rather than the assumption.
 *
 * THE FIX BELONGS HERE AND NOT IN THE RESOLVER. _entitlement.js is
 * provider-neutral and must stay that way: teaching it about Stripe's object
 * layout would put a provider's shape into the access model, which is the one
 * thing this architecture exists to prevent. Translating a provider's wire
 * format into our canonical facts is precisely this file's job. */
function periodFieldOf(sub, field){
  const s = sub || {};
  if (s[field] != null) return s[field];
  const item = s.items && s.items.data && s.items.data[0];
  return (item && item[field] != null) ? item[field] : null;
}

function periodEndOf(sub){
  const s = sub || {};
  const end = periodFieldOf(s, 'current_period_end');
  /* A provider that expresses a trial as the first period rather than as a
     separate window still resolves: absent period end falls back to trial_end.
     Unchanged behaviour -- only where the period end is read from has moved. */
  const secs = end != null ? end : (s.trial_end != null ? s.trial_end : null);
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

/* WHAT current_period_end MEANS TO STRIPE, AND WHY IT IS NOT "PAID THROUGH".
 *
 * Stripe defines current_period_end as the end of the period the subscription
 * has been INVOICED for. Those are the same instant while invoices are being
 * paid, and they come apart the moment one is not: at renewal Stripe raises the
 * next invoice, ADVANCES the period, attempts the card, and moves the
 * subscription to past_due when the attempt fails. The row then carries a
 * period end a month in the future that nobody has paid for.
 *
 * The canonical column is current_period_end and its neutral meaning is the
 * instant access from this subscription runs out. For Apple that is
 * expires_date, which really is paid-through. For Stripe it is not, and
 * translating between a provider's words and ours is the entire job of this
 * file.
 *
 * So a past_due subscription reports the START of the unpaid period as its end:
 * the last period anybody actually paid for ended when this one began.
 * _entitlement.js then reaches 'payment_hold' rather than handing out a free
 * month -- the same rule the architecture recovery applied when it deleted
 * Valhalla's seven invented days of grace. Grace is a date a PROVIDER supplies,
 * and on a subscription object Stripe supplies none.
 *
 * WHY THIS IS SAFE EVEN IF STRIPE DOES NOT ADVANCE THE PERIOD. If the period
 * had not advanced, then the invoice covering it was the one that was paid --
 * and a subscription whose current invoice is paid is not past_due. Valhalla
 * sells one price with no add-ons, no metering, no prorations and no plan
 * switching, so there is no second invoice that could fail mid-period and no
 * way to be past_due inside a period that was paid for. Both readings of
 * Stripe's behaviour therefore reach the same answer here.
 *
 * IF A MID-PERIOD INVOICE IS EVER INTRODUCED -- an add-on, a proration, an
 * upgrade -- this is the function that has to learn the difference, because
 * from then on past_due would no longer imply the current period is unpaid.
 *
 * VERIFY IT ANYWAY. PHASE2-WEB-BILLING.md carries this as an owner step: fail a
 * renewal in Stripe test mode and read the resulting subscription object. */
function paidThroughOf(sub){
  const s = sub || {};
  const status = String(s.status || '');
  if (status !== 'past_due' && status !== 'unpaid') return periodEndOf(s);
  const start = periodFieldOf(s, 'current_period_start');
  return start != null
    ? new Date(Number(start) * 1000).toISOString()
    : null;
}

/* ONE STRIPE SUBSCRIPTION -> THE FACTS THE CANONICAL MODEL NEEDS.
 *
 * FACTS, NOT A STATE TRANSITION. The old design translated each event into a
 * verb -- trial_started, payment_failed -- and let a reducer move a state
 * machine. That put two state machines in the system: Stripe's and ours, and
 * they could disagree after a missed or reordered event.
 *
 * Stripe already maintains the authoritative subscription object. So every
 * relevant event is treated the same way: read the current subscription off it
 * and write it down. An out-of-order delivery cannot corrupt anything -- it
 * simply restates a fact, and provider_updated_at records which telling was
 * newer.
 *
 * Split out from normaliseEvent so the SAME translation serves a subscription
 * that was PULLED from Stripe rather than pushed to us. A reconciliation that
 * re-derived these facts its own way would be a second adapter, and a second
 * adapter is a second set of rounding errors.
 *
 * `meta` carries what an event knows and a fetched object does not: which
 * Stripe event type this was, its id, and when Stripe says it happened.
 * Returns null when the object cannot be classified into our vocabulary. */
function subscriptionFacts(sub, meta){
  const obj = sub || {};
  const m = meta || {};
  const type = String(m.type || '');

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
    provider_event_id: m.eventId || null,
    /* Stripe's own type, kept for the ledger so an operator can see what
       arrived without needing this file to have named it. A pulled
       reconciliation says so rather than borrowing an event name it never saw. */
    stripe_type: type || 'reconcile',
    occurred_at: m.occurredAt || null,
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
    period_start: secs(periodFieldOf(obj, 'current_period_start')),
    /* Paid-through, not invoiced-through. See paidThroughOf. */
    period_end: paidThroughOf(obj),
    /* What Stripe has raised an invoice for. NOT a stored column -- the
       subscriptions table holds one period end and it holds the paid one --
       but carried on the facts so a log line or a reconciliation response can
       show both numbers instead of leaving an operator wondering which one the
       row is. Never used to decide access. */
    invoiced_through: periodEndOf(obj),
    /* GRACE IS THE PROVIDER'S TO GIVE. Stated as null rather than omitted:
       Stripe's subscription object carries no retry deadline, so the web rail
       has no provider grace, and the honest record of that is an explicit
       nothing rather than a column nobody wrote. */
    grace_period_end: null,
    /* When the provider says the relationship actually ended, as distinct from
       cancel_at_period_end, which says it is going to. */
    cancelled_at: secs(obj.canceled_at),
    cancel_at_period_end: !!obj.cancel_at_period_end,
    /* Why it ended, in Stripe's own words, so an operator can tell a dispute
       from a request without this file having to name every value. */
    cancellation_reason: (obj.cancellation_details && obj.cancellation_details.reason) || null
  };
}

/* The webhook's entry point. Only subscription-bearing events reach the
   translation: an invoice or a charge tells us nothing the subscription object
   does not already say, and Stripe emits well over a hundred types that mean
   nothing to an entitlement.

   Returns null for everything else, which the endpoint answers 200 to. */
function normaliseEvent(stripeEvent){
  const ev = stripeEvent || {};
  const type = String(ev.type || '');
  if (!/^customer\.subscription\./.test(type)) return null;
  const obj = (ev.data && ev.data.object) || {};
  return subscriptionFacts(obj, {
    type: type,
    eventId: ev.id || null,
    occurredAt: ev.created ? new Date(Number(ev.created) * 1000).toISOString() : null
  });
}

module.exports = {
  API, PROVIDER, MAX_SKEW_SEC,
  config, encode, call, ensureCustomer, createCheckoutSession, priceFor, PROVIDER, CONDITION_OF,
  pauseCollection, resumeCollection,
  fetchCheckoutSession, fetchSubscription, cancelAtPeriodEnd, clearCancelAtPeriodEnd,
  parseSigHeader, verifySignature, normaliseEvent, subscriptionFacts, paidThroughOf,
  periodOf, periodEndOf, periodFieldOf, accountOf, offerOf, conditionOf, ref, log
};
