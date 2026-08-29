'use strict';
/* THE STRIPE BILLING PORTAL — WHERE AN ATHLETE CANCELS
 * ===========================================================================
 * WHY THIS EXISTS AT ALL. Settings could describe a subscription and could
 * start one, and the one thing it could not do was end one: `manage_url` was
 * read by the card and written by nothing, so every paying athlete fell
 * through to a mailto. A subscription with no self-service cancellation is not
 * a finished product, and in the UK it is not a lawful one either.
 *
 * WHY A SESSION AND NOT A URL IN THE PAYLOAD. A portal link authenticates
 * whoever holds it. Putting one in the /api/subscription response would put a
 * bearer credential into a body that a browser may cache, an athlete may
 * screenshot and a support ticket may quote. It is minted on a press instead,
 * once, and it expires.
 *
 * THE CUSTOMER IS NEVER SUPPLIED BY THE BROWSER. There is no customer id
 * parameter anywhere in this file, deliberately: a parameter naming somebody
 * else's Stripe customer is the whole attack. The id is read from the
 * athlete's own live subscription row, found by the uid on the bearer token.
 *
 * WHAT THIS DOES NOT DO. It does not decide access, it does not write
 * entitlement, and it does not cancel anything itself. Stripe owns the
 * cancellation; the webhook tells us it happened; _billing-apply.js is what
 * moves the entitlement. This file opens a door and nothing else. */

const S = require('./_strava.js');
const P = require('./_stripe.js');
const A = require('./_access.js');
const Store = require('./_commercial-store.js');
const E = require('./_entitlement.js');

function log(what){ try{ console.log('portal: ' + what); }catch(e){} }

/* Where Stripe sends the athlete back to. The app's own origin, from the same
   variable checkout already uses -- never anything the browser sent, because a
   return_url the caller chooses is an open redirect with a Stripe logo on it. */
function returnUrl(stripe){
  const origin = stripe.appOrigin || '';
  return origin ? origin + '/account?portal=returned' : null;
}

/* The athlete's own subscription that a portal could act on: one this
   deployment sold, through this provider, that still means something
   commercially. A store purchase is Apple's or Google's to cancel and is
   refused here rather than sent to the wrong company's portal. */
function portableSubscription(facts, now){
  const subs = (facts && facts.subscriptions) || [];
  const at = now || new Date();
  return subs.filter(function(s){
    return s && s.provider === P.PROVIDER && s.provider_customer_id &&
           E.isBlockingCommercial(s, at);
  })[0] || null;
}

async function handle(req, res){
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }

  const cfg = S.config();
  const stripe = P.config();

  if (!A.commerceEnabled()) return S.json(res, 503, { error: 'unavailable', code: 'commerce_disabled' });
  if (!stripe.hasSecret)    return S.json(res, 503, { error: 'unavailable', code: 'provider_not_configured' });
  if (!cfg.serviceKey)      return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });

  const back = returnUrl(stripe);
  if (!back) return S.json(res, 503, { error: 'unavailable', code: 'origin_not_configured' });

  const uid = await S.userIdFromRequest(req, cfg);
  if (!uid) return S.json(res, 401, { error: 'not_authenticated', code: 'not_signed_in' });

  const facts = await Store.readCommercialFacts(S, cfg, uid);
  if (!facts || facts.ok === false) return S.json(res, 503, { error: 'unavailable', code: 'read_failed' });

  const sub = portableSubscription(facts, new Date());
  if (!sub) return S.json(res, 409, { error: 'conflict', code: 'nothing_to_manage' });

  const made = await P.createPortalSession(stripe, {
    customerId: sub.provider_customer_id,
    returnUrl: back
  });
  if (!made.ok){
    log('SESSION_FAILED code=' + made.code);
    return S.json(res, 502, { error: 'provider_error', code: made.code || 'portal_unavailable' });
  }
  log('SESSION uid=' + P.ref(uid));
  return S.json(res, 200, { url: made.url });
}

module.exports = { handle, portableSubscription, returnUrl };
