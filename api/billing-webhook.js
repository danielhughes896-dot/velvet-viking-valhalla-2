// Velvet Viking -- Phase 3A2: the payment-provider webhook.
//
//   POST /api/billing-webhook
//     x-vvv-billing-timestamp: <unix seconds>
//     x-vvv-billing-signature: <hex HMAC-SHA256 of "<timestamp>.<raw body>">
//
// PROVIDER-AGNOSTIC ON PURPOSE. No provider's SDK, no provider's event names,
// no provider's signature scheme inside the application. The adapter that
// translates a real provider into the shape below is the ONLY thing that has
// to change when a provider is chosen, and it lives at the top of this file
// where it can be read in one screen. Everything after normalisation is
// _billing.js, which is pure and fully tested.
//
// WHAT THIS ENDPOINT WILL NOT DO
//   - trust an unsigned request. If the secret is not configured the endpoint
//     answers 503. "No secret set" must never mean "accept everything", which
//     is the direction that mistake usually fails in.
//   - trust a request body about WHO it concerns beyond the subject id, which
//     is matched against a real entitlements row.
//   - answer 500 to a duplicate. A provider treats 5xx as "try again", so an
//     endpoint that errors on a replay receives that replay until it gives up.
//     Already-applied is a 200 with applied:false.
//   - write an override. Billing owns nine columns and no others.
//   - log an email address, a signature, a secret, or a full provider id.
//
// INERT UNTIL ACTIVATED. Nothing here runs unless a provider is configured and
// pointed at it, and nothing it writes has any effect on access until
// VVV_COMMERCIAL_REQUIRED is switched on. Both are deliberate: the machinery
// is deployable, testable and reversible before it is load-bearing.

const crypto = require('crypto');
const S = require('./_strava.js');     // canonical Supabase access layer
const A = require('./_access.js');
const B = require('./_billing.js');
const P = require('./_stripe.js');
const Prod = require('./_products.js');
const Store = require('./_commercial-store.js');
const E = require('./_entitlement.js');
const Ops = require('./_monday-operational.js');

const STRIPE_SIG_HEADER = 'stripe-signature';

const SIGNATURE_HEADER = 'x-vvv-billing-signature';
const TIMESTAMP_HEADER = 'x-vvv-billing-timestamp';
/* Five minutes. Long enough for a provider retry that queued behind an
   outage, short enough that a request captured off the wire is useless by the
   time anyone replays it. */
const MAX_SKEW_SEC = 5 * 60;

function log(what){ try{ console.log('billing: ' + what); }catch(e){} }
/* Provider ids are not secrets but they are somebody's customer reference.
   Enough of one to correlate a log line, never enough to be one. */
function ref(v){ return v ? String(v).slice(0, 8) + '…' : '-'; }

/* ---------- the adapter ----------
   A real provider's payload arrives with its own vocabulary. This is the one
   place that knows any of it. It knows two shapes now: Velvet Viking's own,
   and Stripe's -- and Stripe's is not decoded here, it is decoded in
   _stripe.js. Adding Apple or Google means adding a branch and an adapter
   module, and touching nothing downstream.

   WHICH ADAPTER, decided by the request rather than by sniffing the body: a
   Stripe delivery carries a `stripe-signature` header, and a body-shape guess
   would be a way for a forged payload to choose its own verifier. */
function normaliseEvent(body){
  const b = body || {};
  const ev = {
    type: b.type || null,
    user_id: b.user_id || null,
    seq: b.seq == null ? null : Number(b.seq),
    occurred_at: b.occurred_at || null,
    period_end: b.period_end || null,
    tier: b.tier || null,
    provider: b.provider || 'manual',
    customer_id: b.customer_id || null,
    sub_id: b.sub_id || null
  };
  return ev;
}
function normaliseSnapshot(body){
  const b = body || {};
  return {
    user_id: b.user_id || null,
    state: b.state || null,
    access_until: b.access_until || null,
    cancel_at_period_end: !!b.cancel_at_period_end,
    tier: b.tier || null,
    provider: b.provider || 'manual',
    customer_id: b.customer_id || null,
    sub_id: b.sub_id || null,
    as_of: b.as_of || null
  };
}

/* ---------- signature ----------
   HMAC over "<timestamp>.<raw body>" rather than over the body alone, so a
   valid signature cannot be lifted from one request and replayed on a later
   one with a fresh timestamp. Compared in constant time; length-checked first
   because timingSafeEqual throws on a mismatch, and throwing on a wrong length
   would itself leak the length. */
