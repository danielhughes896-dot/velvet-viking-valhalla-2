// Velvet Viking -- Phase 3A2: what the athlete may be told about their own
// subscription, and how they start paying again.
//
//   GET  /api/subscription   Authorization: Bearer <supabase access token>
//                            -> the athlete's own state, for rendering
//   POST /api/subscription   { action: "resubscribe" }
//                            -> where to go to pay
//
// WHY THIS IS NOT /api/session. That endpoint mints the delivery lease, and it
// answers 403 when access has ended -- which is correct, and which is exactly
// why it cannot also be the endpoint that tells a LAPSED athlete what happened
// to them. The locked shell needs an endpoint that answers 200 while saying
// "you have no access", because "why can I not get in, and what do I do about
// it" is a question only an athlete without access ever asks.
//
// NOTHING HERE IS AUTHORITATIVE. It renders. /api/app re-resolves the same
// decision server-side from the cookie before it hands over a byte of runtime,
// so an athlete who edits this response has changed a sentence on a screen.
//
// NO PAYMENT PROVIDER IS INTEGRATED. Checkout is a URL read from the
// environment, because choosing and configuring a provider is a commercial
// decision and not a code one. Until one is set, this says so honestly rather
// than pretending a button will work.

const S = require('./_strava.js');
const A = require('./_access.js');

function log(what){ try{ console.log('subscription: ' + what); }catch(e){} }

/* Everything an account screen needs and not one field more. No provider
   customer id, no subscription id, no event sequence: those are operational
   plumbing, they identify the athlete to a third party, and a screen that
   shows them invites a support conversation about them. */
function publicView(decision, ent, uid, email){
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
    checkout_configured: !!checkoutUrl()
  };
}

function checkoutUrl(){ return (process.env.VVV_CHECKOUT_URL || '').trim(); }

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

  if (req.method === 'GET'){
    /* 200 either way. A lapsed athlete asking about their own lapse is not an
       error condition, and answering 403 here is what would leave the locked
       shell with nothing to say. */
    return S.json(res, 200, publicView(decision, ent.row, who.uid, who.email));
  }

  const body = S.readBody(req);
  if (body.action !== 'resubscribe'){
    return S.json(res, 400, { error: 'bad_request', code: 'UNKNOWN_ACTION' });
  }

  const url = checkoutUrl();
  if (!url){
    /* Honest rather than broken. A button that opens nothing is worse than a
       sentence explaining that payments are not open yet. */
    log('CHECKOUT_NOT_CONFIGURED');
    return S.json(res, 503, { error: 'unavailable', code: 'CHECKOUT_NOT_CONFIGURED' });
  }
  /* The athlete's own id travels so the provider can hand it back on the
     webhook and the payment lands on the right row. An email address does
     not: the provider collects its own, and there is no reason for one to
     ride in a URL that ends up in browser history. */
  const sep = url.indexOf('?') === -1 ? '?' : '&';
  log('CHECKOUT_ISSUED');
  return S.json(res, 200, {
    checkout_url: url + sep + 'client_reference_id=' + encodeURIComponent(who.uid)
  });
};

module.exports = { handle, publicView, checkoutUrl };
