// Velvet Viking -- a Google Play purchase, from "may I buy" to the core.
//
//   prepare()   before the Play purchase sheet opens: may this athlete buy, may
//               the purchase include the free trial, and the opaque id Play
//               must carry so the purchase can be tied back to them.
//   admit()     after Google says a purchase exists: whose is it, may it stand,
//               then the SAME core write the web rail uses, then the
//               acknowledgement that tells Google to keep it.
//
// Two routes reach admit(), exactly as two reach the web rail's apply:
//
//   PULLED   the app hands the server a purchase token (POST /api/subscription
//            {action:'google_verify'}), with the athlete's own access token.
//   PUSHED   Google's Real-time developer notification, through
//            /api/billing-webhook?rail=google, verified by its Pub/Sub token.
//
// Both re-read the purchase from Google, both go through this file, and both
// end in _billing-apply.js. A second copy of "write the subscription, spend the
// trial, re-project the entitlement" would be a second commercial authority.
//
// THE RULES ARE THE CORE'S, NOT THIS FILE'S. Who has access is
// _entitlement.js's resolution over the rows, unchanged. One live subscription
// per athlete is E.mayStartStandardPurchase(), unchanged. One trial per
// athlete is the account_commercial allowance, spent by _billing-apply.js the
// same way the web rail spends it. What is particular to Play is only WHEN the
// rules can be applied: Play takes the money on the phone, so the server's
// refusal is to NOT ACKNOWLEDGE, and Google refunds an unacknowledged purchase
// after three days.

'use strict';

const G = require('./_google.js');
const A = require('./_access.js');
const E = require('./_entitlement.js');
const Prod = require('./_products.js');
const Store = require('./_commercial-store.js');
const Apply = require('./_billing-apply.js');
const Agree = require('./_agreements.js');
const Checkout = require('./_checkout.js');

function log(what){ try{ console.log('google-purchase: ' + what); }catch(e){} }

/* The conditions in which a Play subscription is, or is trying to be, a live
   relationship: the ones an acknowledgement is for, and the ones the
   one-subscription and one-trial rules have to be asked about. */
const LIVE = ['trialing', 'active', 'cancelled', 'past_due'];

// ===========================================================================
// BEFORE THE PURCHASE
// ===========================================================================

/* THE DECISION, AS A PURE FUNCTION, in the order _checkout.js asks the same
   questions for the web rail, so the two rails refuse for the same reasons with
   the same codes. */
function decidePrepare(o){
  const x = o || {};
  if (!x.commerceEnabled) return { allowed: false, reason: 'commerce_disabled' };
  if (!x.providerConfigured) return { allowed: false, reason: 'provider_not_configured' };
  if (!x.uid) return { allowed: false, reason: 'not_signed_in' };
  const country = String(x.country == null ? '' : x.country).trim().toUpperCase();
  if (!country) return { allowed: false, reason: 'country_unavailable' };
  if (!Checkout.countrySupported(country)) return { allowed: false, reason: 'country_not_supported' };
  /* THE SAME LEGAL EVIDENCE THE WEB CHECKOUT DEMANDS, before Play is asked to
     take any money: acceptance of the Terms in force and the immediate-start
     acknowledgement, both recorded by the existing agreement mechanism. */
  if (x.evidence && x.evidence.ok !== true){
    return { allowed: false, reason: (x.evidence && x.evidence.reason) || 'agreements_not_recorded' };
  }
  if (!x.purchaseCheck || x.purchaseCheck.allowed !== true){
    return { allowed: false, reason: (x.purchaseCheck && x.purchaseCheck.reason) || 'purchase_not_permitted',
             existingProvider: (x.purchaseCheck && x.purchaseCheck.existingProvider) || null };
  }
  return { allowed: true, reason: 'ok' };
}

/* What the Play store build needs before it opens Google's purchase sheet.
   Read-only: nothing is written, no trial is spent, nothing is reserved. */
async function prepare(S, cfg, uid, req){
  const gcfg = G.config();
  const facts = await Store.readCommercialFacts(S, cfg, uid);
  const purchaseCheck = facts.ok
    ? E.mayStartStandardPurchase({ account: facts.account, subscriptions: facts.subscriptions,
                                   provider: G.PROVIDER, now: new Date() })
    : { allowed: false, reason: 'unavailable', trial: null };
  const evidence = await Agree.purchaseEvidence(cfg, S.sb, uid);

  const decision = decidePrepare({
    commerceEnabled: A.commerceEnabled(),
    providerConfigured: gcfg.ok,
    uid: uid,
    country: Checkout.countryOf(req),
    evidence: evidence,
    purchaseCheck: purchaseCheck
  });
  if (!gcfg.ok) log('NOT_CONFIGURED missing=' + gcfg.missing.join(','));

  /* THE TRIAL VERDICT IS OURS, NOT GOOGLE'S. Play offers a free trial to a
     Google account that has not had one; SACORO allows one per ATHLETE across
     every rail. The app offers Play's trial only when this says yes. */
  const trial = purchaseCheck && purchaseCheck.trial;
  const plans = {};
  Object.keys(gcfg.offers).forEach(function(code){
    plans[gcfg.offers[code].billingPeriod] = gcfg.offers[code].basePlanId;
  });

  return {
    commerce_enabled: A.commerceEnabled(),
    provider_configured: gcfg.ok,
    purchase_allowed: decision.allowed,
    reason: decision.reason,
    existing_provider: decision.existingProvider || null,
    /* Present only when the purchase may go ahead: an id for a purchase that
       cannot be made is an id with no use. */
    obfuscated_account_id: (decision.allowed && gcfg.hasAccountIdSecret)
      ? G.obfuscatedAccountId(uid, gcfg.accountIdSecret()) : null,
    product_id: gcfg.ok ? gcfg.productId : null,
    base_plans: gcfg.ok ? plans : {},
    trial_eligible: !!(trial && trial.eligible),
    trial_days: Prod.TRIAL_DAYS,
    agreements: Agree.currentAgreements(),
    agreements_outstanding: evidence
      ? { terms: !evidence.terms, immediate_start: !evidence.immediateStart,
          commercial_legal_published: evidence.published !== false }
      : null
  };
}

