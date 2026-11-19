// Velvet Viking -- the payment-provider webhook.
//
//   POST /api/billing-webhook
//     stripe-signature: <Stripe's own scheme, verified by _stripe.js>
//
//   POST /api/billing-webhook?rail=google
//     Authorization: Bearer <Pub/Sub push OIDC token, verified by _google.js>
//     Google Play's Real-time developer notifications, pushed by the Pub/Sub
//     subscription on projects/sacoro-billing/topics/sacoro-play-billing.
//
//   POST /api/billing-webhook?rail=apple
//     { "signedPayload": "<JWS signed by Apple, verified by _apple.js>" }
//     App Store Server Notifications V2, production and sandbox.
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
const G = require('./_google.js');
const GP = require('./_google-purchase.js');
const AP = require('./_apple.js');
const AXP = require('./_apple-purchase.js');

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

/* ---------- the Google Play boundary ----------
 *
 * CHOSEN BY THE REQUEST, never by the body: the push subscription's endpoint
 * URL carries ?rail=google, set by whoever configured Pub/Sub, and a body
 * cannot change which verifier it is held to.
 *
 * Order, and why:
 *   1. configuration, or a 503 that names what is missing (names, not values)
 *   2. the Pub/Sub OIDC token, before the body is read for anything
 *   3. the DeveloperNotification: a test publish is answered 200 and applies
 *      nothing; anything that is not about one of our subscriptions likewise
 *   4. the purchase RE-READ FROM GOOGLE -- the notification is a prompt to
 *      look, never a statement of state
 *   5. CLAIM the Pub/Sub message id in the one ledger, so a redelivery stops
 *   6. admit it through _google-purchase.js, the same path the app's verify
 *      call takes, ending in _billing-apply.js like every other rail
 *   7. record what it did
 *
 * Pub/Sub treats any 2xx as an acknowledgement and anything else as "deliver
 * again", so a duplicate, an irrelevant message and a purchase we refuse are
 * all 200, and only a failure that a retry could cure is a 503. */