function verifySignature(rawBody, timestamp, signature, secret, nowSec){
  if (!secret) return { ok: false, reason: 'not_configured' };
  if (!signature || !timestamp) return { ok: false, reason: 'unsigned' };
  const ts = Number(timestamp);
  if (!isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowSec - ts) > MAX_SKEW_SEC) return { ok: false, reason: 'stale_timestamp' };

  const expected = crypto.createHmac('sha256', secret)
    .update(String(timestamp) + '.' + rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature).trim().toLowerCase(), 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'bad_signature' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, reason: 'verified' };
}

/* Vercel parses JSON bodies before a handler sees them, which destroys the
   bytes a signature was computed over. req.rawBody is preferred when the
   platform preserves it; the deterministic re-serialisation is the fallback
   and is why the adapter above is the only thing allowed to reshape a body. */
function rawBodyOf(req){
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  try{ return JSON.stringify(req.body == null ? {} : req.body); }catch(e){ return ''; }
}


/* ---------- the Stripe boundary ----------
 *
 * Order is the design and it is deliberate:
 *   1. verify the signature, before the body is trusted for anything at all
 *   2. CLAIM the event, so a duplicate delivery stops here
 *   3. translate to our vocabulary; an untranslatable event is recorded and
 *      dropped rather than guessed at
 *   4. apply through the existing pure reducer -- the same one the generic
 *      provider uses, which is what keeps Stripe out of the access model
 *   5. record what the event actually did
 *
 * Step 2 before step 4 is what makes a replay free: the second delivery never
 * reaches the reducer.
 */
