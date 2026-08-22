// Velvet Viking -- the payment-provider webhook.
//
//   POST /api/billing-webhook
//     stripe-signature: <Stripe's own scheme, verified by _stripe.js>
//
// ONE DOOR, AND IT LEADS TO THE CORE. Stripe is an ADAPTER: it verifies its own
// signature, translates its vocabulary into a provider-neutral event, and hands
// that to the commercial core. It is not entitlement authority and it never
// writes the projection the runtime reads.
//
// The flow, in the order it happens:
//
//   verified Stripe event
//     -> P.normaliseEvent            provider vocabulary leaves here
//     -> Store.claimBillingEvent     the ONE ledger, public.billing_events,
//                                    which is also the idempotency mechanism
//     -> Store.upsertSubscription    provider-neutral subscription state
//     -> trial consumption           only on a verified activation, and only
//                                    where trial_consumed_at is still null
//     -> Store.syncEntitlementRow    resolver -> projection, one way
//     -> operational mirror          after the writes, never instead of them
//
// A SECOND PATH USED TO LIVE HERE and has been removed. It accepted a generic
// signed payload, ran _billing.js's state machine and PATCHED public
// .entitlements directly -- a second source of commercial truth that could
// contradict the subscriptions and grants behind it, and which invented seven
// days of grace on a failed payment. The approved rule is provider grace only.
// See the refusal at the bottom of this file. Apple and Google will arrive the
// same way Stripe did: as adapters feeding this core.
//
// WHAT THIS ENDPOINT WILL NOT DO
//   - trust an unsigned or unverifiable delivery;
//   - answer 500 to a duplicate. A provider treats 5xx as "try again", so an
//     endpoint that errors on a replay receives that replay until it gives up.
//     Already-applied is a 200;
//   - write an override, or any column the core does not own;
//   - log an email address, a signature, a secret, or a full provider id.
//
// INERT UNTIL ACTIVATED. Nothing it writes affects access until
// VVV_COMMERCIAL_REQUIRED is switched on, and no checkout exists to create a
// subscription until VVV_COMMERCE_ENABLED is.

const crypto = require('crypto');
const S = require('./_strava.js');     // canonical Supabase access layer
const A = require('./_access.js');
const P = require('./_stripe.js');
const Prod = require('./_products.js');
const Store = require('./_commercial-store.js');
const E = require('./_entitlement.js');
const Ops = require('./_monday-operational.js');

const STRIPE_SIG_HEADER = 'stripe-signature';


function log(what){ try{ console.log('billing: ' + what); }catch(e){} }
/* Eight characters and an ellipsis. Enough to correlate two log lines about the
   same athlete, not enough to be an identifier. */
function ref(v){ return v ? String(v).slice(0, 8) + '…' : '-'; }


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

  /* EVERYTHING ELSE IS REFUSED, and this is the second commercial brain being
     switched off rather than merely discouraged.

     What used to live here was a generic provider path: it verified its own
     HMAC, normalised into _billing.js's event vocabulary, ran a state machine,
     and PATCHED public.entitlements directly. That made it a second source of
     commercial truth, and the two disagreed in a way that mattered --

       it wrote `state` and `access_until` straight onto the row that
       _access.js reads, bypassing resolveStandardEntitlement() entirely, so
       the projection could say something the subscriptions and grants behind
       it did not;

       and it invented SEVEN DAYS of grace on a failed payment. The approved
       rule is provider grace only: whatever grace_period_end the provider
       supplies, and nothing on top. An athlete whose card failed got a free
       training week from a constant in our own source.

     The generic path has no future either. Apple and Google will arrive as
     ADAPTERS feeding the same provider-neutral core the Stripe path already
     feeds -- account_commercial, subscriptions, entitlement_grants and the one
     billing_events ledger. A second endpoint shape that writes the projection
     directly is not a head start on them; it is the thing they would have to
     be untangled from.

     Fail closed, and say which door to use. */
  log('REFUSED reason=non_stripe_delivery');
  return S.json(res, 501, { error: 'not_implemented', code: 'PROVIDER_NOT_SUPPORTED' });
};

module.exports.rawBodyOf = rawBodyOf;