function railOf(req){
  const q = req && req.query && req.query.rail;
  if (q) return String(q);
  const m = /[?&]rail=([^&#]+)/.exec(String((req && req.url) || ''));
  return m ? decodeURIComponent(m[1]) : null;
}
function bodyOf(req){
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try{ return JSON.parse(rawBodyOf(req)); }catch(e){ return null; }
}

async function handleGoogle(req, res, cfg, opts){
  const gcfg = G.config();
  if (!gcfg.hasRtdn){
    log('GOOGLE_RTDN_NOT_CONFIGURED missing=' + gcfg.rtdnMissing.join(','));
    return S.json(res, 503, { error: 'unavailable', code: 'GOOGLE_RTDN_NOT_CONFIGURED', missing: gcfg.rtdnMissing });
  }
  if (!gcfg.ok){
    log('GOOGLE_NOT_CONFIGURED missing=' + gcfg.missing.join(','));
    return S.json(res, 503, { error: 'unavailable', code: 'GOOGLE_NOT_CONFIGURED', missing: gcfg.missing });
  }
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const auth = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = /^Bearer\s+(\S+)$/.exec(auth);
  const check = m ? await G.verifyPushToken(m[1], {
    audience: gcfg.rtdnAudience, email: gcfg.rtdnServiceAccount
  }, opts) : { ok: false, reason: 'unsigned' };
  if (!check.ok){
    log('GOOGLE_REJECTED reason=' + check.reason);
    return S.json(res, 401, { error: 'not_authenticated', code: 'BAD_PUSH_TOKEN' });
  }

  const push = G.decodePush(bodyOf(req));
  if (!push) return S.json(res, 400, { error: 'bad_request', code: 'NO_NOTIFICATION' });
  const n = push.notification;
  if (n.packageName && n.packageName !== gcfg.packageName){
    log('GOOGLE_IGNORED reason=other_package');
    return S.json(res, 200, { ok: true, applied: false, reason: 'other_package' });
  }
  const target = G.notificationTarget(n);
  if (target.kind === 'test'){
    log('GOOGLE_TEST_NOTIFICATION');
    return S.json(res, 200, { ok: true, applied: false, reason: 'test_notification' });
  }
  if (target.kind !== 'subscription'){
    log('GOOGLE_IGNORED reason=not_a_subscription');
    return S.json(res, 200, { ok: true, applied: false, reason: 'not_entitlement_relevant' });
  }
  if (!G.tokenLooksValid(target.purchaseToken)){
    return S.json(res, 200, { ok: true, applied: false, reason: 'bad_purchase_token' });
  }

  /* 4. THE TRUTH, from Google, before anything is claimed: a transient failure
        here is a 503 with nothing claimed, so Pub/Sub's redelivery genuinely
        retries it. A token Google no longer knows is final. */
  const got = await G.fetchSubscription(gcfg, target.purchaseToken, opts);
  if (!got.ok){
    if (got.code === 'purchase_not_found'){
      log('GOOGLE_UNKNOWN_PURCHASE purchase=' + G.ref(target.purchaseToken));
      return S.json(res, 200, { ok: true, applied: false, reason: 'purchase_not_found' });
    }
    log('GOOGLE_READ_FAILED code=' + got.code);
    return S.json(res, 503, { error: 'unavailable', code: 'GOOGLE_UNREACHABLE' });
  }
  const environment = (got.subscription && got.subscription.testPurchase) ? 'sandbox' : 'production';

  /* 5. CLAIM. The Pub/Sub message id is the delivery's identity: a lost ack
        redelivers the same id, and it stops here. */
  const claim = await Store.claimBillingEvent(S, cfg, {
    provider: G.PROVIDER, provider_event_id: push.messageId,
    event_type: target.type, environment: environment
  });
  if (!claim.ok && !claim.duplicate){
    log('GOOGLE_CLAIM_FAILED reason=' + claim.reason);
    return S.json(res, 503, { error: 'unavailable', code: 'LEDGER_UNAVAILABLE' });
  }
  if (claim.duplicate){
    log('GOOGLE_DUPLICATE id=' + G.ref(push.messageId));
    return S.json(res, 200, { ok: true, applied: false, reason: 'already_applied' });
  }

  /* 6. The same admission the app's verify call goes through. */
  const r = await GP.admit(S, cfg, {
    gcfg: gcfg, purchaseToken: target.purchaseToken, subscription: got.subscription,
    eventId: push.messageId, type: target.type, revoked: target.revoked,
    occurredAt: n.eventTimeMillis ? new Date(Number(n.eventTimeMillis)).toISOString() : null,
    opts: opts
  });

  if (!r.ok && r.status >= 500){
    await Store.markBillingEventProcessed(S, cfg, {
      provider: G.PROVIDER, provider_event_id: push.messageId, result: 'failed_' + r.code
    });
    log('GOOGLE_APPLY_FAILED code=' + r.code);
    return S.json(res, 503, { error: 'unavailable', code: 'SUBSCRIPTION_UNWRITABLE' });
  }
  if (!r.ok){
    /* Not ours to apply: unattributable (the app's own verify will bring it in),
       somebody else's, a second live subscription, a second trial. Recorded and
       answered 200 -- redelivering it cannot change the answer, and the
       purchase is never acknowledged, so Google refunds it. */
    await Store.markBillingEventProcessed(S, cfg, {
      provider: G.PROVIDER, provider_event_id: push.messageId, result: r.code
    });
    log('GOOGLE_NOT_APPLIED code=' + r.code);
    return S.json(res, 200, { ok: true, applied: false, reason: r.code });
  }

  await Store.markBillingEventProcessed(S, cfg, {
    provider: G.PROVIDER, provider_event_id: push.messageId,
    account_id: r.accountId, subscription_id: r.subscriptionId,
    result: r.entitlementSynced ? 'processed' : 'processed_entitlement_stale'
  });
  log('GOOGLE_APPLIED condition=' + r.condition + ' account=' + ref(r.accountId));
  return S.json(res, 200, { ok: true, applied: true, condition: r.condition });
}

/* ---------- the App Store boundary ----------
 *
 * CHOSEN BY THE REQUEST, never by the body: the notification URL entered in
 * App Store Connect carries ?rail=apple.
 *
 * Order, and why:
 *   1. configuration, or a 503 that names what is missing (names, not values)
 *   2. Apple's signature on signedPayload (the x5c chain to Apple Root CA - G3,
 *      the bundle id, the environment, the app's Apple ID in Production),
 *      before anything in it is believed
 *   3. a TEST notification is answered 200 and applies nothing; anything not
 *      about one of our subscriptions likewise
 *   4. the notification's own signed transaction, verified the same way, then
 *      the subscription RE-READ FROM THE APP STORE SERVER API -- the
 *      notification is a prompt to look, never a statement of state
 *   5. CLAIM notificationUUID in the one ledger, so a redelivery stops
 *   6. admit it through _apple-purchase.js, the same path the app's verify
 *      call takes, ending in _billing-apply.js like every other rail
 *   7. record what it did
 *
 * Apple retries anything that is not a 2xx, so a duplicate, an irrelevant
 * notification and a purchase we refuse are all 200, and only a failure that
 * a retry could cure is a 503. */
async function handleApple(req, res, cfg, opts){
  const acfg = AP.config();
  if (!acfg.ok){
    log('APPLE_NOT_CONFIGURED missing=' + acfg.missing.join(','));
    return S.json(res, 503, { error: 'unavailable', code: 'APPLE_NOT_CONFIGURED', missing: acfg.missing });
  }
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const body = bodyOf(req);
  const signed = body && typeof body.signedPayload === 'string' ? body.signedPayload : null;
  if (!signed) return S.json(res, 400, { error: 'bad_request', code: 'NO_SIGNED_PAYLOAD' });
  const check = AP.verifyNotification(signed, acfg, opts);
  if (!check.ok){
    log('APPLE_REJECTED reason=' + check.reason);
    return S.json(res, 401, { error: 'not_authenticated', code: 'BAD_SIGNED_PAYLOAD' });
  }
  const n = check.notification;
  const target = AP.notificationTarget(n);
  if (target.kind === 'test'){
    log('APPLE_TEST_NOTIFICATION');
    return S.json(res, 200, { ok: true, applied: false, reason: 'test_notification' });
  }
  if (target.kind !== 'subscription'){
    log('APPLE_IGNORED reason=not_a_subscription');
    return S.json(res, 200, { ok: true, applied: false, reason: 'not_entitlement_relevant' });
  }
  const tx = AP.verifyTransaction(target.signedTransactionInfo, acfg, opts);
  if (!tx.ok){
    log('APPLE_TRANSACTION_REJECTED reason=' + tx.reason);
    return S.json(res, 200, { ok: true, applied: false, reason: 'transaction_unverified' });
  }
  const t = tx.transaction;
  if (t.type && t.type !== 'Auto-Renewable Subscription'){
    return S.json(res, 200, { ok: true, applied: false, reason: 'not_entitlement_relevant' });
  }
  if (!n.notificationUUID) return S.json(res, 400, { error: 'bad_request', code: 'NO_NOTIFICATION_ID' });

  /* 4. THE TRUTH, from Apple, before anything is claimed: a transient failure
        is a 503 with nothing claimed, so Apple's retry genuinely retries. */
  const got = await AP.fetchStatuses(acfg, String(t.transactionId), t.environment, opts);
  if (!got.ok){
    if (got.code === 'purchase_not_found'){
      log('APPLE_UNKNOWN_SUBSCRIPTION subscription=' + AP.ref(String(t.originalTransactionId)));
      return S.json(res, 200, { ok: true, applied: false, reason: 'purchase_not_found' });
    }
    log('APPLE_READ_FAILED code=' + got.code);
    return S.json(res, 503, { error: 'unavailable', code: 'APPLE_UNREACHABLE' });
  }
  const environment = t.environment === 'Sandbox' ? 'sandbox' : 'production';

  /* 5. CLAIM. notificationUUID is the delivery's identity; Apple's retries
        carry the same one. */
  const claim = await Store.claimBillingEvent(S, cfg, {
    provider: AP.PROVIDER, provider_event_id: String(n.notificationUUID),
    event_type: target.type, environment: environment
  });
  if (!claim.ok && !claim.duplicate){
    log('APPLE_CLAIM_FAILED reason=' + claim.reason);
    return S.json(res, 503, { error: 'unavailable', code: 'LEDGER_UNAVAILABLE' });
  }
  if (claim.duplicate){
    log('APPLE_DUPLICATE id=' + AP.ref(String(n.notificationUUID)));
    return S.json(res, 200, { ok: true, applied: false, reason: 'already_applied' });
  }

  /* 6. The same admission the app's verify call goes through. */
  const r = await AXP.admit(S, cfg, {
    acfg: acfg, transaction: t, statuses: got.statuses,
    eventId: String(n.notificationUUID), type: target.type, revoked: target.revoked,
    occurredAt: n.signedDate ? new Date(Number(n.signedDate)).toISOString() : null,
    opts: opts
  });

  if (!r.ok && r.status >= 500){
    await Store.markBillingEventProcessed(S, cfg, {
      provider: AP.PROVIDER, provider_event_id: String(n.notificationUUID), result: 'failed_' + r.code
    });
    log('APPLE_APPLY_FAILED code=' + r.code);
    return S.json(res, 503, { error: 'unavailable', code: 'SUBSCRIPTION_UNWRITABLE' });
  }
  if (!r.ok){
    await Store.markBillingEventProcessed(S, cfg, {
      provider: AP.PROVIDER, provider_event_id: String(n.notificationUUID), result: r.code
    });
    log('APPLE_NOT_APPLIED code=' + r.code);
    return S.json(res, 200, { ok: true, applied: false, reason: r.code });
  }

  await Store.markBillingEventProcessed(S, cfg, {
    provider: AP.PROVIDER, provider_event_id: String(n.notificationUUID),
    account_id: r.accountId, subscription_id: r.subscriptionId,
    result: r.entitlementSynced ? 'processed' : 'processed_entitlement_stale'
  });
  log('APPLE_APPLIED condition=' + r.condition + ' account=' + ref(r.accountId));
  return S.json(res, 200, { ok: true, applied: true, condition: r.condition });
}

module.exports = async function handler(req, res){
  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }
  const cfg = S.config();

  /* GOOGLE PLAY NOTIFICATIONS TAKE THE GOOGLE PATH, chosen by the endpoint URL
     the Pub/Sub push subscription was given (?rail=google), never by the body. */
  if (railOf(req) === 'google') return handleGoogle(req, res, cfg);
  /* APP STORE NOTIFICATIONS TAKE THE APPLE PATH, chosen by the notification URL
     entered in App Store Connect (?rail=apple), never by the body. */
  if (railOf(req) === 'apple') return handleApple(req, res, cfg);

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
module.exports.railOf = railOf;
module.exports.handleGoogle = handleGoogle;
module.exports.handleApple = handleApple;