// ===========================================================================
// AFTER THE PURCHASE
// ===========================================================================

/* WHOSE PURCHASE IS THIS?
 *
 * In order, and the first that applies decides:
 *   1. a row we already hold for this token: its account, for ever (a purchase
 *      never changes hands -- _commercial-store.js enforces the same);
 *   2. the athlete asking (the verify route), ONLY IF the obfuscated id Google
 *      echoes back is the one this server derives for them;
 *   3. the purchase this one replaced (linkedPurchaseToken: a plan change or a
 *      resubscribe from the app) or, for a resubscribe made in the Play Store,
 *      the expired purchase Google names -- Google's own statement of
 *      continuity, accepted when we hold that earlier purchase and any
 *      obfuscated id present agrees with its owner.
 * Anything else is unattributable and is not acknowledged. */
async function ownerOf(S, cfg, gcfg, facts, token, uid){
  const secret = gcfg.accountIdSecret();
  const matches = function(account, id){ return !!id && G.sameObfuscatedId(id, G.obfuscatedAccountId(account, secret)); };

  const own = await Store.ownerOfExisting(S, cfg, G.PROVIDER, token);
  if (!own.ok) return { ok: false, code: 'unavailable' };
  if (own.accountId){
    /* The token's owner was settled when it was first admitted, against the
       obfuscated id of that day. It is not re-derived here, so the record of
       a purchase can never be lost to a change of the id secret. */
    if (uid && own.accountId !== uid) return { ok: false, code: 'not_your_purchase' };
    return { ok: true, accountId: own.accountId, known: true };
  }

  if (uid){
    if (!matches(uid, facts.obfuscated_account_id)) return { ok: false, code: 'not_your_purchase' };
    return { ok: true, accountId: uid, known: false };
  }

  const earlier = [facts.linked_purchase_token, facts.expired_purchase_token].filter(Boolean);
  for (let i = 0; i < earlier.length; i++){
    const prev = await Store.ownerOfExisting(S, cfg, G.PROVIDER, earlier[i]);
    if (!prev.ok) return { ok: false, code: 'unavailable' };
    if (!prev.accountId) continue;
    const named = facts.obfuscated_account_id || facts.expired_obfuscated_account_id;
    if (named && !matches(prev.accountId, named)) return { ok: false, code: 'account_mismatch' };
    return { ok: true, accountId: prev.accountId, known: false };
  }
  return { ok: false, code: 'unattributable' };
}

/* MAY A PURCHASE WE HAVE NOT SEEN BEFORE STAND?
 *
 * The two rules SACORO keeps across every rail, asked through the existing
 * functions and nothing new:
 *   one live subscription   E.mayStartStandardPurchase(), with this purchase
 *                           and the purchase it replaced left out of the
 *                           count -- they are the same relationship, not a
 *                           second one;
 *   one trial               the allowance on account_commercial. A Play trial
 *                           for an athlete who has already had one, on any
 *                           rail, is refused.
 * A purchase that is no longer live (expired, revoked) asks nothing: recording
 * an ended purchase grants nothing and takes nothing. */
async function admissible(S, cfg, facts, accountId, token){
  if (LIVE.indexOf(facts.condition) === -1) return { ok: true };
  const commercial = await Store.readCommercialFacts(S, cfg, accountId);
  if (!commercial.ok) return { ok: false, code: 'unavailable' };
  const same = [token, facts.linked_purchase_token, facts.expired_purchase_token].filter(Boolean);
  const others = (commercial.subscriptions || []).filter(function(s){
    return !(s.provider === G.PROVIDER && same.indexOf(s.provider_subscription_id) !== -1);
  });
  const check = E.mayStartStandardPurchase({
    account: commercial.account, subscriptions: others, provider: G.PROVIDER,
    offerCode: facts.offer_code, now: new Date()
  });
  if (!check.allowed) return { ok: false, code: check.reason, existingProvider: check.existingProvider || null };
  if (facts.condition === 'trialing' && !(check.trial && check.trial.eligible)){
    return { ok: false, code: 'trial_already_used' };
  }
  return { ok: true };
}

