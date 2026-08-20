// Velvet Viking -- starting a subscription.
//
//   POST /api/checkout   Authorization: Bearer <supabase access token>
//                        { period: "monthly" | "yearly" }
//                        -> { url } to send the browser to
//   GET  /api/checkout   -> what is on offer, and whether it is purchasable
//
// A RESOURCE, NOT A FUNCTION. Vercel counts every non-underscore file in /api
// as a deployable function and the plan allows twelve, of which twelve are
// used. This mounts on the existing /api/account router alongside
// subscription, account-data and account-delete -- the same pattern, each
// concern in its own module. That is reuse of an established seam, not a
// mega-handler: the router still does nothing but choose.
//
// WHAT THE BROWSER MAY DECIDE
//   the PERIOD, and only by naming one of two words that are validated against
//   an allow-list before anything else happens.
//
// WHAT THE BROWSER MAY NOT DECIDE
//   the price, the amount, the currency, the trial length, the customer, the
//   tier, or whether it is entitled to any of them. Every one of those is
//   resolved server-side from configuration and from the authenticated user.

'use strict';

const S = require('./_strava.js');
const A = require('./_access.js');
const C = require('./_commerce.js');
const P = require('./_stripe.js');
const L = require('./_ledger.js');

function log(what){ try{ console.log('checkout: ' + what); }catch(e){} }

/* ---------- the decision, as a pure function ----------
   Separated from the IO so the suite can exercise every refusal without a
   Supabase, a Stripe or a network. */
function decideCheckout(input){
  const o = input || {};

  /* 1. Commerce must be switched on deliberately. A Stripe key existing is not
        consent to charge anybody -- the same discipline _access.js applies to
        the account gate, for the same reason. */
  if (!o.commerceEnabled) return { ok: false, code: 'commerce_disabled', status: 503 };

  /* 2. A live key in a deployment that has not been commissioned is a
        configuration accident, and the safe reading of an accident involving
        real money is to refuse. */
  if (o.isLiveKey && !o.commercialRequired) return { ok: false, code: 'live_key_without_commercial_flag', status: 503 };

  if (!o.stripeConfigured) return { ok: false, code: 'provider_not_configured', status: 503 };
  if (!o.uid) return { ok: false, code: 'not_signed_in', status: 401 };

  /* 3. The period, validated against the allow-list. */
  if (!C.isPeriod(o.period)) return { ok: false, code: 'unknown_billing_period', status: 400 };

  /* 4. A COMP IS NOT A SUBSCRIPTION, and it is checked FIRST -- before the
        generic already-entitled branch -- because an override grants live
        access and would otherwise be reported as an ordinary paid subscriber.
        A beta athlete pressing subscribe is asking a question nobody has
        decided the answer to yet, and the answer they get should say so. */
  const ent = o.entitlement;
  if (ent && A.overrideOf && ent.override && A.hasLiveAccess({ override: ent.override,
        override_expires_at: ent.override_expires_at }, o.now)) {
    return { ok: false, code: 'comped_access', status: 409, override: ent.override };
  }

  /* 5. ALREADY ENTITLED. The product policy for what a paying athlete should
        SEE here is not settled, so the infrastructure takes the conservative
        reading: it refuses, names the reason, and creates no second
        subscription. A duplicate charge is far more expensive to unwind than a
        refused button is to explain. */
  if (ent && A.hasLiveAccess(ent, o.now)) {
    return { ok: false, code: 'already_entitled', status: 409,
             state: ent.state, access_until: ent.access_until || null };
  }

  return { ok: true, period: o.period };
}

async function handle(req, res){
  const cfg = S.config();
  const stripe = P.config();
  const method = String(req.method || 'GET').toUpperCase();

  if (method === 'GET'){
    /* What is on offer. Safe unauthenticated: prices are public and the
       `configured` booleans say only whether a price id has been set. */
    return S.json(res, 200, {
      offering: C.publicOffering(function(period){ return P.priceFor(period).ok; }),
      commerce_enabled: A.commerceEnabled(),
      provider_configured: stripe.hasSecret
    });
  }
  if (method !== 'POST') return S.json(res, 405, { error: 'method_not_allowed' });

  const uid = await S.userIdFromRequest(req, cfg);
  const body = await S.readBody(req);
  const ent = uid ? await L.entitlementOf(cfg, uid) : null;

  const decision = decideCheckout({
    commerceEnabled: A.commerceEnabled(),
    commercialRequired: A.commercialRequired(),
    stripeConfigured: stripe.hasSecret,
    isLiveKey: stripe.isLiveKey,
    uid: uid,
    period: (body && body.period) || null,
    entitlement: ent,
    now: new Date()
  });

  if (!decision.ok){
    log(decision.code + ' uid=' + P.ref(uid));
    const out = { error: decision.code };
    if (decision.access_until) out.access_until = decision.access_until;
    if (decision.state) out.state = decision.state;
    if (decision.override) out.override = decision.override;
    return S.json(res, decision.status, out);
  }

  /* The Stripe customer for this athlete, reused when one already exists. The
     mapping is stored against the user id, so a returning athlete never
     acquires a second customer record. */
  const existing = await L.customerIdOf(cfg, uid);
  const cust = await P.ensureCustomer(stripe, uid, (ent && ent.email) || null, existing, {});
  if (!cust.ok){
    log('customer_failed ' + cust.code);
    return S.json(res, 502, { error: 'provider_error', code: cust.code });
  }
  if (cust.created) await L.rememberCustomer(cfg, uid, cust.customerId);

  const session = await P.createCheckoutSession(stripe, {
    uid: uid, customerId: cust.customerId, period: decision.period, env: process.env
  }, { idempotencyKey: 'co:' + uid + ':' + decision.period + ':' + Math.floor(Date.now() / 60000) });

  if (!session.ok){
    log('session_failed ' + session.code);
    return S.json(res, 502, { error: 'provider_error', code: session.code });
  }

  log('session_created uid=' + P.ref(uid) + ' period=' + decision.period);
  return S.json(res, 200, {
    url: session.url, period: session.period, trial_days: session.trialDays
  });
}

module.exports = { handle, decideCheckout };
