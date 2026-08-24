// Velvet Viking -- the athlete's own subscription: what they may be told about
// it, and what they may do to it.
//
//   GET  /api/subscription   Authorization: Bearer <supabase access token>
//                            -> the athlete's own state, for rendering
//   POST /api/subscription   { action: "reconcile", session_id }
//                            -> ask the PROVIDER what happened, then re-derive
//   POST /api/subscription   { action: "cancel" }
//                            -> stop the renewal, keep the paid period
//   POST /api/subscription   { action: "reactivate" }
//                            -> change your mind before it runs out
//
// WHY THIS IS NOT /api/session. That endpoint mints the delivery lease, and it
// answers 403 when access has ended -- which is correct, and which is exactly
// why it cannot also be the endpoint that tells a LAPSED athlete what happened
// to them. The locked shell needs an endpoint that answers 200 while saying
// "you have no access", because "why can I not get in, and what do I do about
// it" is a question only an athlete without access ever asks.
//
// NOTHING HERE IS AUTHORITATIVE ABOUT ACCESS. GET renders. /api/app re-resolves
// the same decision server-side from the cookie before it hands over a byte of
// runtime, so an athlete who edits this response has changed a sentence on a
// screen.
//
// THERE IS ONE DOOR INTO A PURCHASE, AND IT IS NOT THIS ONE.
//
// Until this pass, POST { action: "resubscribe" } read a checkout URL out of
// VVV_CHECKOUT_URL, appended the athlete's uid as client_reference_id, and sent
// the browser there. That was written before a provider existed and it became a
// SECOND way to buy the moment /api/checkout arrived -- one that asked none of
// the questions the real one asks:
//
//   it did not check VVV_COMMERCE_ENABLED, so an unset flag did not stop it;
//   it did not refuse a live key in an uncommissioned deployment;
//   it did not validate the offer, so whatever the URL pointed at was sold;
//   it did not ask mayStartStandardPurchase(), so an athlete who already
//     subscribed -- here or through a store -- could buy a second subscription;
//   and it created no Stripe customer, so the purchase arrived detached from
//     the account that made it.
//
// A second purchase path is a second commercial authority wearing a different
// hat, and the architecture recovery removed one of those already. The action
// now answers 410 and names the endpoint that does the job properly.
//
// WHAT AN ATHLETE MAY DO TO THEIR OWN SUBSCRIPTION, AND WHAT THEY MAY NOT.
// Cancel and reactivate are theirs. They act only on a subscription whose
// account_id is the uid on the bearer token, they go to the provider rather
// than to our own columns, and the row is refreshed from the provider's answer
// rather than from what we hoped the call did. Nothing here writes an
// entitlement, a condition, a period or a trial.

const S = require('./_strava.js');
const A = require('./_access.js');
const P = require('./_stripe.js');
const Prod = require('./_products.js');
const Store = require('./_commercial-store.js');
const Apply = require('./_billing-apply.js');
const Checkout = require('./_checkout.js');
const Agree = require('./_agreements.js');
const E = require('./_entitlement.js');

function log(what){ try{ console.log('subscription: ' + what); }catch(e){} }
function ref(v){ return v ? String(v).slice(0, 8) + '…' : '-'; }

/* Everything an account screen needs and not one field more. No provider
   customer id, no subscription id, no event sequence: those are operational
   plumbing, they identify the athlete to a third party, and a screen that
   shows them invites a support conversation about them. */
function publicView(decision, ent, uid, email, extra){
  const x = extra || {};
  return {
    signed_in: !!uid,
    email: email || null,
    access: decision.allow,
    reason: decision.reason,
    state: decision.state,
    override: decision.override,
    tier: decision.tier,
    capabilities: decision.capabilities,
    /* Present on BOTH answers. What an athlete keeps when they have nothing is
       a promise the product makes, so it is stated whether or not they
       currently need it. */
    locked_capabilities: decision.locked_capabilities || A.lockedCapabilities(),
    access_until: decision.access_until,
    cancel_at_period_end: decision.cancel_at_period_end,
    commercial_required: A.commercialRequired(),
    account_required: A.accountRequired(),
    /* Whether the ONE purchase door can currently sell anything. Derived from
       the canonical catalogue and the commerce flag rather than from a URL
       somebody set in an environment variable -- a configured URL was never
       evidence that an offer existed behind it. */
    checkout_configured: Checkout.purchasableNow(process.env),
    catalogue: Prod.catalogue(P.PROVIDER, process.env, new Date()),
    /* The wording and versions in force, and what this athlete still owes,
       so a purchase surface never has to guess either. */
    agreements: Agree.currentAgreements(),
    agreements_outstanding: x.evidence
      ? { terms: !x.evidence.terms, immediate_start: !x.evidence.immediateStart,
          /* WHY the Terms are outstanding, which is not the athlete's doing
             when the answer is that no commercial Terms have been published.
             A surface that could not tell the two apart would ask somebody to
             tick a box for a document that does not exist. */
          commercial_legal_published: x.evidence.published !== false }
      : null,
    /* WHERE THIS SUBSCRIPTION IS MANAGED. An athlete who bought through the App
       Store cannot cancel here and must not be shown a button that pretends
       otherwise -- Apple owns that relationship and the cancellation lives in
       their settings. Null when there is nothing to manage. */
    management_provider: x.managementProvider || null,
    manageable_here: !!x.manageableHere
  };
}