async function handleStripe(req, res, cfg){
  const stripe = P.config();
  if (!stripe.hasWebhookSecret){
    log('STRIPE_NOT_CONFIGURED');
    return S.json(res, 503, { error: 'unavailable', code: 'STRIPE_NOT_CONFIGURED' });
  }
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const raw = rawBodyOf(req);
  const check = P.verifySignature(raw, req.headers[STRIPE_SIG_HEADER],
                                  stripe.webhookSecret(), Math.floor(Date.now() / 1000));
  if (!check.ok){
    log('STRIPE_REJECTED reason=' + check.reason);
    return S.json(res, 401, { error: 'not_authenticated', code: 'BAD_SIGNATURE' });
  }

  let parsed = null;
  try{ parsed = JSON.parse(raw); }catch(e){ parsed = null; }
  if (!parsed || !parsed.id) return S.json(res, 400, { error: 'bad_request', code: 'NO_EVENT' });

  const ev = P.normaliseEvent(parsed);
  if (!ev){
    /* Stripe emits well over a hundred event types and most mean nothing to a
       subscription. 200 is correct: received, understood to be irrelevant. A
       non-2xx would have Stripe retry it forever. */
    log('STRIPE_IGNORED type=' + String(parsed.type).slice(0, 40));
    return S.json(res, 200, { ok: true, applied: false, reason: 'not_entitlement_relevant' });
  }

  /* 1. CLAIM FIRST. The unique index on (provider, provider_event_id) is what
        makes this safe under concurrent delivery: two simultaneous copies both
        attempt the insert and exactly one wins. A read-then-write would let
        both pass. */
  const claim = await Store.claimBillingEvent(S, cfg, {
    provider: P.PROVIDER,
    provider_event_id: ev.provider_event_id,
    event_type: ev.stripe_type || null,
    account_id: ev.account_id || null,
    environment: stripe.environment
  });
  if (!claim.ok && !claim.duplicate){
    log('STRIPE_CLAIM_FAILED id=' + P.ref(ev.provider_event_id) + ' reason=' + claim.reason);
    return S.json(res, 503, { error: 'unavailable', code: 'LEDGER_UNAVAILABLE' });
  }
  if (claim.duplicate){
    /* 200, never 5xx. A provider reads 5xx as "try again", so erroring on a
       replay guarantees receiving that replay until the provider gives up. */
    log('STRIPE_DUPLICATE id=' + P.ref(ev.provider_event_id));
    return S.json(res, 200, { ok: true, applied: false, reason: 'already_applied' });
  }

  /* 2. FAIL CLOSED ON AN UNKNOWN ACCOUNT. A subscription we cannot attribute
        must not silently create or move one. */
  if (!ev.account_id || !ev.subscription_ref){
    await Store.markBillingEventProcessed(S, cfg, {
      provider: P.PROVIDER, provider_event_id: ev.provider_event_id, result: 'unattributable'
    });
    log('STRIPE_UNATTRIBUTABLE id=' + P.ref(ev.provider_event_id));
    return S.json(res, 200, { ok: true, applied: false, reason: 'unattributable' });
  }

  /* 3. The subscription row, upserted on (provider, provider_subscription_id).
        Same constraint, same reason: one provider subscription belongs to one
        account, enforced by the database rather than by application care. */
  const up = await Store.upsertSubscription(S, cfg, {
    provider: P.PROVIDER,
    provider_subscription_id: ev.subscription_ref,
    account_id: ev.account_id,
    environment: stripe.environment,
    condition: ev.condition,
    /* THE PRODUCT CODE IS THE CATALOGUE'S, NOT A LITERAL. This read 'STANDARD'
       -- close enough to look right in review, and rejected by the store's
       own validation as an unknown product, so every Stripe subscription
       failed to write and every delivery got a 503 Stripe would retry until it
       gave up. A constant nobody can mistype is the fix, not a corrected
       literal that can drift again. */
    product_code: Prod.STANDARD,
    offer_code: ev.offer_code,
    billing_period: ev.billing_period,
    trial_start: ev.trial_start,
    trial_end: ev.trial_end,
    current_period_start: ev.period_start,
    current_period_end: ev.period_end,
    cancelled_at: ev.cancelled_at,
    cancel_at_period_end: !!ev.cancel_at_period_end,
    auto_renew: !ev.cancel_at_period_end,
    provider_customer_id: ev.customer_ref,
    provider_updated_at: ev.occurred_at
  });
  if (!up.ok){
    await Store.markBillingEventProcessed(S, cfg, {
      provider: P.PROVIDER, provider_event_id: ev.provider_event_id, result: 'failed_' + up.reason
    });
    log('STRIPE_SUBSCRIPTION_WRITE_FAILED reason=' + up.reason);
    /* 503 so Stripe retries: the event is claimed but explicitly marked failed,
       which is the recoverable state rather than a silent loss. */
    return S.json(res, 503, { error: 'unavailable', code: 'SUBSCRIPTION_UNWRITABLE' });
  }

  /* 3b. THE AGREEMENT, LOCKED ONCE.
   *
   * Deliberately NOT part of the upsert above. That merges every column it is
   * handed on every delivery, so an agreed price riding a routine renewal
   * would be rewritten from whatever the catalogue says today -- a founding
   * subscriber's price quietly becoming the new one, through the single event
   * nobody inspects. The store writes it under a price_locked_at IS NULL
   * filter instead, so the database decides whether this is the first telling.
   *
   * Not fatal if it fails. The athlete has access either way, and the next
   * event locks it; refusing the whole delivery over a price record would be
   * refusing the subscription over its footnote. */
  const lock = await Store.lockAgreedPrice(S, cfg, {
    provider: P.PROVIDER,
    provider_subscription_id: ev.subscription_ref,
    offer_code: ev.offer_code,
    at: ev.trial_start || ev.occurred_at
  });
  if (!lock.ok) log('STRIPE_AGREEMENT_NOT_LOCKED reason=' + lock.reason);

  /* 4. THE TRIAL ALLOWANCE IS SPENT HERE, AND ONLY HERE.
   *
   * Stamped when a provider tells us a trialing subscription EXISTS -- never
   * when somebody opens Checkout. An athlete who reaches the payment screen and
   * changes their mind has not used their trial, and a design that charged them
   * for that decision would be indefensible.
   *
   * Conditional on trial_consumed_at being null, so a webhook replay or a
   * second trialing event cannot move the timestamp forward and quietly extend
   * the lifetime rule's reference point. */
  if (ev.condition === 'trialing'){
    await S.sb(cfg, '/account_commercial?account_id=eq.' +
      encodeURIComponent(ev.account_id) + '&trial_consumed_at=is.null', {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({
          trial_consumed_at: ev.trial_start || ev.occurred_at || new Date().toISOString(),
          trial_consumed_provider: P.PROVIDER,
          updated_at: new Date().toISOString()
        })
      });
  }

  /* 5. Re-derive access from the canonical facts. Never computed here. */
  const sync = await Store.syncEntitlementRow(S, cfg, ev.account_id);

  /* 6. MIRROR IT TO THE OPERATIONAL BOARD.
   *
   * After the ledger, not before, and after the entitlement, not instead of:
   * the board shows what the database says once the writes have landed. It is
   * OFF unless VVV_MONDAY_OPERATIONAL says otherwise, it never throws, and its
   * failure is logged and ignored. A mirror being late is not a reason to fail
   * a purchase -- and a 503 here would have Stripe redeliver an event that has
   * already been applied. */
  try{
    const mirrored = await Ops.syncAccountFromStore(S, Store, E, cfg, ev.account_id);
    if (!mirrored.ok && mirrored.code !== 'operational_sync_disabled'){
      log('OPS_MIRROR_FAILED code=' + mirrored.code);
    }
  }catch(e){ log('OPS_MIRROR_THREW'); }

  await Store.markBillingEventProcessed(S, cfg, {
    provider: P.PROVIDER, provider_event_id: ev.provider_event_id,
    account_id: ev.account_id,
    /* upsertSubscription returns { ok, subscription }. Reading up.id gave
       undefined on every event, so the ledger recorded which account paid but
       never which subscription it was for. */
    subscription_id: (up.subscription && up.subscription.id) || null,
    result: sync && sync.ok ? 'processed' : 'processed_entitlement_stale'
  });

  log('STRIPE_APPLIED condition=' + ev.condition + ' account=' + ref(ev.account_id));
  return S.json(res, 200, { ok: true, applied: true, condition: ev.condition });
}

