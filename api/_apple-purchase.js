// Velvet Viking -- an App Store purchase, from "may I buy" to the core.
//
//   prepare()   before StoreKit's purchase sheet opens: may this athlete buy,
//               may the purchase include the free trial (signed for Apple as
//               the introductory-offer eligibility), and the appAccountToken
//               the purchase must carry so it can be tied back to them.
//   admit()     after the App Store says a purchase exists: whose is it, may
//               it stand, then the SAME core write the web and Play rails use.
//
// Two routes reach admit(), as for the other rails:
//
//   PULLED   the app hands the server a signed transaction (POST
//            /api/subscription {action:'apple_verify'}), with the athlete's
//            own access token.
//   PUSHED   App Store Server Notifications V2, through
//            /api/billing-webhook?rail=apple, verified by Apple's signature.
//
// Both re-read the subscription from the App Store Server API, both go
// through this file, and both end in _billing-apply.js.
//
// THE RULES ARE THE CORE'S, NOT THIS FILE'S. One live subscription per athlete
// is E.mayStartStandardPurchase(); one trial per athlete is the
// account_commercial allowance, spent by _billing-apply.js. What is
// particular to Apple is only HOW the trial rule reaches the purchase: the
// server signs Apple's introductory-offer eligibility with SACORO's verdict,
// so an athlete who has had a trial on any rail is charged from day one by
// Apple itself, and admit() refuses a trial that slipped through anyway.
//
// THE DEVICE FINISHES A TRANSACTION ONLY AFTER admit() SAYS IT WAS ADMITTED.
// Unlike Play, an unfinished App Store transaction is NOT refunded: StoreKit
// simply delivers it again. A refused purchase is therefore refused loudly in
// the app (with the way to cancel or request a refund from Apple), and the
// transaction stays unfinished.

'use strict';

const AP = require('./_apple.js');
const A = require('./_access.js');
const E = require('./_entitlement.js');
const Prod = require('./_products.js');
const Store = require('./_commercial-store.js');
const Apply = require('./_billing-apply.js');
const Agree = require('./_agreements.js');
const GP = require('./_google-purchase.js');

function log(what){ try{ console.log('apple-purchase: ' + what); }catch(e){} }

const LIVE = GP.LIVE;

// ===========================================================================
// BEFORE THE PURCHASE
// ===========================================================================

/* The same questions, in the same order, with the same refusal codes as the
   web checkout and the Play rail: one pure function, shared. */
const decidePrepare = GP.decidePrepare;

/* What the iOS build needs before it opens StoreKit's purchase sheet.
   Read-only: nothing is written, no trial is spent, nothing is reserved.

   `body.appTransactionId` is the customer's AppTransaction.appTransactionID
   from the device. Apple requires a transaction id in the signed eligibility
   and documents that one as usable for customers who have bought nothing. It
   is not trusted for anything else: it only says which Apple customer the
   signature is for, and a wrong one makes Apple refuse the signature. */