/* THE ATHLETE'S OWN LIVE SUBSCRIPTION, or null.
 *
 * Read from the commercial core with the service key and filtered on
 * account_id, so the only rows this can ever see belong to the athlete on the
 * token. Nothing in a request body selects a subscription -- there is no
 * subscription id parameter anywhere in this file, deliberately, because a
 * parameter naming somebody else's purchase is the whole attack. */
function liveSubscriptionOf(facts, now){
  const subs = (facts && facts.subscriptions) || [];
  const at = now || new Date();
  return subs.filter(function(s){ return E.isBlockingCommercial(s, at); })[0] || null;
}

/* Pull the current truth from the provider and write it down. Used after every
   mutation and by the reconcile action, for the same reason: what a POST to
   Stripe returned is a hope, and the subscription object is a fact. */
async function refreshFromProvider(stripe, cfg, subscriptionId, expectedAccountId){
  const got = await P.fetchSubscription(stripe, subscriptionId);
  if (!got.ok) return { ok: false, code: 'provider_error', reason: got.code };

  const facts = P.subscriptionFacts(got.subscription, {
    type: 'reconcile',
    occurredAt: new Date().toISOString()
  });
  if (!facts) return { ok: false, code: 'unclassifiable' };

  /* THE BINDING CHECK, AND IT IS NOT OPTIONAL. The account a subscription
     belongs to comes from metadata WE set at checkout. If it does not name the
     athlete who is asking, this is somebody else's purchase and the answer is
     no -- not "attach it to whoever asked", which is how one athlete's card
     ends up paying for another athlete's access. */
  if (!facts.account_id || facts.account_id !== expectedAccountId){
    return { ok: false, code: 'not_your_subscription' };
  }

  const applied = await Apply.applySubscriptionFacts(S, cfg, facts, {
    environment: stripe.environment
  });
  if (!applied.ok) return { ok: false, code: applied.code, reason: applied.reason };
  return { ok: true, facts: facts, applied: applied };
}

/* ---------- reconcile ----------
 *
 * THE BROWSER IS NOT ALLOWED TO SAY "I PAID".
 *
 * Stripe returns the athlete to /account?checkout=complete&session_id=cs_… and
 * the temptation is to read that query string and unlock the product. Anybody
 * can type that URL. So the session id is treated as nothing more than a
 * LOOKUP KEY: the server fetches the Checkout Session from Stripe with the
 * secret key, and every fact that matters -- who it belongs to, whether it was
 * paid, which subscription it created -- comes back from the provider.
 *
 * WHY THIS EXISTS AT ALL, given the webhook. Because the webhook is a
 * notification and notifications are late. It can sit behind a queue, arrive
 * after a cold start, or be dropped by a deployment mid-rollout, and the minute
 * after somebody has paid is the worst minute in the product to tell them they
 * have no access. This is the same facts by the other route, and because it
 * shares _billing-apply.js with the webhook, the two cannot disagree -- in
 * particular they cannot both spend the trial, because the allowance is spent
 * by a conditional write the database arbitrates.
 *
 * IT GRANTS NOTHING ON ITS OWN. If the session is unpaid, belongs to somebody
 * else, or has no subscription behind it yet, the answer is the athlete's
 * existing state and an honest reason. */