module.exports = async function handler(req, res){
  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }
  const cfg = S.config();

  /* STRIPE DELIVERIES TAKE THE STRIPE PATH. Chosen on the header, not on the
     body: letting a payload's own shape select its verifier would let a forged
     body pick the verifier it can satisfy. */
  if (req.headers[STRIPE_SIG_HEADER]) return handleStripe(req, res, cfg);

  const secret = process.env.VVV_BILLING_WEBHOOK_SECRET || '';

  if (!secret){
    log('NOT_CONFIGURED');
    return S.json(res, 503, { error: 'unavailable', code: 'BILLING_NOT_CONFIGURED' });
  }
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const raw = rawBodyOf(req);
  /* `check` rather than `sig`: what this holds is the VERDICT, and its
     .reason is a classification -- unsigned, stale_timestamp, bad_signature --
     never any signature material. That distinction is what makes it safe to
     log, and naming it after the thing it is not would invite somebody to log
     the thing it is. */
  const check = verifySignature(raw, req.headers[TIMESTAMP_HEADER],
                                req.headers[SIGNATURE_HEADER], secret,
                                Math.floor(Date.now() / 1000));
  if (!check.ok){
    log('REJECTED reason=' + check.reason);
    return S.json(res, 401, { error: 'not_authenticated', code: 'BAD_SIGNATURE' });
  }

  const body = S.readBody(req);
  const isSnapshot = body && body.kind === 'snapshot';
  const subject = body && body.user_id;
  if (!subject) return S.json(res, 400, { error: 'bad_request', code: 'NO_SUBJECT' });

  const ent = await A.readEntitlement(S, cfg, subject);
  if (!ent.ok){
    /* The one place a 5xx is right: we could not read, so we do not know, so
       the provider SHOULD try again. */
    log('ENTITLEMENT_READ_FAILED user=' + ref(subject));
    return S.json(res, 503, { error: 'unavailable', code: 'ENTITLEMENT_UNREADABLE' });
  }

  const now = new Date();
  const before = ent.row;
  const result = isSnapshot
    ? B.reconcileEntitlement(before, normaliseSnapshot(body), now)
    : B.applyBillingEvent(before, normaliseEvent(body), now);

  if (!result.applied){
    log('NOOP reason=' + result.reason + ' user=' + ref(subject));
    return S.json(res, 200, { received: true, applied: false, reason: result.reason });
  }

  const patch = B.billingPatch(result.next);
  const write = before
    ? await S.sb(cfg, '/entitlements?user_id=eq.' + encodeURIComponent(subject),
        { method: 'PATCH', body: JSON.stringify(patch) })
    : await S.sb(cfg, '/entitlements',
        { method: 'POST', body: JSON.stringify(Object.assign({ user_id: subject }, patch)) });

  if (!write.ok){
    log('WRITE_FAILED status=' + write.status + ' user=' + ref(subject));
    return S.json(res, 503, { error: 'unavailable', code: 'ENTITLEMENT_UNWRITABLE' });
  }

  /* Access just ended. The lease is the credential that actually delivers the
     runtime, so it is killed here rather than left to expire -- otherwise
     "revoked" means "revoked within twelve hours", which is not what the word
     means. Failure to revoke is logged and not fatal: the entitlement is
     already written, so the next revalidation refuses anyway. */
  if (B.endsAccessNow(before, result.next, now)){
    try{
      await A.revokeLeasesForUser(S, cfg, subject);
      log('LEASES_REVOKED user=' + ref(subject));
    }catch(e){ log('LEASE_REVOKE_FAILED user=' + ref(subject)); }
  }

  log('APPLIED reason=' + result.reason + ' state=' + result.next.state + ' user=' + ref(subject));
  return S.json(res, 200, { received: true, applied: true, reason: result.reason });
};

module.exports.verifySignature = verifySignature;
module.exports.normaliseEvent = normaliseEvent;
module.exports.normaliseSnapshot = normaliseSnapshot;
module.exports.rawBodyOf = rawBodyOf;
module.exports.SIGNATURE_HEADER = SIGNATURE_HEADER;
module.exports.TIMESTAMP_HEADER = TIMESTAMP_HEADER;
module.exports.MAX_SKEW_SEC = MAX_SKEW_SEC;
