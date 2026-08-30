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
const Prod = require('./_products.js');
const P = require('./_stripe.js');
const Store = require('./_commercial-store.js');
const Agree = require('./_agreements.js');

function log(what){ try{ console.log('checkout: ' + what); }catch(e){} }

/* ---------- WHERE THE ATHLETE IS BUYING FROM ----------
 *
 * THE COMMERCIAL LAUNCH IS UNITED KINGDOM ONLY, and this is the line that
 * makes that true rather than aspirational.
 *
 * WHAT STRIPE CANNOT DO, ESTABLISHED BEFORE WRITING THIS. A Checkout Session
 * has no billing-country restriction. `allowed_countries` exists only under
 * shipping_address_collection, and this is a digital subscription with nothing
 * to ship -- collecting a "shipping" address purely to borrow its country
 * dropdown would put a fictional address on every customer record to enforce
 * something it does not actually mean. billing_address_collection takes
 * 'auto' or 'required' and no list. So the gate cannot live in the session
 * parameters, and anything claiming otherwise would be decoration.
 *
 * SO IT LIVES HERE, BEFORE A SESSION EXISTS. The country comes from
 * x-vercel-ip-country, which the platform derives from the connecting IP at
 * the edge. It is not a header the caller can set: Vercel overwrites the
 * forwarded-for chain precisely to stop that, so no query parameter, body
 * field or client-supplied header reaches this decision. A refusal here means
 * no Checkout Session is created at all -- there is nothing to tamper with
 * afterwards because nothing was made.
 *
 * WHAT THIS HONESTLY DOES NOT COVER, said plainly rather than left for
 * somebody to discover: it is a LOCATION gate, not a payment-instrument gate.
 * A VPN presents a UK exit address, and a UK-located athlete may hold a
 * foreign card. Closing that requires a Stripe Radar rule on the card's
 * issuing country, which is dashboard configuration and is reported to the
 * operator rather than done here.
 *
 * FAILS CLOSED. An absent country is refused, with its own code so a
 * deployment that is not supplying the header is diagnosable and never
 * silently becomes "sell to everybody". */
const SUPPORTED_COUNTRIES = ['GB'];

/* Read only from the platform header. Deliberately no fallback to anything a
   caller can influence -- a body field or a query parameter named `country`
   would be exactly the bypass this exists to prevent. */
function countryOf(req){
  const h = (req && req.headers) || {};
  const raw = h['x-vercel-ip-country'] || h['X-Vercel-IP-Country'] || '';
  return String(raw).trim().toUpperCase() || null;
}
function countrySupported(code){
  return SUPPORTED_COUNTRIES.indexOf(String(code || '').toUpperCase()) !== -1;
}

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

  /* 2b. UNITED KINGDOM ONLY, for this launch.
   *
   * Checked before the period, the eligibility rules and the legal evidence,
   * because none of those questions is worth asking somebody we cannot sell
   * to -- and because recording an agreement acceptance for a purchase that
   * was never going to be permitted would put a misleading row in a table
   * whose whole value is that it is accurate.
   *
   * An absent country refuses separately from an unsupported one: the first is
   * a deployment fault and the second is a customer in the wrong country, and
   * a single code for both would send whoever is diagnosing it to the wrong
   * place. */
  /* Normalised HERE as well as in countryOf(), so the pure function is
     robust whoever calls it: a header of "   " is an absent country, not an
     unsupported one, and the two have different causes and different codes. */
  const country = String(o.country == null ? '' : o.country).trim().toUpperCase();
  if (!country) return { ok: false, code: 'country_unavailable', status: 503 };
  if (!countrySupported(country)) return { ok: false, code: 'country_not_supported', status: 403 };

  /* 3. The period, validated against the canonical catalogue rather than a
        list this file keeps of its own -- a second definition of the offering
        is a second thing to keep in step. */
  const offer = Prod.offerForPeriod(o.period);
  if (!offer) return { ok: false, code: 'unknown_billing_period', status: 400 };

  /* 3b. THE LEGAL EVIDENCE, BEFORE THE MONEY.
   *
   * Two agreements have to be on record and current before a card is asked
   * for: acceptance of the Terms in force, and the acknowledgement that the
   * athlete is asking us to begin a digital service inside the statutory
   * cancellation period for a distance contract.
   *
   * ENFORCED HERE RATHER THAN IN A SCREEN. A checkbox is a claim a browser
   * makes; this is the server refusing to open a Checkout Session until the
   * evidence exists in a table nobody can rewrite. That difference is the
   * whole point -- an acknowledgement that can be bypassed by editing a form
   * is not evidence of anything.
   *
   * VERSION-SENSITIVE BY CONSTRUCTION. hasAccepted() compares against the
   * version currently in force, so when a solicitor's revision lands the
   * constant changes, this gate starts refusing, and every athlete is asked
   * again at their next checkout. Nothing has to be migrated and no stale
   * "yes" survives its wording. */
  if (o.evidence && o.evidence.ok !== true){
    const why = (o.evidence && o.evidence.reason) || 'agreements_not_recorded';
    return { ok: false, code: why, status: 409, agreements: {
      terms: !!(o.evidence && o.evidence.terms),
      immediateStart: !!(o.evidence && o.evidence.immediateStart),
      /* Whether the commercial documents exist at all. A screen showing
         "please accept the Terms" when the honest answer is "we have not
         published them yet" would blame the athlete for our own gap. */
      commercialLegalPublished: !(o.evidence && o.evidence.published === false)
    } };
  }

  /* 4. MAY THIS ACCOUNT START A PURCHASE AT ALL?
        Answered by the canonical rule rather than by a second opinion computed
        here. It covers already-subscribed, an administrative grant in force,
        and trial eligibility in one place -- so checkout and the rest of the
        product can never disagree about whether someone may buy.

        A comped athlete is still refused, which is the pre-launch behaviour HQ
        approved; the difference is that the refusal now comes from the same
        rule everything else reads. */
  if (!o.purchaseCheck || o.purchaseCheck.allowed !== true){
    const reason = (o.purchaseCheck && o.purchaseCheck.reason) || 'purchase_not_permitted';
    return {
      ok: false, code: reason, status: reason === 'unavailable' ? 503 : 409,
      existingProvider: (o.purchaseCheck && o.purchaseCheck.existingProvider) || null
    };
  }

  return { ok: true, period: o.period, offerCode: offer.code };
}