async function reconcile(req, res, cfg, uid, body){
  const stripe = P.config();
  if (!stripe.hasSecret) return { code: 'provider_not_configured', status: 503 };

  const sessionId = body && body.session_id;
  const got = await P.fetchCheckoutSession(stripe, sessionId);
  if (!got.ok){
    log('RECONCILE_SESSION_UNREADABLE code=' + got.code);
    return { code: got.code === 'session_id_malformed' ? 'bad_session_id' : 'provider_error',
             status: got.code === 'session_id_malformed' ? 400 : 502 };
  }

  const session = got.session || {};
  /* The session's own account, from the metadata and client_reference_id we set
     when we created it -- never from anything the browser sent alongside. */
  const sessionAccount = P.accountOf(session);
  if (!sessionAccount || sessionAccount !== uid){
    log('RECONCILE_REFUSED reason=not_your_session uid=' + ref(uid));
    return { code: 'not_your_session', status: 403 };
  }

  const subId = typeof session.subscription === 'string'
    ? session.subscription
    : (session.subscription && session.subscription.id) || null;
  if (!subId){
    /* Paid sessions get a subscription immediately; an abandoned or still-open
       one does not, and saying so is better than inventing a state. NO TRIAL IS
       SPENT HERE -- reaching the payment screen is not using a trial. */
    log('RECONCILE_NO_SUBSCRIPTION uid=' + ref(uid) + ' status=' + String(session.status).slice(0, 20));
    return { code: 'checkout_not_complete', status: 200, applied: false };
  }

  const done = await refreshFromProvider(stripe, cfg, subId, uid);
  if (!done.ok){
    log('RECONCILE_FAILED code=' + done.code);
    return { code: done.code, status: done.code === 'not_your_subscription' ? 403 : 503 };
  }
  log('RECONCILED uid=' + ref(uid) + ' condition=' + done.facts.condition);
  return { code: 'reconciled', status: 200, applied: true };
}

/* ---------- cancel and reactivate ----------
 *
 * CANCELLING IS STOPPING THE RENEWAL. It is not ending access, it is not
 * deleting anything, and it is emphatically not touching the athlete's training
 * history: plans, activities, execution records and programme history are the
 * athlete's and survive every commercial state there is. Nothing in this file
 * can reach them.
 *
 * The paid period runs to its end -- _entitlement.js treats a cancelled
 * subscription with a future period end as live access, on purpose, because
 * confiscating a month somebody bought is how a cancellation becomes a
 * chargeback. */
async function mutateSubscription(req, res, cfg, uid, action){
  const stripe = P.config();
  if (!stripe.hasSecret) return { code: 'provider_not_configured', status: 503 };

  const facts = await Store.readCommercialFacts(S, cfg, uid);
  if (!facts.ok) return { code: 'unavailable', status: 503 };

  const sub = liveSubscriptionOf(facts, new Date());
  if (!sub) return { code: 'no_live_subscription', status: 409 };

  /* A subscription bought through a store is managed in that store. Refused
     here with the provider named, so the screen can send the athlete to the
     right place instead of failing silently. */
  if (sub.provider !== P.PROVIDER){
    return { code: 'managed_by_' + sub.provider, status: 409, provider: sub.provider };
  }
  if (!sub.provider_subscription_id) return { code: 'no_provider_subscription', status: 409 };

  const call = action === 'cancel'
    ? P.cancelAtPeriodEnd(stripe, sub.provider_subscription_id)
    : P.clearCancelAtPeriodEnd(stripe, sub.provider_subscription_id);
  const r = await call;
  if (!r.ok){
    /* Literal codes rather than one composed from `action`. A vocabulary you
       can grep for is the whole value of a log line, and a code assembled at
       runtime is a code nobody can search for during an incident. */
    log(action === 'cancel' ? 'CANCEL_FAILED code=' + r.code
                            : 'REACTIVATE_FAILED code=' + r.code);
    return { code: 'provider_error', status: 502 };
  }

  /* Re-read rather than believe. The POST above returned a subscription object,
     but the row is written from a fresh read through the one translation
     everything else uses, so a cancellation recorded here says exactly what a
     webhook would have said about the same subscription. */
  const done = await refreshFromProvider(stripe, cfg, sub.provider_subscription_id, uid);
  if (!done.ok){
    /* The provider has accepted the change; only our mirror is behind, and the
       webhook will catch up. Say so rather than implying the cancellation
       failed -- telling an athlete their cancellation did not work when it did
       is how a support ticket becomes a chargeback. */
    log(action === 'cancel' ? 'CANCEL_MIRROR_STALE code=' + done.code
                            : 'REACTIVATE_MIRROR_STALE code=' + done.code);
    return { code: action === 'cancel' ? 'cancelled_mirror_stale' : 'reactivated_mirror_stale',
             status: 200 };
  }
  log((action === 'cancel' ? 'CANCELLED' : 'REACTIVATED') + ' uid=' + ref(uid));
  return { code: action === 'cancel' ? 'cancelled' : 'reactivated', status: 200 };
}