/* ADMIT ONE PLAY PURCHASE.
 *
 * `o.subscription` is Google's subscriptionsv2 resource, already read (the
 * webhook reads it before claiming the event, so the ledger records the right
 * environment); otherwise it is read here. Never anything from a device or a
 * notification beyond the token itself.
 *
 * Returns { ok, code, status, ... } -- the verify route turns it into an HTTP
 * answer, the webhook into a ledger outcome. */
async function admit(S, cfg, o){
  const x = o || {};
  const gcfg = x.gcfg || G.config();
  if (!gcfg.ok) return { ok: false, code: 'provider_not_configured', status: 503 };
  const token = x.purchaseToken;
  if (!G.tokenLooksValid(token)) return { ok: false, code: 'bad_purchase_token', status: 400 };
  /* Eight characters of the purchase, for correlating log lines; never all of it. */
  const which = G.ref(token);

  let sub = x.subscription;
  if (!sub){
    const got = await G.fetchSubscription(gcfg, token, x.opts);
    if (!got.ok){
      log('READ_FAILED code=' + got.code + ' purchase=' + which);
      return { ok: false, code: got.code === 'purchase_not_found' ? 'purchase_not_found' : 'provider_error',
               status: got.code === 'purchase_not_found' ? 404 : 502 };
    }
    sub = got.subscription;
  }

  const facts = G.subscriptionFacts(sub, {
    purchaseToken: token, eventId: x.eventId || null, type: x.type || 'verify',
    occurredAt: x.occurredAt || null, revoked: !!x.revoked, env: gcfg.env
  });
  /* Not yet paid (PENDING), or a product this deployment does not sell. */
  if (!facts) return { ok: false, code: 'unclassifiable', status: 409 };
  if (x.productId && x.productId !== facts.product_id) return { ok: false, code: 'product_mismatch', status: 400 };

  const owner = await ownerOf(S, cfg, gcfg, facts, token, x.uid || null);
  if (!owner.ok){
    log('NOT_ADMITTED code=' + owner.code + ' purchase=' + which);
    return { ok: false, code: owner.code,
             status: owner.code === 'unavailable' ? 503
                   : owner.code === 'unattributable' ? 200 : 403 };
  }
  facts.account_id = owner.accountId;

  /* Only a purchase new to us is asked the two rules. A known one is already
     a relationship we accepted, and every later fact about it -- renewal,
     cancellation, grace, expiry, revocation -- must be recorded, never refused. */
  if (!owner.known){
    const ok = await admissible(S, cfg, facts, owner.accountId, token);
    if (!ok.ok){
      log('REFUSED code=' + ok.code + ' purchase=' + which);
      return { ok: false, code: ok.code, status: ok.code === 'unavailable' ? 503 : 409,
               existingProvider: ok.existingProvider || null };
    }
  }

  const applied = await Apply.applySubscriptionFacts(S, cfg, facts, { environment: facts.environment });
  if (!applied.ok){
    if (applied.code === 'account_mismatch') return { ok: false, code: 'not_your_purchase', status: 403 };
    return { ok: false, code: 'subscription_unwritable', status: 503, reason: applied.reason };
  }

  /* KEEP IT: acknowledged only now, after the purchase is verified, owned and
     written. A failure here is not fatal -- the app retries any unacknowledged
     purchase on its next start or resume, and the next notification does too. */
  let acknowledged = !facts.acknowledgement_pending;
  if (facts.acknowledgement_pending && LIVE.indexOf(facts.condition) !== -1){
    const ack = await G.acknowledge(gcfg, facts.product_id, token, x.opts);
    acknowledged = !!ack.ok;
    if (!ack.ok) log('ACK_FAILED code=' + ack.code + ' purchase=' + which);
  }

  /* THE PURCHASE THIS ONE REPLACED, re-read rather than assumed: Google ends
     it when a plan change or a resubscribe creates the new one, and our row
     for it should say so now rather than at its next notification. Best
     effort, and only for a purchase we already hold. */
  if (facts.linked_purchase_token && !x.skipLinked){
    try{
      const prevOwner = await Store.ownerOfExisting(S, cfg, G.PROVIDER, facts.linked_purchase_token);
      if (prevOwner.ok && prevOwner.accountId === owner.accountId){
        await admit(S, cfg, { gcfg: gcfg, purchaseToken: facts.linked_purchase_token,
                              type: 'linked_refresh', skipLinked: true, opts: x.opts });
      }
    }catch(e){ log('LINKED_REFRESH_FAILED'); }
  }

  log('ADMITTED condition=' + facts.condition + ' purchase=' + which + ' ack=' + acknowledged);
  return { ok: true, code: 'verified', status: 200, condition: facts.condition,
           acknowledged: acknowledged, accountId: owner.accountId,
           subscriptionId: applied.subscriptionId, trial: applied.trial,
           environment: facts.environment, entitlementSynced: applied.entitlementSynced };
}

module.exports = { LIVE, decidePrepare, prepare, ownerOf, admissible, admit };
