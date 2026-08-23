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
//     -> Apply.applySubscriptionFacts the shared core write: subscription,
//                                    agreed price, trial allowance, entitlement
//                                    projection, operational mirror -- the same
//                                    implementation the reconcile action uses
//     -> Store.markBillingEventProcessed  what the event actually did
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

const S = require('./_strava.js');     // canonical Supabase access layer
const P = require('./_stripe.js');
const Store = require('./_commercial-store.js');
const Apply = require('./_billing-apply.js');

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
 *   4. apply the facts through _billing-apply.js -- the SAME implementation the
 *      reconcile action uses, which is what keeps one commercial rule from
 *      becoming two
 *   5. record what the event actually did
 *
 * Step 2 before step 4 is what makes a replay free: the second delivery never
 * reaches the core at all.
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

  /* 3. EVERYTHING THE FACTS DO TO THE CORE, in the shared implementation.
   *
   * Subscription upsert, agreed price locked once, trial allowance spent once,
   * entitlement re-projected from the resolver, operational board mirrored.
   * The reconcile action in _subscription.js calls exactly this, with facts
   * PULLED from the provider instead of pushed by it -- one implementation, so
   * the two routes cannot disagree about whether an athlete has a trial left. */
  const applied = await Apply.applySubscriptionFacts(S, cfg, ev, {
    environment: stripe.environment
  });

  /* A subscription the provider now attributes to somebody else. Recorded and
     dropped with a 200: a 5xx would have Stripe redeliver it until it gave up,
     and redelivering it cannot make it attributable. */
  if (!applied.ok && applied.code === 'account_mismatch'){
    await Store.markBillingEventProcessed(S, cfg, {
      provider: P.PROVIDER, provider_event_id: ev.provider_event_id, result: 'account_mismatch'
    });
    log('STRIPE_ACCOUNT_MISMATCH id=' + P.ref(ev.provider_event_id));
    return S.json(res, 200, { ok: true, applied: false, reason: 'account_mismatch' });
  }

  if (!applied.ok){
    await Store.markBillingEventProcessed(S, cfg, {
      provider: P.PROVIDER, provider_event_id: ev.provider_event_id,
      result: 'failed_' + (applied.reason || applied.code)
    });
    log('STRIPE_SUBSCRIPTION_WRITE_FAILED code=' + applied.code +
        ' reason=' + (applied.reason || '-'));
    /* 503 so Stripe retries: the event is claimed but explicitly marked failed,
       which is the recoverable state rather than a silent loss. */
    return S.json(res, 503, { error: 'unavailable', code: 'SUBSCRIPTION_UNWRITABLE' });
  }

  await Store.markBillingEventProcessed(S, cfg, {
    provider: P.PROVIDER, provider_event_id: ev.provider_event_id,
    account_id: ev.account_id,
    /* Reading up.id gave undefined on every event, so the ledger recorded which
       account paid but never which subscription it was for. */
    subscription_id: applied.subscriptionId,
    result: applied.entitlementSynced ? 'processed' : 'processed_entitlement_stale'
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