async function handle(req, res){
  const cfg = S.config();

  if (req.method !== 'GET' && req.method !== 'POST'){
    res.setHeader('Allow', 'GET, POST');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const who = await S.verifyUser(req, cfg);
  if (!who.uid){
    log(S.diagLine(who.code, who.diag));
    return S.json(res, 401, { error: 'not_authenticated', code: who.code });
  }

  /* POST acts first, THEN the state is read -- so the answer to "cancel" is the
     state after cancelling rather than the state before it, and the screen does
     not have to make a second request to find out whether anything happened. */
  let outcome = null;
  if (req.method === 'POST'){
    const body = S.readBody(req);
    const action = body && body.action;

    if (action === 'resubscribe'){
      /* GONE, and named. See the header: this was a second purchase path that
         asked none of the questions the real one asks. */
      log('RESUBSCRIBE_RETIRED');
      return S.json(res, 410, { error: 'gone', code: 'USE_CHECKOUT_ENDPOINT',
                                checkout_endpoint: '/api/checkout' });
    }
    if (action === 'agree'){
      /* RECORDING A DECISION, NOT MAKING ONE. The athlete's answer arrives as
         a decision and a type; the VERSION is this server's, the user is the
         token's, and decided_at is when their device says they decided. A
         browser cannot name the wording it is agreeing to -- see
         _agreements.record(). */
      const rec = await Agree.record(cfg, S.sb, who.uid, {
        type: body && body.agreement,
        decision: body && body.decision,
        surface: (body && body.surface) || 'checkout',
        offerCode: (body && body.offer_code) || null,
        decidedAt: (body && body.decided_at) || new Date().toISOString()
      });
      /* 409, not 400, when the refusal is that nothing is published to agree
         to: the request was well formed and the athlete did nothing wrong --
         the server is not in a state where the agreement can exist. */
      outcome = rec.ok
        ? { code: 'agreement_recorded', status: 200 }
        : { code: rec.reason,
            status: rec.reason === 'write_failed' ? 503
                  : rec.reason === 'commercial_terms_not_published' ? 409
                  : rec.reason === 'no_document_in_force' ? 409 : 400 };
    }
    else if (action === 'reconcile')   outcome = await reconcile(req, res, cfg, who.uid, body);
    else if (action === 'cancel')      outcome = await mutateSubscription(req, res, cfg, who.uid, 'cancel');
    else if (action === 'reactivate')  outcome = await mutateSubscription(req, res, cfg, who.uid, 'reactivate');
    else return S.json(res, 400, { error: 'bad_request', code: 'UNKNOWN_ACTION' });

    if (outcome.status >= 400){
      const out = { error: outcome.code };
      if (outcome.provider) out.provider = outcome.provider;
      return S.json(res, outcome.status, out);
    }
  }

  /* One rendering path for both methods, so a screen never has to reconcile two
     shapes of answer. */
  const ent = await A.readEntitlement(S, cfg, who.uid);
  if (!ent.ok){
    log('ENTITLEMENT_READ_FAILED');
    return S.json(res, 503, { error: 'unavailable', code: 'ENTITLEMENT_UNREADABLE' });
  }

  const decision = A.resolveAccess({
    uid: who.uid,
    entitlement: ent.row,
    accountRequired: A.accountRequired(),
    commercialRequired: A.commercialRequired(),
    now: new Date()
  });

  const commercial = await Store.readCommercialFacts(S, cfg, who.uid);
  const live = commercial.ok ? liveSubscriptionOf(commercial, new Date()) : null;

  const evidence = await Agree.purchaseEvidence(cfg, S.sb, who.uid);
  const view = publicView(decision, ent.row, who.uid, who.email, {
    managementProvider: live ? live.provider : null,
    manageableHere: !!(live && live.provider === P.PROVIDER),
    evidence: evidence
  });
  if (outcome) view.result = outcome.code;

  /* 200 either way. A lapsed athlete asking about their own lapse is not an
     error condition, and answering 403 here is what would leave the locked
     shell with nothing to say. */
  return S.json(res, 200, view);
}

module.exports = { handle, publicView, reconcile, mutateSubscription,
                   refreshFromProvider, liveSubscriptionOf };
