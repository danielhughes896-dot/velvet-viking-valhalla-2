// Velvet Viking -- applying a provider's subscription facts to the commercial
// core. ONE implementation, used by every route those facts can arrive on.
//
// There are two, and there will always be two:
//
//   PUSHED   the provider posts a signed event to /api/billing-webhook. This is
//            the normal path and it is the only one that claims a row in the
//            billing_events ledger, because it is the only one with a provider
//            event id to claim.
//   PULLED   the athlete's browser comes back from Checkout and asks the server
//            what happened, and the server ASKS THE PROVIDER. See
//            _subscription.js's reconcile action. A webhook can be queued
//            behind an outage or lost to a bad deployment, and the minute after
//            somebody pays is the worst minute in the product to be wrong in.
//
// WHY THEY SHARE THIS FILE. If reconciliation had its own copy of "write the
// subscription, lock the price, spend the trial, re-project the entitlement",
// then the two would drift, and the way they would drift is that one of them
// would spend a trial the other did not -- or grant access the other would not
// have. A second implementation of a commercial rule is a second commercial
// authority, which is the exact thing the architecture recovery removed.
//
// WHAT THIS FILE IS NOT
//   - it is not entitlement authority. It writes facts and then asks
//     Store.syncEntitlementRow() to re-derive the projection from them. It
//     never decides that anybody has access.
//   - it does not verify anybody. The webhook verifies a signature and the
//     reconcile action verifies a bearer token AND that the subscription's own
//     metadata names that athlete. By the time facts reach here, who they
//     belong to has already been established.
//   - it does not know Stripe exists. It takes the provider-neutral facts
//     _stripe.js produces, and Apple and Google will produce the same shape.
//
// IDEMPOTENT BY CONSTRUCTION, not by care. Every write below is safe to repeat:
// the subscription upserts on (provider, provider_subscription_id), the agreed
// price is written under a price_locked_at IS NULL filter, and the trial
// allowance is spent under a trial_consumed_at IS NULL filter. Running this
// twice for the same facts changes nothing the first run did not already do.

'use strict';

const Prod = require('./_products.js');
const Store = require('./_commercial-store.js');
const E = require('./_entitlement.js');
const Ops = require('./_monday-operational.js');

function log(what){ try{ console.log('billing-apply: ' + what); }catch(e){} }
function ref(v){ return v ? String(v).slice(0, 8) + '…' : '-'; }

/* THE TRIAL ALLOWANCE IS SPENT HERE, AND ONLY HERE.
 *
 * Stamped when a provider tells us a TRIALING subscription exists -- never when
 * somebody opens Checkout. An athlete who reaches the payment screen and
 * changes their mind has not used their trial, and a design that charged them
 * for that decision would be indefensible.
 *
 * THE FILTER IS THE MECHANISM. `trial_consumed_at=is.null` is what makes this
 * one-per-athlete under every route the brief names -- a redelivered webhook, a
 * reconcile racing that webhook, two browser tabs, a second checkout after
 * cancelling, a monthly-to-annual switch, a reinstall on another device. Every
 * one of them arrives here, and every one of them finds the column already
 * written and matches zero rows. A read-then-write in JavaScript would let two
 * of them both see "unused"; the database sees both and lets one win.
 *
 * NEVER RESET. There is deliberately no code path anywhere in this repository
 * that clears trial_consumed_at. A trial you can reset is a trial you can farm.
 */
async function consumeTrialIfTrialing(S, cfg, facts, subscriptionId){
  if (facts.condition !== 'trialing') return { attempted: false, consumed: false, reason: 'not_a_trial' };

  /* Delegated to the store rather than re-written here, and that is the point
     of this pass. The webhook used to issue its own PATCH against
     account_commercial while Store.consumeTrialForAccount -- the canonical
     implementation, with its own tests, its own race-lost logging and its own
     idempotency reporting -- sat unused beside it. Two conditional writes
     against one column are two trial rules however identical they look on the
     day they are written.

     `now` is the provider's own clock: when the trial started according to the
     provider, falling back to when the event happened. Not our clock, because a
     redelivery three hours late must not stamp an allowance three hours late. */
  const r = await Store.consumeTrialForAccount(S, cfg, facts.account_id, {
    provider: facts.provider,
    subscriptionId: subscriptionId || null,
    now: E.asDate(facts.trial_start) || E.asDate(facts.occurred_at) || new Date()
  });
  return {
    attempted: true,
    consumed: !!r.consumed,
    /* 'already_used' is the ordinary, correct outcome of a second telling. It
       is not an error and must not be reported as one -- the athlete has a
       trial, they have exactly one, and this delivery found it already spent. */
    reason: r.reason || (r.ok ? 'unchanged' : 'write_failed')
  };
}