/* CAN THE CANONICAL CHECKOUT SELL ANYTHING RIGHT NOW?
 *
 * Asked by the account shell so a "subscribe" control is hidden rather than
 * offered-and-broken, and defined HERE rather than in whichever screen is
 * asking, because "may we take money" has exactly one correct answer and every
 * surface must get the same one.
 *
 * Three things have to be true, and they are three deliberately separate
 * switches: commerce is on, the provider holds a secret, and the catalogue has
 * at least one offer whose price identifier a human has actually configured. An
 * unset price is the commonest way a checkout button 404s at the provider after
 * the athlete has committed. */
function purchasableNow(env){
  const e = env || process.env;
  if (!A.commerceEnabled()) return false;
  if (!P.config(e).hasSecret) return false;
  return Prod.catalogue(P.PROVIDER, e).offers.some(function(o){ return o.available; });
}

async function handle(req, res){
  const cfg = S.config();
  const stripe = P.config();
  const method = String(req.method || 'GET').toUpperCase();

  if (method === 'GET'){
    return S.json(res, 200, {
      catalogue: Prod.catalogue(P.PROVIDER, process.env, new Date()),
      /* The wording and versions a purchase surface must render, from the one
         module that owns them -- so the text an athlete sees and the version
         recorded against their decision cannot come apart. */
      agreements: Agree.currentAgreements(),
      commerce_enabled: A.commerceEnabled(),
      provider_configured: stripe.hasSecret
    });
  }
  if (method !== 'POST') return S.json(res, 405, { error: 'method_not_allowed' });

  const uid = await S.userIdFromRequest(req, cfg);
  const body = await S.readBody(req);

  /* THE PROVIDER HAS TO BE NAMED, and this line is why the endpoint could never
     sell anything. mayStartStandardPurchase() validates the provider it is
     asked about before it looks at a single subscription -- an unnamed one is
     refused as 'unknown_provider', which decideCheckout turned into a 409.
     Every checkout, for every athlete, in every configuration.
     stripeFoundation exercised decideCheckout as a pure function with a
     purchaseCheck handed to it, so the one call site that had to supply the
     argument was the one thing not covered. It is now covered end to end in
     webBilling.test.js.

     The offer travels too, so the canonical rule answers the question actually
     being asked -- "may this athlete buy THIS" -- rather than a weaker one. */
  const offerForBody = Prod.offerForPeriod((body && body.period) || null);

  /* The account IS the athlete. Resolved from the bearer token, never from
     anything the browser sent. */
  const purchaseCheck = uid ? await Store.mayStartStandardPurchase(S, cfg, uid, {
    provider: P.PROVIDER,
    offerCode: offerForBody ? offerForBody.code : null
  }) : null;

  /* Read, never inferred. Nothing the browser sent contributes to this. */
  const evidence = uid ? await Agree.purchaseEvidence(cfg, S.sb, uid) : null;

  const decision = decideCheckout({
    commerceEnabled: A.commerceEnabled(),
    commercialRequired: A.commercialRequired(),
    stripeConfigured: stripe.hasSecret,
    isLiveKey: stripe.isLiveKey,
    uid: uid,
    /* From the platform header only. Never from `body`, which is why it is
       read here rather than alongside the period below. */
    country: countryOf(req),
    period: (body && body.period) || null,
    purchaseCheck: purchaseCheck,
    evidence: evidence,
    now: new Date()
  });

  if (!decision.ok){
    log('REFUSED code=' + decision.code + ' uid=' + P.ref(uid));
    const out = { error: decision.code };
    if (decision.existingProvider) out.existing_provider = decision.existingProvider;
    /* Which half is missing, so a screen can send the athlete to the right
       place rather than saying "something is wrong". */
    if (decision.agreements) out.agreements = decision.agreements;
    return S.json(res, decision.status, out);
  }

  /* The account_commercial row must exist before a subscription can reference
     it. Idempotent by construction. */
  await Store.ensureAccountCommercial(S, cfg, uid);

  const cust = await P.ensureCustomer(stripe, uid, null, null, {});
  if (!cust.ok){
    log('CUSTOMER_FAILED code=' + cust.code);
    return S.json(res, 502, { error: 'provider_error', code: cust.code });
  }

  const session = await P.createCheckoutSession(stripe, {
    uid: uid, accountId: uid, customerId: cust.customerId,
    offerCode: decision.offerCode, env: process.env
  }, { idempotencyKey: 'co:' + uid + ':' + decision.offerCode + ':' + Math.floor(Date.now() / 60000) });

  if (!session.ok){
    log('SESSION_FAILED code=' + session.code);
    return S.json(res, 502, { error: 'provider_error', code: session.code });
  }

  log('SESSION_CREATED uid=' + P.ref(uid) + ' offer=' + decision.offerCode);
  return S.json(res, 200, { url: session.url, period: session.period, trial_days: session.trialDays });
}

module.exports = { handle, decideCheckout, purchasableNow,
                   SUPPORTED_COUNTRIES, countryOf, countrySupported };