async function prepare(S, cfg, uid, req, body){
  const acfg = AP.config();
  const b = body || {};
  const facts = await Store.readCommercialFacts(S, cfg, uid);
  const purchaseCheck = facts.ok
    ? E.mayStartStandardPurchase({ account: facts.account, subscriptions: facts.subscriptions,
                                   provider: AP.PROVIDER, now: new Date() })
    : { allowed: false, reason: 'unavailable', trial: null };
  const evidence = await Agree.purchaseEvidence(cfg, S.sb, uid);

  const decision = decidePrepare({
    commerceEnabled: A.commerceEnabled(),
    providerConfigured: acfg.ok,
    uid: uid,
    /* No location check: the App Store's own availability decides (founder,
       19 November 2026; see decidePrepare in _google-purchase.js). */
    evidence: evidence,
    purchaseCheck: purchaseCheck
  });
  if (!acfg.ok) log('NOT_CONFIGURED missing=' + acfg.missing.join(','));

  /* THE TRIAL VERDICT IS OURS, NOT APPLE'S. */
  const trial = purchaseCheck && purchaseCheck.trial;
  const trialEligible = !!(trial && trial.eligible);
  const products = {};
  Object.keys(acfg.offers).forEach(function(code){
    products[acfg.offers[code].billingPeriod] = acfg.offers[code].productId;
  });

  /* One signature per product, for this customer, saying exactly SACORO's
     verdict. Only when the purchase may go ahead. */
  let signatures = null;
  const appTransactionId = b.appTransactionId || b.app_transaction_id || null;
  if (decision.allowed && appTransactionId){
    signatures = {};
    for (const period of Object.keys(products)){
      const jws = AP.introductoryOfferSignature(acfg, {
        productId: products[period], allow: trialEligible, transactionId: appTransactionId
      });
      if (!jws){ signatures = null; break; }
      signatures[products[period]] = jws;
    }
  }

  return {
    commerce_enabled: A.commerceEnabled(),
    provider_configured: acfg.ok,
    purchase_allowed: decision.allowed,
    reason: decision.reason,
    existing_provider: decision.existingProvider || null,
    app_account_token: (decision.allowed && acfg.hasAccountTokenSecret)
      ? AP.appAccountToken(uid, acfg.accountTokenSecret()) : null,
    products: acfg.ok ? products : {},
    trial_eligible: trialEligible,
    trial_days: Prod.TRIAL_DAYS,
    intro_offer_signatures: signatures,
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
 *   1. a row we already hold for this originalTransactionId: its account, for
 *      ever (renewals, plan changes and resubscribes keep the id);
 *   2. the athlete asking, ONLY IF the appAccountToken Apple holds on the
 *      transaction is the one this server derives for them;
 *   3. otherwise (a notification for a purchase the app has not verified
 *      yet) nobody, and the app's own verify brings it in. */
async function ownerOf(S, cfg, acfg, facts, uid){
  const own = await Store.ownerOfExisting(S, cfg, AP.PROVIDER, facts.subscription_ref);
  if (!own.ok) return { ok: false, code: 'unavailable' };
  if (own.accountId){
    if (uid && own.accountId !== uid) return { ok: false, code: 'not_your_purchase' };
    return { ok: true, accountId: own.accountId, known: true };
  }
  if (uid){
    const mine = AP.appAccountToken(uid, acfg.accountTokenSecret());
    if (!AP.sameToken(facts.app_account_token, mine)) return { ok: false, code: 'not_your_purchase' };
    return { ok: true, accountId: uid, known: false };
  }
  return { ok: false, code: 'unattributable' };
}

/* MAY A PURCHASE WE HAVE NOT SEEN BEFORE STAND? The two rules, asked through
   the existing functions, exactly as the Play rail asks them. */
async function admissible(S, cfg, facts, accountId){
  if (LIVE.indexOf(facts.condition) === -1) return { ok: true };
  const commercial = await Store.readCommercialFacts(S, cfg, accountId);
  if (!commercial.ok) return { ok: false, code: 'unavailable' };
  const others = (commercial.subscriptions || []).filter(function(s){
    return !(s.provider === AP.PROVIDER && String(s.provider_subscription_id) === String(facts.subscription_ref));
  });
  const check = E.mayStartStandardPurchase({
    account: commercial.account, subscriptions: others, provider: AP.PROVIDER,
    offerCode: facts.offer_code, now: new Date()
  });
  if (!check.allowed) return { ok: false, code: check.reason, existingProvider: check.existingProvider || null };
  if (facts.condition === 'trialing' && !(check.trial && check.trial.eligible)){
    return { ok: false, code: 'trial_already_used' };
  }
  return { ok: true };
}

/* A FREE TRIAL ON A SUBSCRIPTION WE ALREADY HOLD.
 *
 * The one place Apple can give a trial without asking this server: a lapsed
 * subscriber who resubscribes OUTSIDE the app (Settings, Subscriptions) is
 * eligible for the introductory offer by Apple's own rule if they never used
 * one in the group -- for example an athlete who had their trial on the web,
 * then paid on Apple with the trial signed away, then lapsed. No signed
 * eligibility can reach that purchase. It arrives as the SAME subscription
 * (same originalTransactionId), so it is "known", and a known subscription is
 * normally recorded whatever it says.
 *
 * So a known subscription that is now trialing is asked the trial question
 * once more, unless this row already carries the trial it is in (the athlete's
 * own first trial, being renewed, cancelled or re-read). A second trial is
 * refused: no access for Apple's free days, and the first paid renewal is then
 * admitted as an ordinary paid period. */
async function secondTrialOnKnown(S, cfg, facts, accountId){
  if (facts.condition !== 'trialing') return { ok: true };
  const commercial = await Store.readCommercialFacts(S, cfg, accountId);
  if (!commercial.ok) return { ok: false, code: 'unavailable' };
  const row = (commercial.subscriptions || []).filter(function(s){
    return s.provider === AP.PROVIDER && String(s.provider_subscription_id) === String(facts.subscription_ref);
  })[0];
  if (row && row.trial_start) return { ok: true };
  const trial = E.trialEligibility(commercial.account, new Date());
  return trial.eligible ? { ok: true } : { ok: false, code: 'trial_already_used' };
}

/* ADMIT ONE APP STORE SUBSCRIPTION.
 *
 * `o.signedTransaction` is what the device sent (verify route), or
 * `o.transaction` an already verified transaction (the webhook verified the
 * notification's own). Either way it is only a LOOKUP KEY: the state, the
 * product and the appAccountToken that decide everything come from the App
 * Store Server API's re-verified answer.
 *
 * Returns { ok, code, status, finish, ... }. `finish` is true only for an
 * admitted purchase: that is the one signal the app finishes a transaction on. */
async function admit(S, cfg, o){
  const x = o || {};
  const acfg = x.acfg || AP.config();
  if (!acfg.ok) return { ok: false, code: 'provider_not_configured', status: 503 };

  let claimed = x.transaction || null;
  if (!claimed){
    const v = AP.verifyTransaction(x.signedTransaction, acfg, x.opts);
    if (!v.ok){
      log('DEVICE_TRANSACTION_REFUSED reason=' + v.reason);
      return { ok: false, code: v.reason === 'wrong_environment' ? 'wrong_environment' : 'bad_transaction',
               status: 400, reason: v.reason };
    }
    claimed = v.transaction;
  }
  if (claimed.type && claimed.type !== 'Auto-Renewable Subscription') return { ok: false, code: 'unclassifiable', status: 409 };
  if (!AP.transactionIdLooksValid(claimed.transactionId) || !AP.transactionIdLooksValid(claimed.originalTransactionId)){
    return { ok: false, code: 'bad_transaction', status: 400 };
  }
  const which = AP.ref(String(claimed.originalTransactionId));

  let statuses = x.statuses;
  if (!statuses){
    const got = await AP.fetchStatuses(acfg, String(claimed.transactionId), claimed.environment, x.opts);
    if (!got.ok){
      log('READ_FAILED code=' + got.code + ' subscription=' + which);
      /* Why Apple refused, as a short code of our own, as on the Play rail. */
      return { ok: false, code: got.code === 'purchase_not_found' ? 'purchase_not_found' : 'provider_error',
               status: got.code === 'purchase_not_found' ? 404 : 502, detail: got.code || null };
    }
    statuses = got.statuses;
  }
  const last = AP.ourLastTransaction(statuses, String(claimed.originalTransactionId), acfg, x.opts);
  if (!last.ok){
    log('NOT_IN_STATUSES code=' + last.code + ' subscription=' + which);
    return { ok: false, code: last.code, status: last.code === 'purchase_not_found' ? 404 : 502 };
  }

  const facts = AP.subscriptionFacts(last.transaction, last.renewal, last.status, {
    eventId: x.eventId || null, type: x.type || 'verify', occurredAt: x.occurredAt || null,
    revoked: !!x.revoked, env: acfg.env
  });
  /* A product this deployment does not sell, or a status Apple has not
     defined: refused, never guessed. */
  if (!facts) return { ok: false, code: 'unclassifiable', status: 409 };

  const owner = await ownerOf(S, cfg, acfg, facts, x.uid || null);
  if (!owner.ok){
    log('NOT_ADMITTED code=' + owner.code + ' subscription=' + which);
    return { ok: false, code: owner.code,
             status: owner.code === 'unavailable' ? 503 : owner.code === 'unattributable' ? 200 : 403 };
  }
  facts.account_id = owner.accountId;

  const ok0 = owner.known ? await secondTrialOnKnown(S, cfg, facts, owner.accountId) : { ok: true };
  if (!ok0.ok){
    log('REFUSED code=' + ok0.code + ' subscription=' + which + ' known=1');
    return { ok: false, code: ok0.code, status: ok0.code === 'unavailable' ? 503 : 409 };
  }
  if (!owner.known){
    const ok = await admissible(S, cfg, facts, owner.accountId);
    if (!ok.ok){
      log('REFUSED code=' + ok.code + ' subscription=' + which);
      return { ok: false, code: ok.code, status: ok.code === 'unavailable' ? 503 : 409,
               existingProvider: ok.existingProvider || null };
    }
  }

  const applied = await Apply.applySubscriptionFacts(S, cfg, facts, { environment: facts.environment });
  if (!applied.ok){
    if (applied.code === 'account_mismatch') return { ok: false, code: 'not_your_purchase', status: 403 };
    return { ok: false, code: 'subscription_unwritable', status: 503, reason: applied.reason };
  }

  log('ADMITTED condition=' + facts.condition + ' subscription=' + which);
  return { ok: true, code: 'verified', status: 200, condition: facts.condition, finish: true,
           transactionId: String(claimed.transactionId), accountId: owner.accountId,
           subscriptionId: applied.subscriptionId, trial: applied.trial,
           environment: facts.environment, entitlementSynced: applied.entitlementSynced };
}

module.exports = { LIVE, decidePrepare, prepare, ownerOf, admissible, secondTrialOnKnown, admit };