/* Everything a set of verified provider facts does to the core, in the order it
   has to happen. Returns a report rather than throwing: the webhook turns a
   failure into a 503 the provider will retry, and reconcile turns it into an
   honest "not yet" for the browser. */
async function applySubscriptionFacts(S, cfg, facts, opts){
  const o = opts || {};
  const f = facts || {};

  if (!f.account_id || !f.subscription_ref){
    return { ok: false, code: 'unattributable' };
  }

  /* The account_commercial row is where the trial allowance lives. Checkout
     creates it, but a subscription can reach us for an account that never went
     through our own checkout -- created in the Stripe dashboard, migrated, or
     recovered after a failure -- and the allowance must have somewhere to be
     recorded before it can be spent. Idempotent. */
  await Store.ensureAccountCommercial(S, cfg, f.account_id);

  const up = await Store.upsertSubscription(S, cfg, {
    provider: f.provider,
    provider_subscription_id: f.subscription_ref,
    account_id: f.account_id,
    environment: o.environment || 'production',
    condition: f.condition,
    /* THE PRODUCT CODE IS THE CATALOGUE'S, NOT A LITERAL. This once read
       'STANDARD' -- close enough to look right in review, and rejected by the
       store's own validation as an unknown product, so every subscription
       failed to write and every delivery got a 503 the provider retried until
       it gave up. A constant nobody can mistype is the fix. */
    product_code: Prod.STANDARD,
    offer_code: f.offer_code,
    billing_period: f.billing_period,
    trial_start: f.trial_start,
    trial_end: f.trial_end,
    current_period_start: f.period_start,
    current_period_end: f.period_end,
    /* PROVIDER GRACE ONLY, AND WRITTEN EXPLICITLY. The adapter says what the
       provider gave; where a provider gives nothing this is null, and a
       past_due row with no provider grace grants nothing. Valhalla adds no
       days of its own -- that rule was bought with the removal of a second
       commercial brain and it is not being re-learned. */
    grace_period_end: f.grace_period_end == null ? null : f.grace_period_end,
    cancelled_at: f.cancelled_at,
    cancel_at_period_end: !!f.cancel_at_period_end,
    auto_renew: !f.cancel_at_period_end,
    provider_customer_id: f.customer_ref,
    provider_updated_at: f.occurred_at
  });
  if (!up.ok) return { ok: false, code: 'subscription_unwritable', reason: up.reason };

  /* THE AGREEMENT, LOCKED ONCE. Deliberately not part of the upsert: that
     merges every column it is handed on every delivery, so an agreed price
     riding a routine renewal would be rewritten from whatever the catalogue
     says today -- a founding subscriber's price quietly becoming the new one,
     through the single event nobody inspects.

     Not fatal if it fails. The athlete has access either way and the next event
     locks it; refusing a subscription over its footnote would be the wrong
     trade. */
  const lock = await Store.lockAgreedPrice(S, cfg, {
    provider: f.provider,
    provider_subscription_id: f.subscription_ref,
    offer_code: f.offer_code,
    at: f.trial_start || f.occurred_at
  });
  if (!lock.ok) log('AGREEMENT_NOT_LOCKED reason=' + lock.reason);

  const trial = await consumeTrialIfTrialing(S, cfg, f,
                        (up.subscription && up.subscription.id) || null);

  /* Re-derive access from the canonical facts. Never computed here, and never
     written directly onto the projection. */
  const sync = await Store.syncEntitlementRow(S, cfg, f.account_id);

  /* MIRROR IT TO THE OPERATIONAL BOARD, after the writes and never instead of
     them. OFF unless VVV_MONDAY_OPERATIONAL says otherwise, never throws, and
     its failure is logged and ignored: a mirror being late is not a reason to
     fail a purchase. */
  try{
    const mirrored = await Ops.syncAccountFromStore(S, Store, E, cfg, f.account_id);
    if (!mirrored.ok && mirrored.code !== 'operational_sync_disabled'){
      log('OPS_MIRROR_FAILED code=' + mirrored.code);
    }
  }catch(e){ log('OPS_MIRROR_THREW'); }

  log('APPLIED condition=' + f.condition + ' account=' + ref(f.account_id) +
      ' trial=' + (trial.reason || 'n/a'));

  return {
    ok: true,
    code: 'applied',
    condition: f.condition,
    subscriptionId: (up.subscription && up.subscription.id) || null,
    trial: trial,
    entitlementSynced: !!(sync && sync.ok)
  };
}

module.exports = { applySubscriptionFacts, consumeTrialIfTrialing };
