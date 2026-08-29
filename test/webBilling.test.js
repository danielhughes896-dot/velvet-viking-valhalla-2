'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { createFakeSupabase } = require('./fakeSupabase.js');
const S = require('../api/_strava.js');
const A = require('../api/_access.js');
const E = require('../api/_entitlement.js');
const P = require('../api/_stripe.js');
const Prod = require('../api/_products.js');
const account = require('../api/account.js');
const webhook = require('../api/billing-webhook.js');

/* PHASE 2 -- WEB BILLING AND TRIAL ACTIVATION: THE VERIFICATION MATRIX.
 *
 * The suites that came before this one test the PARTS. stripeFoundation covers
 * the adapter's translations, stripeLifecycle drives the webhook against a fake
 * Supabase, commercialCore exercises the store and commercialAuthority pins the
 * one-brain invariants. What none of them do is walk an athlete from a preview
 * they have not paid for through to a subscription they have cancelled, across
 * the real router, with a fake provider on the other end of the wire.
 *
 * That is what this file is, and it is organised as the matrix rather than by
 * module, because the questions it has to answer are journey questions:
 *
 *   NEW ATHLETE       may they see a plan before paying, and does looking cost
 *                     them anything
 *   TRIAL             one per athlete, and the eight ways somebody might try to
 *                     get a second
 *   ACTIVE SUBSCRIBER duplicate purchase, cancellation, reactivation, expiry
 *   PAYMENT FAILURE   what a failed renewal buys, which is nothing
 *   WEBHOOKS          replay, reorder, forgery, silence
 *   BETA              the two live testers, who must notice none of this
 *   SECURITY          what a browser may decide, which is a period and no more
 *   REGRESSION        commerce still off, coaching still untouched
 *
 * WHAT IS NOT PROVEN HERE, SAID PLAINLY. Nothing in this file talks to Stripe.
 * The fake below answers the exact REST shapes _stripe.js sends, which proves
 * our side of the contract and proves nothing about theirs. A real checkout
 * against Stripe's test environment is an OWNER step and is listed as one in
 * PHASE2-WEB-BILLING.md.
 */

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const ATHLETE = '11111111-1111-4111-8111-111111111111';
const OTHER   = '22222222-2222-4222-8222-222222222222';
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const secs = ms => Math.floor(ms / 1000);
const days = n => n * 24 * 3600 * 1000;

const KEY = 'sk_test_1';
const SIGNING = 'whsec';
const PRICE_M = 'price_monthly1';
const PRICE_Y = 'price_yearly1';

// ===========================================================================
// A FAKE STRIPE
//
// Not a mock of our own calls -- a small server that answers the REST paths
// _stripe.js actually sends, in Stripe's shapes and Stripe's units. A mock of
// our calls would pass whatever we wrote; this fails if we send the wrong form
// body, the wrong path or the wrong method, which is most of what an adapter
// can get wrong.
// ===========================================================================
function fakeStripe(){
  const state = { customers: {}, sessions: {}, subscriptions: {}, requests: [] };
  let n = 0;

  function sub(over){
    return Object.assign({
      id: 'sub_1', customer: 'cus_1', status: 'trialing',
      metadata: { vvv_account_id: ATHLETE, vvv_offer: 'STANDARD_MONTHLY', vvv_period: 'monthly' },
      trial_start: secs(T0), trial_end: secs(T0 + days(14)),
      current_period_start: secs(T0), current_period_end: secs(T0 + days(14)),
      cancel_at_period_end: false, canceled_at: null,
      items: { data: [{ price: { recurring: { interval: 'month' } } }] }
    }, over || {});
  }

  async function fetchFn(url, init){
    const u = String(url);
    const method = (init && init.method) || 'GET';
    const body = (init && init.body) || '';
    state.requests.push({ url: u, method: method, body: body,
                          idempotency: (init && init.headers && init['headers']['Idempotency-Key']) || null });

    const ok = data => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
    const bad = (status, code) => ({ ok: false, status: status,
                                     text: async () => JSON.stringify({ error: { code: code } }) });

    if (!/^Bearer sk_/.test(String(init.headers.Authorization))) return bad(401, 'authentication_required');

    if (u.endsWith('/customers') && method === 'POST'){
      const id = 'cus_' + (++n);
      state.customers[id] = { id: id };
      return ok({ id: id });
    }
    if (u.endsWith('/checkout/sessions') && method === 'POST'){
      const form = new URLSearchParams(body);
      const id = 'cs_' + (++n);
      /* The session records what we ASKED for, so a test can assert on the form
         body rather than on our own intent. */
      state.sessions[id] = {
        id: id, url: 'https://checkout.stripe.test/' + id,
        status: 'open', subscription: null,
        client_reference_id: form.get('client_reference_id'),
        metadata: { vvv_account_id: form.get('metadata[vvv_account_id]'),
                    vvv_offer: form.get('metadata[vvv_offer]') },
        form: form
      };
      return ok(state.sessions[id]);
    }
    const cs = /\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/.exec(u);
    if (cs && method === 'GET'){
      const s = state.sessions[cs[1]];
      return s ? ok(s) : bad(404, 'resource_missing');
    }
    const sb = /\/subscriptions\/(sub_[A-Za-z0-9_]+)$/.exec(u);
    if (sb){
      const existing = state.subscriptions[sb[1]];
      if (!existing) return bad(404, 'resource_missing');
      if (method === 'POST'){
        const form = new URLSearchParams(body);
        if (form.has('cancel_at_period_end'))
          existing.cancel_at_period_end = form.get('cancel_at_period_end') === 'true';
        return ok(existing);
      }
      return ok(existing);
    }
    return bad(404, 'resource_missing');
  }

  return {
    state: state, fetchFn: fetchFn, sub: sub,
    /* Complete a session the way paying for it would: Stripe creates the
       subscription and points the session at it. */
    pay(sessionId, over){
      const s = state.sessions[sessionId];
      const id = 'sub_' + (++n);
      state.subscriptions[id] = s
        ? sub(Object.assign({ id: id,
            metadata: { vvv_account_id: s.metadata.vvv_account_id,
                        vvv_offer: s.metadata.vvv_offer,
                        vvv_period: s.form.get('metadata[vvv_period]') } }, over || {}))
        : sub(Object.assign({ id: id }, over || {}));
      if (s){ s.status = 'complete'; s.subscription = id; }
      return state.subscriptions[id];
    },
    put(subscription){ state.subscriptions[subscription.id] = subscription; return subscription; }
  };
}

// ===========================================================================
// THE WORLD
// ===========================================================================
function fakeRes(){
  const out = { statusCode: null, headers: {}, body: null };
  return {
    setHeader(k, v){ out.headers[k.toLowerCase()] = v; },
    status(c){ out.statusCode = c; return this; },
    send(b){ out.body = b; return this; },
    end(b){ out.body = b; return this; },
    result(){ return { status: out.statusCode, headers: out.headers,
                       json: (() => { try{ return JSON.parse(out.body); }catch(e){ return out.body; } })() }; }
  };
}

/* Everything patched in one place and restored in one place, because a test
   that leaks an environment variable makes the NEXT test lie. */
async function withWorld(opts, run){
  const o = opts || {};
  const f = createFakeSupabase(Object.assign({
    account_commercial: [{ account_id: ATHLETE }],
    subscriptions: [], entitlement_grants: [], billing_events: [], entitlements: []
  }, o.seed || {}));
  const stripe = fakeStripe();

  const saved = {
    sb: S.sb, config: S.config, verifyUser: S.verifyUser, uidFrom: S.userIdFromRequest,
    fetch: globalThis.fetch,
    env: {}
  };
  const env = Object.assign({
    STRIPE_SECRET_KEY: KEY,
    STRIPE_WEBHOOK_SECRET: SIGNING,
    VVV_SITE_ORIGIN: 'https://app.test',
    VVV_MARKETING_ORIGIN: 'https://www.test',
    VVV_PRICE_WEB_STANDARD_MONTHLY: PRICE_M,
    VVV_PRICE_WEB_STANDARD_YEARLY: PRICE_Y,
    VVV_COMMERCE_ENABLED: '1',
    VVV_COMMERCIAL_REQUIRED: o.commercialRequired ? '1' : '',
    VVV_ACCOUNT_REQUIRED: '1'
  }, o.env || {});
  Object.keys(env).forEach(k => { saved.env[k] = process.env[k];
    if (env[k] === '') delete process.env[k]; else process.env[k] = env[k]; });

  let signedInAs = o.uid === undefined ? ATHLETE : o.uid;
  S.sb = f.S.sb;
  S.config = () => f.cfg;
  S.verifyUser = async () => signedInAs
    ? { uid: signedInAs, email: 'a@b.test' }
    : { uid: null, code: 'NO_TOKEN', diag: {} };
  S.userIdFromRequest = async () => signedInAs;
  globalThis.fetch = stripe.fetchFn;

  /* THE LEGAL EVIDENCE A REAL ATHLETE WOULD HAVE BY THIS POINT.
     /api/checkout refuses until both agreements are on record, which is the
     production behaviour these journeys are supposed to exercise -- so unless a
     case is specifically about the refusal, it is seeded exactly as ticking the
     two boxes would leave it.

     THE REAL FUNCTIONS DO THE WORK NOW. The commercial documents are published
     (website e2b7e6a), so purchaseEvidence() and currentAgreements() read the
     seeded rows and answer for real -- no stand-in, and nothing here decides
     what the gate would have said.

     A case that wants the WITHDRAWN world passes legalPublished:false and gets
     the same real functions answering for that state, through the publication
     argument they already take. That path has to keep working: it is where the
     product lands the day a document is pulled or superseded, and it stops
     being exercised by accident the moment the gate opens. */
  const Agree = require('../api/_agreements.js');
  const realPurchaseEvidence = Agree.purchaseEvidence;
  const realCurrentAgreements = Agree.currentAgreements;
  const legalPublished = o.legalPublished !== false;

  function agreeAll(uid){
    [['terms', Agree.TERMS_COMMERCIAL_VERSION], ['immediate_start', Agree.IMMEDIATE_START_VERSION]]
      .forEach(function(pair){
        f.db.account_agreements.push({
          id: f.db.account_agreements.length + 1, user_id: uid,
          agreement_type: pair[0], agreement_version: pair[1],
          decision: 'accepted', surface: 'checkout',
          decided_at: new Date(T0).toISOString(), created_at: new Date(T0).toISOString()
        });
      });
  }

  if (!legalPublished){
    Agree.purchaseEvidence = (cfg, sb, uid) => realPurchaseEvidence(cfg, sb, uid, false);
    Agree.currentAgreements = () => realCurrentAgreements(false);
  }
  if (o.agreements !== false){
    agreeAll(o.uid === undefined ? ATHLETE : (o.uid || ATHLETE));
  }

  const api = {
    /* Through the REAL router, so route resolution is part of what is proven. */
    /* THE COUNTRY HEADER IS PART OF A REAL REQUEST, and these journeys are all
       UK purchases. The commercial launch is United Kingdom only and
       /api/checkout fails CLOSED on an absent country, so a fixture sending no
       headers at all was modelling a request no browser makes -- and every one
       of these tests refused with country_unavailable the moment the gate
       landed. Supplying it is correcting the fixture, not relaxing the gate:
       test/ukOnlyCheckout.test.js asserts the refusals, and `country` below
       lets a case send something else on purpose. */
    async call(resource, method, body, opts){
      const res = fakeRes();
      const o = opts || {};
      const headers = {};
      const country = o.country === undefined ? 'GB' : o.country;
      if (country !== null) headers['x-vercel-ip-country'] = country;
      await account({ method: method, url: '/api/account?resource=' + resource,
                      query: { resource: resource }, headers: headers,
                      body: body || {} }, res);
      return res.result();
    },
    async hook(evt, sigOpts){
      const raw = JSON.stringify(evt);
      const so = sigOpts || {};
      const t = so.t == null ? Math.floor(Date.now() / 1000) : so.t;
      const sig = so.header !== undefined ? so.header
        : 't=' + t + ',v1=' + crypto.createHmac('sha256', so.secret || SIGNING)
                                    .update(t + '.' + raw).digest('hex');
      const res = fakeRes();
      await webhook({ method: 'POST', headers: { 'stripe-signature': sig },
                      rawBody: raw, body: JSON.parse(raw) }, res);
      return res.result();
    },
    signInAs(uid){ signedInAs = uid; agreeAll(uid); }
  };

  try{
    return await run({ f: f, stripe: stripe, api: api });
  } finally {
    /* The real gate goes back, always. A harness that could leave it stood
       down would let a later test pass against a world that does not exist. */
    Agree.purchaseEvidence = realPurchaseEvidence;
    Agree.currentAgreements = realCurrentAgreements;
    S.sb = saved.sb; S.config = saved.config;
    S.verifyUser = saved.verifyUser; S.userIdFromRequest = saved.uidFrom;
    globalThis.fetch = saved.fetch;
    Object.keys(saved.env).forEach(k => {
      if (saved.env[k] === undefined) delete process.env[k]; else process.env[k] = saved.env[k];
    });
  }
}

const evt = (id, type, object, atMs) => ({
  id: id, type: type, created: secs(atMs == null ? T0 : atMs), data: { object: object } });

const accountRow = f => f.rows('account_commercial')[0];
const subRow = f => f.rows('subscriptions')[0];
const entRow = f => f.rows('entitlements')[0] || null;
const resolveAt = (f, atMs) => E.resolveStandardEntitlement({
  account: accountRow(f), subscriptions: f.rows('subscriptions'),
  grants: f.rows('entitlement_grants'), now: new Date(atMs) });

// ===========================================================================
// 1. NEW ATHLETE -- VALUE BEFORE PAYMENT
// ===========================================================================
test('a preview costs an athlete nothing, and says so honestly', async () => {
  /* The approved journey puts the personalised plan BEFORE the paywall. That is
     only safe if looking is genuinely free -- if generating a preview spent the
     fortnight, the product would be charging for a decision nobody had made. */
  await withWorld({}, async ({ f, api }) => {
    const before = JSON.stringify(f.rows('account_commercial'));
    const r = await api.call('preview', 'POST', {
      distanceKey: 'marathon', purpose: 'race', weeks: 12, volume: 50,
      activeDays: [1, 3, 5, 0], longRunDay: 0, benchmarkSeconds: 2700
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.trial.available, true);
    assert.equal(r.json.trial.days, Prod.TRIAL_DAYS);
    assert.equal(JSON.stringify(f.rows('account_commercial')), before,
      'seeing a plan must not touch the commercial row');
    assert.equal(f.rows('subscriptions').length, 0);
    assert.equal(f.rows('entitlement_grants').length, 0);
  });
});

test('an athlete who has already used their fortnight is told so on the preview', async () => {
  /* This returned {available:true} unconditionally: a claim about a specific
     athlete made without looking at that athlete. Finding out at the payment
     step is the worst possible moment to learn it. */
  await withWorld({ seed: { account_commercial: [
    { account_id: ATHLETE, trial_consumed_at: new Date(T0 - days(90)).toISOString(),
      trial_consumed_provider: 'web' } ] } }, async ({ api }) => {
    const r = await api.call('preview', 'POST', {
      distanceKey: '10k', purpose: 'race', weeks: 8, volume: 40,
      activeDays: [2, 4, 6], longRunDay: 6, benchmarkSeconds: 2400
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.trial.available, false);
    assert.equal(r.json.trial.reason, 'already_used');
  });
});

/* ---------------------------------------------------------------------------
 * THE PREVIEW COMES BEFORE THE ACCOUNT NOW.
 *
 * The value-first journey puts the personalised plan in front of a prospect who
 * has never signed in, which means /api/preview answers two different questions
 * depending on whether it knows who is asking. Getting that wrong is cheap to
 * do and expensive to notice, because both failures are silent:
 *
 *   hardcoding `available: true`   tells a returning athlete who already spent
 *                                  their fortnight that one is waiting, and
 *                                  they find out at the payment step
 *   resolving eligibility with no  tells every anonymous prospect there is no
 *   uid to resolve it for          trial, on the acquisition surface, to
 *                                  exactly the audience the offer exists for
 *
 * Both of those were live in this repository at different moments. These cases
 * pin the seam between them.
 * ------------------------------------------------------------------------- */
/* THE COMPLETE CANONICAL INPUT SET, as assets/builder-spec.js defines it and
   as /start's nine stages collect it. Deliberately not the minimum this
   endpoint will accept: a commercial test that exercised a stale, smaller
   shape would keep passing after the builder grew a stage, and the first thing
   anybody would learn about the mismatch is that the preview and the real plan
   disagree. Every field here is read back off the build echo below. */
const PREVIEW_BODY = {
  purpose: 'race',                 // 01 objective
  distanceKey: 'marathon',         // 02 distance (an alias, normalised to 'full')
  hasEvent: false, weeks: 12,      // 03 event: "not yet" -> a block length
  volume: 50,                      // 04 current volume
  benchmarkDistanceKey: '10k',     // 05 benchmark distance
  benchmarkSeconds: 2700,          // 05 benchmark time
  goalAmbition: 'B',               // 06 ambition
  activeDays: [1, 3, 5, 0],        // 07 training days
  longRunDay: 0,                   // 08 long run day
  experience: 'experienced'        // 09 coaching depth
};

test('an anonymous prospect gets a plan and is told the trial exists', async () => {
  await withWorld({ uid: null }, async ({ f, api }) => {
    const r = await api.call('preview', 'POST', PREVIEW_BODY);
    assert.equal(r.status, 200, 'the acquisition journey must not require an account');
    assert.ok(r.json.preview, 'and it must actually be their plan');

    assert.equal(r.json.trial.available, true, 'the public offer is real and is stated');
    assert.equal(r.json.trial.days, Prod.TRIAL_DAYS);
    assert.equal(r.json.trial.reason, 'anonymous');
    /* THE FIELD THAT KEEPS THIS HONEST. `resolved: false` says in the payload,
       not in a comment, that nobody looked this athlete up -- because there is
       no athlete. A client that treats it as an eligibility verdict is reading
       a field that told it otherwise. */
    assert.equal(r.json.trial.resolved, false);
  });
});

test('an anonymous preview looks nothing up and changes nothing', async () => {
  await withWorld({ uid: null }, async ({ f, api }) => {
    const before = JSON.stringify(f.db);
    const r = await api.call('preview', 'POST', PREVIEW_BODY);
    assert.equal(r.status, 200);

    /* NO ATHLETE-SPECIFIC ANSWER MAY BE INFERRED WITHOUT A UID, and the proof
       is that the commercial tables were never read. A lookup keyed on null is
       not a lookup; it is a fail-closed answer wearing an athlete's clothes,
       and that is precisely what produced "no trial for you" on the public
       acquisition surface. */
    const commercial = f.calls.filter(c =>
      /account_commercial|subscriptions|entitlement_grants|entitlements/.test(c.path));
    assert.deepEqual(commercial, [], 'an anonymous preview asked the commercial core about somebody');

    assert.equal(JSON.stringify(f.db), before, 'and it wrote nothing at all');
  });
});

test('a signed-in athlete with an unspent allowance is told the truth', async () => {
  await withWorld({}, async ({ api }) => {
    const r = await api.call('preview', 'POST', PREVIEW_BODY);
    assert.equal(r.json.trial.available, true);
    assert.equal(r.json.trial.reason, 'eligible');
    assert.equal(r.json.trial.resolved, true, 'this one WAS resolved against an athlete');
  });
});

test('a signed-in athlete who already subscribes is not offered a trial', async () => {
  /* THE HALF THAT IS EASY TO MISS. trialEligibility() answers one narrow
     question -- has the fortnight been spent -- and a paying subscriber has
     usually never spent it. Reading only that half offers a free trial to a
     customer who is already paying, who presses the button and is refused at
     checkout. Same dishonesty as the hardcoded `true`, from the other side. */
  await withWorld({ seed: { subscriptions: [{
    account_id: ATHLETE, provider: 'web', provider_subscription_id: 'sub_live',
    product_code: 'VALHALLA_STANDARD', offer_code: 'STANDARD_MONTHLY',
    condition: 'active', current_period_end: new Date(Date.now() + days(20)).toISOString()
  }] } }, async ({ api }) => {
    const r = await api.call('preview', 'POST', PREVIEW_BODY);
    assert.equal(r.status, 200, 'they may still rebuild and look at plans');
    assert.equal(r.json.trial.available, false);
    assert.equal(r.json.trial.reason, 'already_subscribed_here',
      'the sentence a screen says must name which half blocked it');
    assert.equal(r.json.trial.resolved, true);
  });
});

test('the preview fails closed when the commercial core cannot be read', async () => {
  await withWorld({}, async ({ api }) => {
    const realSb = S.sb;
    S.sb = async (cfg, p, o) => /account_commercial|subscriptions|entitlement_grants/.test(p)
      ? { ok: false, status: 503, json: async () => null }
      : realSb(cfg, p, o);
    try{
      const r = await api.call('preview', 'POST', PREVIEW_BODY);
      assert.equal(r.status, 200, 'a plan can still be shown');
      assert.equal(r.json.trial.available, false,
        'but no trial is promised that we may not be able to honour');
      assert.equal(r.json.trial.resolved, true);
    } finally { S.sb = realSb; }
  });
});

test('an anonymous "trial available" cannot survive contact with the real athlete', async () => {
  /* THE WHOLE POINT OF `resolved: false`. Presentation is not entitlement, and
     the proof is that the SAME visitor, once they authenticate as an athlete
     who has already had their fortnight, is refused -- by the canonical rule,
     at the door, before a provider is called.
//
     Nothing between the anonymous claim and the refusal can be tampered with to
     change the outcome, because the anonymous claim is not an input to
     anything: it is a sentence on a page. */
  await withWorld({ uid: null, seed: { account_commercial: [
    { account_id: ATHLETE, trial_consumed_at: new Date(T0 - days(90)).toISOString(),
      trial_consumed_provider: 'web' } ] } }, async ({ f, stripe, api }) => {

    const anon = await api.call('preview', 'POST', PREVIEW_BODY);
    assert.equal(anon.json.trial.available, true, 'the public offer said yes');
    assert.equal(anon.json.trial.resolved, false);

    // ...and now they sign in as somebody who has already used theirs.
    api.signInAs(ATHLETE);

    const named = await api.call('preview', 'POST', PREVIEW_BODY);
    assert.equal(named.json.trial.available, false, 'the same page, now resolved, says no');
    assert.equal(named.json.trial.reason, 'already_used');

    /* And the door agrees, which is the part that actually matters: the
       purchase is still permitted -- reactivation must not be blocked forever
       -- but it carries no second fortnight. */
    const may = E.mayStartStandardPurchase({
      account: accountRow(f), subscriptions: [], provider: 'web', now: new Date() });
    assert.equal(may.allowed, true);
    assert.equal(may.trial.eligible, false);
    assert.equal(may.trial.reason, 'already_used');

    /* Proven all the way to the provider: the checkout Stripe is asked for
       still carries fourteen days, because Stripe does not decide who is
       entitled to them -- our allowance does, and it is already spent, so the
       webhook's conditional write will match zero rows. */
    const started = await api.call('checkout', 'POST', { period: 'monthly' });
    assert.equal(started.status, 200);
    const sub = stripe.pay(Object.keys(stripe.state.sessions)[0]);
    await withHook(f, stripe, sub, 'evt_second_go');
    assert.equal(accountRow(f).trial_consumed_at, new Date(T0 - days(90)).toISOString(),
      'the original stamp is untouched -- no second fortnight was granted');
  });
});

test('the value-first journey works end to end, anonymous start to entered app', async () => {
  /* BUILDER -> PREVIEW -> SAVE MY PLAN / AUTH -> TRIAL -> ENTITLEMENT -> APP,
     as one walk, because each leg passing in isolation is what let the preview
     and the commercial core disagree about anonymity in the first place. */
  await withWorld({ uid: null, commercialRequired: true }, async ({ f, stripe, api }) => {
    // 1. A stranger builds a plan and sees it.
    const preview = await api.call('preview', 'POST', PREVIEW_BODY);
    assert.equal(preview.status, 200);
    assert.ok(preview.json.preview.firstWeek, 'they see a real week, not a teaser');
    /* The continuous-build echo main added: the arguments that produced this
       preview, banked so the real plan is the same two engine calls. Phase 2
       must not have dropped it in the merge. */
    assert.ok(preview.json.build, 'the build echo must survive the commercial merge');
    /* THE WHOLE CANONICAL SET COMES BACK, because the app replays these verbatim
       to build the real plan. A commercial merge that quietly dropped one --
       the ambition, the benchmark distance, the coaching depth -- would give the
       athlete a different plan from the one they were shown, and the only
       symptom would be paces that moved after they paid. */
    assert.equal(preview.json.build.purpose, 'race');
    assert.equal(preview.json.build.distanceKey, 'full', 'the alias is normalised');
    assert.equal(preview.json.build.weeks, 12);
    assert.equal(preview.json.build.volume, 50);
    assert.equal(preview.json.build.benchmarkDistanceKey, '10k');
    assert.equal(preview.json.build.benchmarkSeconds, 2700);
    assert.equal(preview.json.build.goalAmbition, 'B');
    assert.deepEqual(preview.json.build.activeDays, [0, 1, 3, 5]);
    assert.equal(preview.json.build.longRunDay, 0);
    assert.equal(preview.json.build.experience, 'experienced');
    assert.equal(preview.json.build.hasEvent, false);
    assert.equal(preview.json.trial.available, true);

    // 2. Save My Plan -- they authenticate. Still nothing bought, nothing spent.
    api.signInAs(ATHLETE);
    assert.equal(accountRow(f).trial_consumed_at, null);

    // 3. They start the trial. One door, server-resolved price.
    const started = await api.call('checkout', 'POST', { period: 'monthly' });
    assert.equal(started.status, 200);
    assert.match(started.json.url, /^https:\/\/checkout\.stripe\.test\//);

    // 4. They pay. The provider tells us, and only then does anything change.
    const sub = stripe.pay(Object.keys(stripe.state.sessions)[0]);
    const applied = await withHook(f, stripe, sub, 'evt_journey');
    assert.equal(applied.json.applied, true);

    // 5. The entitlement is a projection of the facts, not of the redirect.
    assert.equal(accountRow(f).trial_consumed_at, new Date(T0).toISOString());
    assert.equal(subRow(f).condition, 'trialing');
    assert.equal(entRow(f).state, 'trial');

    // 6. And the gate lets them in -- with enforcement ON, which is the whole
    //    point of the walk.
    const decision = A.resolveAccess({
      uid: ATHLETE, entitlement: entRow(f),
      accountRequired: true, commercialRequired: true, now: new Date(T0 + days(3))
    });
    assert.equal(decision.allow, true);
    assert.equal(decision.reason, 'subscription_trial');
  });
});

test('checkout asks for the right price, a card, and fourteen days', async () => {
  await withWorld({}, async ({ stripe, api }) => {
    const r = await api.call('checkout', 'POST', { period: 'yearly' });
    assert.equal(r.status, 200);
    assert.match(r.json.url, /^https:\/\/checkout\.stripe\.test\//);
    assert.equal(r.json.period, 'yearly');
    assert.equal(r.json.trial_days, 14);

    const created = stripe.state.requests.filter(x => /\/checkout\/sessions$/.test(x.url))[0];
    const form = new URLSearchParams(created.body);
    assert.equal(form.get('line_items[0][price]'), PRICE_Y, 'the price comes from configuration');
    assert.equal(form.get('mode'), 'subscription');
    assert.equal(form.get('payment_method_collection'), 'always',
      'a card-free trial is a different product from the one HQ approved');
    assert.equal(form.get('subscription_data[trial_period_days]'), '14');
    assert.equal(form.get('client_reference_id'), ATHLETE);
    assert.equal(form.get('subscription_data[metadata][vvv_account_id]'), ATHLETE,
      'a webhook must be able to rebuild the purchase without the browser');
  });
});

test('an athlete who is not signed in cannot start a checkout', async () => {
  await withWorld({ uid: null }, async ({ stripe, api }) => {
    const r = await api.call('checkout', 'POST', { period: 'monthly' });
    assert.equal(r.status, 401);
    assert.equal(stripe.state.requests.length, 0, 'nothing may reach the provider');
  });
});

// ===========================================================================
// 2. THE TRIAL -- ONE PER ATHLETE, AND THE WAYS ROUND IT
// ===========================================================================
test('the trial is spent when the provider says a trialing subscription exists', async () => {
  await withWorld({}, async ({ f, stripe, api }) => {
    const started = await api.call('checkout', 'POST', { period: 'monthly' });
    assert.equal(started.status, 200);
    assert.equal(accountRow(f).trial_consumed_at, null,
      'reaching the payment screen is not using a trial');

    const sub = stripe.pay(Object.keys(stripe.state.sessions)[0]);
    const r = await api.hook(evt('evt_1', 'customer.subscription.created', sub));
    assert.equal(r.status, 200);
    assert.equal(r.json.applied, true);

    assert.equal(accountRow(f).trial_consumed_at, new Date(T0).toISOString());
    assert.equal(accountRow(f).trial_consumed_provider, 'web');
    assert.equal(subRow(f).condition, 'trialing');
    assert.equal(entRow(f).state, 'trial', 'the projection follows the resolver');
    assert.equal(resolveAt(f, T0 + days(3)).active, true);
    assert.equal(resolveAt(f, T0 + days(15)).active, false);
  });
});

/* THE EIGHT ROUTES TO A SECOND FORTNIGHT.
 *
 * The brief names them and they are the same rule seen from eight angles: the
 * allowance lives on account_commercial and is spent by a write filtered on
 * trial_consumed_at IS NULL. Each case below is a different way of arriving at
 * that write a second time. */
const spent = { account_id: ATHLETE,
  trial_consumed_at: new Date(T0).toISOString(), trial_consumed_provider: 'web' };

test('a duplicate webhook cannot move the allowance forward', async () => {
  await withWorld({}, async ({ f, stripe }) => {
    const sub = stripe.pay(null);
    await withHook(f, stripe, sub, 'evt_1');
    const first = accountRow(f).trial_consumed_at;
    await withHook(f, stripe, sub, 'evt_1');            // the same event id
    await withHook(f, stripe, sub, 'evt_2', T0 + days(2));  // a different one, same facts
    assert.equal(accountRow(f).trial_consumed_at, first,
      'the reference point for the lifetime rule must not drift');
  });
});
async function withHook(f, stripe, sub, id, atMs){
  const raw = JSON.stringify(evt(id, 'customer.subscription.created', sub, atMs));
  const t = Math.floor(Date.now() / 1000);
  const res = fakeRes();
  await webhook({ method: 'POST',
    headers: { 'stripe-signature': 't=' + t + ',v1=' +
      crypto.createHmac('sha256', SIGNING).update(t + '.' + raw).digest('hex') },
    rawBody: raw, body: JSON.parse(raw) }, res);
  return res.result();
}

test('cancelling and coming back does not restore the trial', async () => {
  await withWorld({ seed: { account_commercial: [spent] } }, async ({ f, api }) => {
    const check = await api.call('checkout', 'GET');
    assert.equal(check.status, 200);
    const may = E.mayStartStandardPurchase({
      account: accountRow(f), subscriptions: [], provider: 'web', now: new Date(T0 + days(400)) });
    assert.equal(may.allowed, true, 'reactivation is legitimate and must not be blocked forever');
    assert.equal(may.trial.eligible, false, 'but it does not come with a second fortnight');
    assert.equal(may.trial.reason, 'already_used');
  });
});

test('switching monthly to annual does not restore the trial', async () => {
  await withWorld({ seed: { account_commercial: [spent] } }, async ({ f, stripe }) => {
    const yearly = stripe.pay(null, { id: 'sub_year', status: 'trialing',
      metadata: { vvv_account_id: ATHLETE, vvv_offer: 'STANDARD_YEARLY', vvv_period: 'yearly' },
      trial_start: secs(T0 + days(200)), trial_end: secs(T0 + days(214)) });
    await withHook(f, stripe, yearly, 'evt_year', T0 + days(200));
    assert.equal(accountRow(f).trial_consumed_at, new Date(T0).toISOString(),
      'a different offer is not a different athlete');
  });
});

test('a second account_commercial row cannot be created to hold a second allowance', async () => {
  await withWorld({ seed: { account_commercial: [spent] } }, async ({ f, stripe }) => {
    /* ensureAccountCommercial runs on every apply. It must collide, not insert:
       account_id is the primary key and a second row is the only way the
       lifetime rule could be dodged from inside the application. */
    await withHook(f, stripe, stripe.pay(null), 'evt_x');
    assert.equal(f.rows('account_commercial').length, 1);
    assert.equal(accountRow(f).trial_consumed_at, new Date(T0).toISOString());
  });
});

test('a reconcile racing the webhook spends one allowance between them', async () => {
  /* The reconcile action exists because webhooks are late. Both routes reach
     the same conditional write, so the database arbitrates -- which is the
     whole reason they share _billing-apply.js instead of each doing it. */
  await withWorld({}, async ({ f, stripe, api }) => {
    const started = await api.call('checkout', 'POST', { period: 'monthly' });
    const sessionId = Object.keys(stripe.state.sessions)[0];
    const sub = stripe.pay(sessionId);

    const both = await Promise.all([
      api.call('subscription', 'POST', { action: 'reconcile', session_id: sessionId }),
      withHook(f, stripe, sub, 'evt_race')
    ]);
    assert.equal(both[0].status, 200);
    assert.equal(f.rows('subscriptions').length, 1, 'one subscription, not two');
    const consumed = f.rows('account_commercial').filter(r => r.trial_consumed_at != null);
    assert.equal(consumed.length, 1);
  });
});

test('cancelling during the trial keeps the fortnight and stops the renewal', async () => {
  /* Stripe does not move a subscription to 'cancelled' merely because
     auto-renew was switched off, so the row stays 'trialing' and access runs to
     trial_end. Somebody who tries Valhalla for a week and decides against it
     keeps the week they were promised. */
  await withWorld({}, async ({ f, stripe, api }) => {
    await withHook(f, stripe, stripe.put(stripe.sub({ id: 'sub_t' })), 'evt_1');
    assert.equal(resolveAt(f, T0 + days(3)).reason, 'trial');

    const r = await api.call('subscription', 'POST', { action: 'cancel' });
    assert.equal(r.status, 200);
    assert.equal(subRow(f).condition, 'trialing');
    assert.equal(subRow(f).cancel_at_period_end, true);
    assert.equal(resolveAt(f, T0 + days(13)).active, true, 'the fortnight was promised');
    assert.equal(resolveAt(f, T0 + days(15)).active, false, 'and it does not renew');
  });
});

test('the trial converts to paid without a second decision anywhere', async () => {
  await withWorld({}, async ({ f, stripe }) => {
    await withHook(f, stripe, stripe.sub({ id: 'sub_c' }), 'evt_1');
    assert.equal(entRow(f).state, 'trial');

    await withHook(f, stripe, stripe.sub({ id: 'sub_c', status: 'active',
      current_period_start: secs(T0 + days(14)), current_period_end: secs(T0 + days(44)) }),
      'evt_2', T0 + days(14));

    assert.equal(subRow(f).condition, 'active');
    assert.equal(resolveAt(f, T0 + days(20)).reason, 'paid');
    /* Projected at a stated instant rather than at the suite's wall clock: the
       projection the webhook writes is resolved at real `now`, and pinning a
       lifecycle transition to whatever day the tests happen to run is how a
       suite starts failing in September. */
    assert.equal(E.projectToEntitlementRow(resolveAt(f, T0 + days(20)), null).state, 'active');
    assert.equal(f.rows('subscriptions').length, 1, 'the same relationship, not a new one');
    assert.equal(accountRow(f).trial_consumed_at, new Date(T0).toISOString(),
      'and the allowance is where it was');
  });
});

test('opening checkout twice does not create two subscriptions or spend two trials', async () => {
  await withWorld({}, async ({ f, stripe, api }) => {
    /* Two tabs, or an impatient athlete. Both are allowed to reach Checkout --
       nothing has been bought yet -- and what matters is that only one purchase
       can result. The second refusal comes from the canonical rule the moment
       the first subscription exists. */
    const a = await api.call('checkout', 'POST', { period: 'monthly' });
    const b = await api.call('checkout', 'POST', { period: 'yearly' });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(accountRow(f).trial_consumed_at, null);

    const [first] = Object.keys(stripe.state.sessions);
    await withHook(f, stripe, stripe.pay(first), 'evt_first');

    const c = await api.call('checkout', 'POST', { period: 'yearly' });
    assert.equal(c.status, 409);
    assert.equal(c.json.error, 'already_subscribed_here');
    assert.equal(f.rows('subscriptions').length, 1);
  });
});

test('nothing anywhere in the repository clears a consumed trial', () => {
  /* A trial you can reset is a trial you can farm, so the guarantee is the
     ABSENCE of a code path rather than the correctness of one. */
  const stripComments = x => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f)).forEach(file => {
    const src = stripComments(read('api/' + file));
    assert.ok(!/trial_consumed_at\s*:\s*null/.test(src),
      file + ' writes a null trial_consumed_at, which would hand back the allowance');
    assert.ok(!/trial_consumed_at=not\.is\.null/.test(src) || file === '_commercial-store.js',
      file + ' filters on a consumed trial in a way that could clear it');
  });
});

// ===========================================================================
// 3. AN ACTIVE SUBSCRIBER
// ===========================================================================
test('an athlete who already subscribes cannot buy a second subscription', async () => {
  await withWorld({ seed: { subscriptions: [{
    account_id: ATHLETE, provider: 'web', provider_subscription_id: 'sub_live',
    product_code: 'VALHALLA_STANDARD', offer_code: 'STANDARD_MONTHLY',
    condition: 'active', current_period_end: new Date(Date.now() + days(20)).toISOString()
  }] } }, async ({ stripe, api }) => {
    const r = await api.call('checkout', 'POST', { period: 'yearly' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'already_subscribed_here');
    assert.equal(stripe.state.requests.length, 0, 'the refusal happens before the provider');
  });
});

test('an athlete who subscribes through a store is sent to that store, not sold again', async () => {
  await withWorld({ seed: { subscriptions: [{
    account_id: ATHLETE, provider: 'apple', provider_subscription_id: 'apple_1',
    product_code: 'VALHALLA_STANDARD', condition: 'active',
    current_period_end: new Date(Date.now() + days(20)).toISOString()
  }] } }, async ({ api }) => {
    const r = await api.call('checkout', 'POST', { period: 'monthly' });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'already_subscribed_elsewhere');
    assert.equal(r.json.existing_provider, 'apple');

    /* And it cannot be cancelled from here either -- Apple owns that
       relationship and a button that pretended otherwise would fail silently. */
    const c = await api.call('subscription', 'POST', { action: 'cancel' });
    assert.equal(c.status, 409);
    assert.equal(c.json.error, 'managed_by_apple');
  });
});

test('cancelling stops the renewal and keeps the month that was paid for', async () => {
  await withWorld({}, async ({ f, stripe, api }) => {
    const live = stripe.put(stripe.sub({ id: 'sub_live', status: 'active',
      trial_start: null, trial_end: null,
      current_period_start: secs(T0), current_period_end: secs(T0 + days(30)) }));
    await withHook(f, stripe, live, 'evt_active');
    assert.equal(subRow(f).cancel_at_period_end, false);

    const r = await api.call('subscription', 'POST', { action: 'cancel' });
    assert.equal(r.status, 200);
    assert.equal(r.json.result, 'cancelled');

    assert.equal(subRow(f).cancel_at_period_end, true);
    assert.equal(subRow(f).auto_renew, false);
    assert.equal(subRow(f).condition, 'active',
      'cancelling is stopping the renewal, not ending the subscription');
    assert.equal(resolveAt(f, T0 + days(29)).active, true,
      'confiscating a month somebody bought is how a cancellation becomes a chargeback');
    assert.equal(resolveAt(f, T0 + days(31)).active, false);
  });
});

test('cancelling takes nothing away from the athlete but the renewal', async () => {
  /* Training history is the athlete's. The commercial path may not reach it,
     and the guarantee is structural: no file that can cancel can address the
     tables that hold a plan, an activity or an execution record. */
  const stripComments = x => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ['api/_subscription.js', 'api/_billing-apply.js', 'api/billing-webhook.js', 'api/_stripe.js']
    .forEach(file => {
      const src = stripComments(read(file));
      ['/plans', '/strava_activities', 'DELETE'].forEach(bad =>
        assert.ok(src.indexOf(bad) === -1, file + ' can reach ' + bad));
    });
});

test('an athlete may change their mind before the period runs out', async () => {
  await withWorld({}, async ({ f, stripe, api }) => {
    const live = stripe.put(stripe.sub({ id: 'sub_live', status: 'active',
      trial_start: null, trial_end: null,
      current_period_start: secs(T0), current_period_end: secs(T0 + days(30)),
      cancel_at_period_end: true }));
    await withHook(f, stripe, live, 'evt_cancelled');
    assert.equal(subRow(f).cancel_at_period_end, true);

    const r = await api.call('subscription', 'POST', { action: 'reactivate' });
    assert.equal(r.status, 200);
    assert.equal(r.json.result, 'reactivated');
    assert.equal(subRow(f).cancel_at_period_end, false);
    assert.equal(subRow(f).auto_renew, true);
    assert.equal(f.rows('subscriptions').length, 1,
      'changing your mind is a reversal, not a second purchase');
    assert.equal(f.rows('account_commercial')[0].trial_consumed_at, null,
      'and it does not consume anything');
  });
});

test('a cancelled subscription that runs out stops granting access', async () => {
  await withWorld({}, async ({ f, stripe }) => {
    await withHook(f, stripe, stripe.sub({ id: 'sub_gone', status: 'canceled',
      trial_start: null, trial_end: null,
      current_period_end: secs(T0 + days(30)), canceled_at: secs(T0 + days(30)),
      cancellation_details: { reason: 'cancellation_requested' } }), 'evt_end', T0 + days(30));
    assert.equal(subRow(f).condition, 'expired');
    assert.equal(resolveAt(f, T0 + days(31)).active, false);
    assert.equal(entRow(f).state, 'expired');
  });
});

// ===========================================================================
// 4. PAYMENT FAILURE
// ===========================================================================
test('a failed renewal grants nothing, and a recovered card restores it', async () => {
  await withWorld({}, async ({ f, stripe }) => {
    await withHook(f, stripe, stripe.sub({ id: 'sub_d', status: 'active',
      trial_start: null, trial_end: null,
      current_period_start: secs(T0), current_period_end: secs(T0 + days(30)) }), 'evt_1');
    assert.equal(resolveAt(f, T0 + days(10)).active, true);

    // Stripe has invoiced the next month and been refused.
    await withHook(f, stripe, stripe.sub({ id: 'sub_d', status: 'past_due',
      trial_start: null, trial_end: null,
      current_period_start: secs(T0 + days(30)), current_period_end: secs(T0 + days(60)) }),
      'evt_2', T0 + days(30));
    assert.equal(subRow(f).current_period_end, new Date(T0 + days(30)).toISOString(),
      'paid-through, not invoiced-through');
    assert.equal(subRow(f).grace_period_end, null);
    assert.equal(resolveAt(f, T0 + days(31)).active, false);
    assert.equal(resolveAt(f, T0 + days(31)).reason, 'payment_hold');

    await withHook(f, stripe, stripe.sub({ id: 'sub_d', status: 'active',
      trial_start: null, trial_end: null,
      current_period_start: secs(T0 + days(30)), current_period_end: secs(T0 + days(60)) }),
      'evt_3', T0 + days(32));
    assert.equal(resolveAt(f, T0 + days(33)).active, true);
  });
});

test('a dispute revokes, and revocation outranks every date on the row', async () => {
  await withWorld({}, async ({ f, stripe }) => {
    await withHook(f, stripe, stripe.sub({ id: 'sub_r', status: 'canceled',
      trial_start: null, trial_end: null, current_period_end: secs(T0 + days(300)),
      cancellation_details: { reason: 'payment_disputed' } }), 'evt_dispute');
    assert.equal(subRow(f).condition, 'revoked');
    assert.equal(resolveAt(f, T0 + days(1)).active, false);
    assert.equal(resolveAt(f, T0 + days(1)).reason, 'revoked');
  });
});

test('nothing in the API invents a grace period of its own', () => {
  /* The architecture recovery deleted seven invented days. The rule survives as
     the absence of any constant that ADDS time to what a provider said. */
  const stripComments = x => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f)).forEach(file => {
    const src = stripComments(read('api/' + file));
    assert.ok(!/GRACE_DAYS/.test(src), file + ' declares a grace length of its own');
    assert.ok(!/grace[A-Za-z_]*\s*=\s*new Date\([^)]*\+/.test(src),
      file + ' computes a grace end rather than reading one');
  });
});

// ===========================================================================
// 5. WEBHOOKS
// ===========================================================================
test('an unsigned, missigned or stale delivery changes nothing', async () => {
  await withWorld({}, async ({ f, api, stripe }) => {
    const sub = stripe.sub({ id: 'sub_f' });
    /* No signature header at all is not a Stripe delivery, so it does not reach
       the Stripe verifier: it is refused as an unsupported provider, which is
       the same fail-closed answer by a different door. A header that IS present
       and wrong is a forgery attempt and gets 401. */
    const cases = [
      [{ header: '' }, 501],
      [{ header: 't=1,v1=deadbeef' }, 401],
      [{ secret: 'the-wrong-secret' }, 401],
      [{ t: Math.floor(Date.now() / 1000) - (P.MAX_SKEW_SEC + 60) }, 401]
    ];
    for (const [bad, expected] of cases){
      const r = await api.hook(evt('evt_forged', 'customer.subscription.created', sub), bad);
      assert.equal(r.status, expected, JSON.stringify(bad));
    }
    assert.equal(f.rows('subscriptions').length, 0);
    assert.equal(f.rows('billing_events').length, 0, 'a forgery must not even be claimed');
  });
});

test('a replay answers 200 so the provider stops retrying, and applies nothing twice', async () => {
  await withWorld({}, async ({ f, stripe, api }) => {
    const sub = stripe.sub({ id: 'sub_rep' });
    const first = await api.hook(evt('evt_dup', 'customer.subscription.created', sub));
    assert.equal(first.json.applied, true);
    const again = await api.hook(evt('evt_dup', 'customer.subscription.created', sub));
    assert.equal(again.status, 200);
    assert.equal(again.json.applied, false);
    assert.equal(again.json.reason, 'already_applied');
    assert.equal(f.rows('billing_events').length, 1);
    assert.equal(f.rows('subscriptions').length, 1);
  });
});

test('an out-of-order delivery restates a fact rather than corrupting one', async () => {
  /* Facts, not transitions. A late event simply says what the subscription was
     at the moment it was sent, and the row ends up wherever the newest telling
     put it -- which is why there is no reducer to get out of step. */
  await withWorld({}, async ({ f, stripe, api }) => {
    const newer = stripe.sub({ id: 'sub_o', status: 'active', trial_start: null, trial_end: null,
                               current_period_end: secs(T0 + days(44)) });
    await api.hook(evt('evt_late_arriving_first', 'customer.subscription.updated', newer, T0 + days(14)));
    assert.equal(subRow(f).condition, 'active');

    const older = stripe.sub({ id: 'sub_o' });   // the original trialing state
    await api.hook(evt('evt_older', 'customer.subscription.created', older, T0));
    assert.equal(f.rows('subscriptions').length, 1, 'one purchase, one row, whatever the order');
    assert.equal(f.rows('billing_events').length, 2, 'and both are recorded');
  });
});

test('an event we cannot attribute creates nothing', async () => {
  await withWorld({}, async ({ f, stripe, api }) => {
    const orphan = stripe.sub({ id: 'sub_orphan', metadata: {}, client_reference_id: null });
    const r = await api.hook(evt('evt_orphan', 'customer.subscription.created', orphan));
    assert.equal(r.status, 200);
    assert.equal(r.json.reason, 'unattributable');
    assert.equal(f.rows('subscriptions').length, 0);
    assert.equal(f.rows('billing_events')[0].result, 'unattributable',
      'recorded, so an operator can find it, rather than silently dropped');
  });
});

test('an event naming a different athlete cannot move an existing purchase', async () => {
  /* account_id is the one column on a subscription that is OURS. The DDL says
     so and the store's column list says so -- and until this pass nothing
     enforced it: the upsert merged every column it was handed, so a second
     event for the same subscription carrying different metadata re-pointed
     somebody's purchase at another athlete. One row, no error, and one
     athlete's card paying for another athlete's access.
//
     It was never browser-reachable -- the metadata is ours and changing it
     needs the provider's dashboard -- which is exactly why it survived review
     as a comment rather than a check. */
  await withWorld({}, async ({ f, stripe, api }) => {
    await withHook(f, stripe, stripe.sub({ id: 'sub_m' }), 'evt_1');
    assert.equal(subRow(f).account_id, ATHLETE);

    await api.hook(evt('evt_2', 'customer.subscription.updated',
      stripe.sub({ id: 'sub_m', status: 'active',
        metadata: { vvv_account_id: OTHER, vvv_offer: 'STANDARD_MONTHLY', vvv_period: 'monthly' } }),
      T0 + days(1)));

    assert.equal(f.rows('subscriptions').length, 1,
      'one provider subscription is one row');
    assert.equal(subRow(f).account_id, ATHLETE,
      'and the purchase does not move to whoever the newest payload names');
    assert.equal(subRow(f).condition, 'trialing',
      'the refused event applied nothing at all, not merely the account column');
    assert.equal(f.rows('billing_events').filter(e => e.result === 'account_mismatch').length, 1,
      'recorded, so an operator can see it, rather than silently dropped');
    assert.equal(accountRow(f).trial_consumed_at, new Date(T0).toISOString(),
      'and the allowance stays where it was spent');
  });
});

test('the replay key carries the provider, so two rails cannot collide', async () => {
  /* Apple and Google will feed the same ledger and their event ids are their
     own. A ledger keyed on the id alone would silently drop an Apple event
     because Stripe had used the same string, and the symptom would be a
     purchase that never activated. */
  const ddl = read('supabase-commercial-core.sql');
  assert.match(ddl, /billing_events_provider_identity[\s\S]{0,80}\(provider, provider_event_id\)/,
    'the unique index must be on the PAIR');
  await withWorld({}, async ({ f, stripe, api }) => {
    await api.hook(evt('evt_shared_id', 'customer.subscription.created', stripe.sub({ id: 'sub_p' })));
    const row = f.rows('billing_events')[0];
    assert.equal(row.provider, 'web', 'stripe is never a provider value');
    assert.equal(row.provider_event_id, 'evt_shared_id');
    assert.equal(row.result, 'processed');
  });
});

test('an event type that means nothing to an entitlement is acknowledged and ignored', async () => {
  await withWorld({}, async ({ f, api }) => {
    const r = await api.hook(evt('evt_charge', 'charge.succeeded', { id: 'ch_1' }));
    assert.equal(r.status, 200);
    assert.equal(r.json.applied, false);
    assert.equal(r.json.reason, 'not_entitlement_relevant');
    assert.equal(f.rows('billing_events').length, 0);
  });
});

test('a delivery that is not Stripe is refused, not interpreted', async () => {
  const res = fakeRes();
  await webhook({ method: 'POST', headers: {}, body: { type: 'subscription_started' } }, res);
  const r = res.result();
  assert.equal(r.status, 501);
  assert.equal(r.json.code, 'PROVIDER_NOT_SUPPORTED');
});

// ===========================================================================
// 6. THE BETA COHORT
// ===========================================================================
/* THE SURVIVING ADMINISTRATIVE GRANT. Was admin_beta for the whole of the
   private beta; beta is retired at commercial launch and bears no access, so
   the tests below -- which are about how a GRANT composes with a purchase, not
   about the beta programme -- are written on the grant that still works.
   The retirement itself is asserted immediately after this line. */
const compGrant = { account_id: ATHLETE, source: 'admin_comp',
                    product_code: 'VALHALLA_STANDARD', expires_at: null, revoked_at: null };
const betaGrant = { account_id: ATHLETE, source: 'admin_beta',
                    product_code: 'VALHALLA_STANDARD', expires_at: null, revoked_at: null };

test('a beta athlete is gated once the commercial flag is switched on', async () => {
  /* THE COMMERCIAL LAUNCH, END TO END. This asserted the opposite for the
     whole of the private beta -- it is inverted, not deleted, because the
     inversion is the change, and because an accidental restoration of beta
     access is precisely what this file should refuse to let through.

     Traced the whole way down rather than at one layer: the resolver refuses
     the grant, the projection therefore writes no override, and the delivery
     gate refuses the row it is handed. */
  await withWorld({ commercialRequired: true,
                    seed: { entitlement_grants: [betaGrant] } }, async ({ f }) => {
    const r = resolveAt(f, T0);
    assert.equal(r.active, false, 'a beta grant still opened the product');
    assert.notEqual(r.reason, 'admin_beta');
    const projected = E.projectToEntitlementRow(r, null);
    assert.equal(projected.override, null, 'the projection still wrote a beta override');
    assert.equal(projected.state, 'expired');
    const decision = A.resolveAccess({ uid: ATHLETE, entitlement: projected,
      accountRequired: true, commercialRequired: true, now: new Date(T0) });
    assert.equal(decision.allow, false);
    /* 'expired', not 'no_entitlement': a row exists and it grants nothing,
       which is a different sentence from having no row at all. Both deny. */
    assert.equal(decision.reason, 'expired');
  });
});

test('a stored beta override from before the launch is refused by the gate', async () => {
  /* The rows that already exist. A row written while beta was live still says
     override 'beta', and it is re-projected only when something happens to
     that account -- which may be never. The gate therefore refuses the value
     itself rather than trusting the projection to have stopped writing it. */
  const legacyRow = { state: 'expired', tier: 'standard', access_until: null,
                      override: 'beta', override_expires_at: null };
  const decision = A.resolveAccess({ uid: ATHLETE, entitlement: legacyRow,
    accountRequired: true, commercialRequired: true, now: new Date(T0) });
  assert.equal(decision.allow, false, 'a pre-launch beta row still opened the product');
});

test('a complimentary athlete keeps access when the commercial flag is switched on', async () => {
  /* The grant mechanism itself is unchanged and still has a live user. */
  await withWorld({ commercialRequired: true,
                    seed: { entitlement_grants: [compGrant] } }, async ({ f }) => {
    const r = resolveAt(f, T0);
    assert.equal(r.active, true);
    assert.equal(r.reason, 'admin_comp');
    const projected = E.projectToEntitlementRow(r, null);
    assert.equal(projected.override, 'promo');
    assert.equal(projected.state, 'expired',
      'a grant is not a commercial state, and must not masquerade as one');
    const decision = A.resolveAccess({ uid: ATHLETE, entitlement: projected,
      accountRequired: true, commercialRequired: true, now: new Date(T0) });
    assert.equal(decision.allow, true);
    assert.equal(decision.reason, 'override_promo');
  });
});

test('no beta athlete is silently given a trial or a subscription', async () => {
  await withWorld({ seed: { entitlement_grants: [betaGrant] } }, async ({ f, api }) => {
    await api.call('subscription', 'GET');
    await api.call('checkout', 'GET');
    assert.equal(accountRow(f).trial_consumed_at, null);
    assert.equal(f.rows('subscriptions').length, 0);
    assert.equal(f.rows('entitlement_grants').length, 1,
      'reading an athlete’s state may not change it');
  });
});

test('a granted athlete may buy, and buying does not take the grant away', async () => {
  /* Somebody with complimentary access choosing to subscribe. Both sources
     resolve together and the fold means removing either one later is safe. */
  await withWorld({ seed: { entitlement_grants: [compGrant] } }, async ({ f, stripe, api }) => {
    const started = await api.call('checkout', 'POST', { period: 'monthly' });
    assert.equal(started.status, 200, 'an administrative grant must not block a purchase');

    const sub = stripe.pay(Object.keys(stripe.state.sessions)[0]);
    await withHook(f, stripe, sub, 'evt_beta_buys');

    assert.equal(f.rows('entitlement_grants').length, 1);
    assert.equal(f.rows('entitlement_grants')[0].revoked_at, null, 'the grant is untouched');
    const r = resolveAt(f, T0 + days(2));
    assert.equal(r.active, true);
    const projected = E.projectToEntitlementRow(r, null);
    assert.equal(projected.override, 'promo', 'the grant was taken away by a purchase');
    assert.equal(projected.state, 'trial', 'and now also a subscriber');
  });
});

test('no commercial event touches a beta athlete’s training history', async () => {
  /* The fake database refuses an unknown table outright, so if any commercial
     path reached `plans` or `strava_activities` this would throw rather than
     quietly pass. Combined with the structural check earlier, that is both
     halves of the guarantee: the code cannot name those tables, and nothing it
     runs addresses them. */
  await withWorld({ seed: { entitlement_grants: [betaGrant] } }, async ({ f, stripe, api }) => {
    await api.call('subscription', 'GET');
    await withHook(f, stripe, stripe.put(stripe.sub({ id: 'sub_b' })), 'evt_b');
    await api.call('subscription', 'POST', { action: 'cancel' });

    const touched = f.calls.map(c => c.path.split('?')[0]);
    assert.deepEqual(touched.filter(p => /plans|strava|health/.test(p)), [],
      'a commercial event reached something that is not commercial');
    assert.equal(f.rows('entitlement_grants')[0].revoked_at, null);
  });
});

test('the operator note on a beta row survives every projection', async () => {
  const r = resolveAt({ rows: t => t === 'entitlement_grants' ? [betaGrant] : [] }, T0);
  const projected = E.projectToEntitlementRow(
    E.resolveStandardEntitlement({ account: null, subscriptions: [], grants: [betaGrant], now: new Date(T0) }),
    { override_note: 'founding tester, do not remove' });
  assert.equal(projected.override_note, 'founding tester, do not remove',
    'an operator’s sentence about a human being is not an automated projection’s to rewrite');
});

// ===========================================================================
// 7. SECURITY
// ===========================================================================
test('a non-UK athlete is refused through the real router, and nothing is created', async () => {
  /* THE GATE END TO END, not as a pure function. The commercial launch is
     United Kingdom only; this drives the real account router with a non-UK
     edge country and proves the refusal reaches the caller AND that nothing
     was left behind -- no Stripe session, no customer, no subscription, no
     trial spent. A gate that refused after creating a session would leave a
     payable link in the wild. */
  await withWorld({}, async ({ f, stripe, api }) => {
    const r = await api.call('checkout', 'POST', { period: 'monthly' }, { country: 'US' });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'country_not_supported');
    assert.equal(Object.keys(stripe.state.sessions).length, 0, 'a Checkout Session was created');
    assert.equal(f.rows('subscriptions').length, 0);
    assert.equal(accountRow(f).trial_consumed_at, null, 'a refused purchase spent the trial');
  });
});

test('an absent edge country refuses rather than selling to everybody', async () => {
  /* Fails CLOSED. A deployment that stops supplying the header must not
     quietly become worldwide, and the code says which fault it is. */
  await withWorld({}, async ({ f, stripe, api }) => {
    const r = await api.call('checkout', 'POST', { period: 'monthly' }, { country: null });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, 'country_unavailable');
    assert.equal(Object.keys(stripe.state.sessions).length, 0);
  });
});

test('a UK athlete still completes the purchase through the same router', async () => {
  await withWorld({}, async ({ stripe, api }) => {
    const r = await api.call('checkout', 'POST', { period: 'monthly' }, { country: 'GB' });
    assert.equal(r.status, 200, 'a UK purchase was refused: ' + JSON.stringify(r.body));
    assert.equal(Object.keys(stripe.state.sessions).length, 1);
  });
});

test('a browser may name a period and nothing else', async () => {
  await withWorld({}, async ({ stripe, api }) => {
    const r = await api.call('checkout', 'POST', {
      period: 'monthly',
      /* Everything an attacker would try to smuggle. */
      price: 'price_free', priceMinor: 1, amount: 0, currency: 'XXX',
      trial_period_days: 3650, trialDays: 3650, offerCode: 'STANDARD_YEARLY',
      account_id: OTHER, uid: OTHER, customer: 'cus_someone_else', tier: 'pro'
    });
    assert.equal(r.status, 200);
    const form = new URLSearchParams(
      stripe.state.requests.filter(x => /\/checkout\/sessions$/.test(x.url))[0].body);
    assert.equal(form.get('line_items[0][price]'), PRICE_M);
    assert.equal(form.get('subscription_data[trial_period_days]'), '14');
    assert.equal(form.get('client_reference_id'), ATHLETE);
    assert.equal(form.get('metadata[vvv_offer]'), 'STANDARD_MONTHLY');
    assert.equal(form.get('subscription_data[metadata][vvv_account_id]'), ATHLETE);
    assert.equal(form.get('amount'), null);
    assert.equal(form.get('currency'), null);
  });
});

test('an unrecognised billing period is refused before the provider is called', async () => {
  await withWorld({}, async ({ stripe, api }) => {
    for (const period of ['weekly', 'MONTHLY', '', null, 'monthly ', 42, { toString(){ return 'monthly'; } }]){
      const r = await api.call('checkout', 'POST', { period: period });
      assert.equal(r.status, 400, JSON.stringify(period));
      assert.equal(r.json.error, 'unknown_billing_period');
    }
    assert.equal(stripe.state.requests.length, 0);
  });
});

test('a checkout session belonging to somebody else unlocks nothing', async () => {
  /* The whole point of reconcile: the session id is a LOOKUP KEY, and the facts
     come back from the provider bound to an account we set ourselves. */
  await withWorld({}, async ({ f, stripe, api }) => {
    await api.call('checkout', 'POST', { period: 'monthly' });
    const sessionId = Object.keys(stripe.state.sessions)[0];
    stripe.pay(sessionId);

    api.signInAs(OTHER);
    const r = await api.call('subscription', 'POST', { action: 'reconcile', session_id: sessionId });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'not_your_session');
    assert.equal(f.rows('subscriptions').length, 0, 'nothing was written for the wrong athlete');
  });
});

test('a subscription whose own metadata names somebody else is refused too', async () => {
  /* TWO CHECKS, AND THE SECOND IS NOT REDUNDANT. The session check above stops
     an athlete reconciling somebody else's checkout. This one stops a
     SUBSCRIPTION whose own metadata names a different account from being
     written against the caller -- which is reachable without a session at all,
     because cancel and reactivate go through the same refresh.
//
     It happens for real: a subscription created in the Stripe dashboard rather
     than through our checkout, a metadata field edited by hand, or a purchase
     migrated between accounts. The answer is no, not "attach it to whoever
     asked", because attaching it is how one athlete's card ends up paying for
     another athlete's access.
//
     A mutation pass found this: disabling the check killed nothing, because
     every test that reached it had already been stopped by the session check. */
  await withWorld({}, async ({ f, stripe, api }) => {
    await api.call('checkout', 'POST', { period: 'monthly' });
    const sessionId = Object.keys(stripe.state.sessions)[0];
    const sub = stripe.pay(sessionId);
    // The session still names our athlete; the subscription behind it does not.
    sub.metadata = { vvv_account_id: OTHER, vvv_offer: 'STANDARD_MONTHLY', vvv_period: 'monthly' };

    const r = await api.call('subscription', 'POST', { action: 'reconcile', session_id: sessionId });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'not_your_subscription');
    assert.equal(f.rows('subscriptions').length, 0);
    assert.equal(accountRow(f).trial_consumed_at, null,
      'and it certainly does not spend the caller’s trial');
  });
});

test('the same refusal protects cancel, which never sees a session at all', async () => {
  await withWorld({}, async ({ f, stripe, api }) => {
    const live = stripe.put(stripe.sub({ id: 'sub_live', status: 'active',
      trial_start: null, trial_end: null,
      current_period_start: secs(T0), current_period_end: secs(T0 + days(30)) }));
    await withHook(f, stripe, live, 'evt_live');
    assert.equal(subRow(f).cancel_at_period_end, false);

    /* The row is ours -- readCommercialFacts filters on account_id -- but the
       provider's copy has been re-pointed. The refresh must refuse rather than
       rewrite our row from facts that belong to another account. */
    live.metadata = { vvv_account_id: OTHER, vvv_offer: 'STANDARD_MONTHLY', vvv_period: 'monthly' };

    const r = await api.call('subscription', 'POST', { action: 'cancel' });
    assert.equal(r.status, 200, 'the provider accepted the cancellation, so we do not claim it failed');
    assert.equal(r.json.result, 'cancelled_mirror_stale');
    assert.equal(subRow(f).account_id, ATHLETE, 'and the row was not re-pointed');
  });
});

test('a made-up session id is refused before it becomes a request', async () => {
  await withWorld({}, async ({ stripe, api }) => {
    for (const id of ['', null, 'cs_../../subscriptions/sub_1', 'sub_1', 'cs_' + 'x'.repeat(5) + '?expand=1']){
      const r = await api.call('subscription', 'POST', { action: 'reconcile', session_id: id });
      assert.ok(r.status >= 400, JSON.stringify(id));
    }
    assert.equal(stripe.state.requests.length, 0, 'nothing malformed may reach the provider');
  });
});

test('a returning browser cannot claim access with a query string', () => {
  /* The shell hands the session id to the SERVER and renders whatever the
     server then says. Nothing on the page turns ?checkout=complete into
     access -- the only unlock in the product is /api/app resolving the cookie
     against the entitlement row. */
  const shell = read('account.html');
  assert.match(shell, /action: 'reconcile', session_id: id/,
    'the id must be handed to the server rather than interpreted');
  assert.ok(!/checkout=complete[\s\S]{0,400}(show\('locked'\)|hasAccess\s*=\s*true|access\s*=\s*true)/.test(shell),
    'no branch may treat the return URL as evidence of anything');
  assert.ok(!/localStorage[\s\S]{0,120}(entitle|subscri|paid|access_until)/i.test(shell),
    'and nothing about entitlement may be cached client-side');
});

test('no Stripe secret can reach a browser', () => {
  /* The key lives behind a getter on a server module. Nothing served to a
     browser may name it, and no response body may carry it. */
  ['account.html', 'start.html', 'get.html', 'admin.html', 'privacy.html', 'terms.html']
    .forEach(page => {
      const src = read(page);
      [/sk_live/, /sk_test/, /whsec_/, /STRIPE_SECRET_KEY/, /STRIPE_WEBHOOK_SECRET/]
        .forEach(rx => assert.ok(!rx.test(src), page + ' names ' + rx));
    });
  const cfg = P.config({ STRIPE_SECRET_KEY: 'sk_test_zzz', STRIPE_WEBHOOK_SECRET: 'whsec_zzz' });
  assert.equal(JSON.stringify(cfg).indexOf('sk_test_zzz'), -1,
    'a stringify of the config must not serialise the key');
  assert.equal(JSON.stringify(cfg).indexOf('whsec_zzz'), -1);
});

test('a provider error is reduced to a code, and never echoed with the request in it', async () => {
  await withWorld({ env: { VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_causeserror' } },
    async ({ stripe, api }) => {
      /* Make the provider fail on the session create. */
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (u, i) => /checkout\/sessions$/.test(String(u))
        ? { ok: false, status: 400, text: async () => JSON.stringify({ error: {
              code: 'resource_missing',
              message: 'No such price: price_causeserror; customer cus_1; card 4242' } }) }
        : realFetch(u, i);
      try{
        const r = await api.call('checkout', 'POST', { period: 'monthly' });
        assert.equal(r.status, 502);
        assert.equal(r.json.code, 'stripe_resource_missing');
        assert.equal(JSON.stringify(r.json).indexOf('4242'), -1);
        assert.equal(JSON.stringify(r.json).indexOf('cus_1'), -1);
      } finally { globalThis.fetch = realFetch; }
    });
});

test('an unreadable commercial core refuses a purchase rather than allowing one', async () => {
  await withWorld({}, async ({ f, api }) => {
    const realSb = S.sb;
    S.sb = async (cfg, p, o) => /account_commercial|subscriptions|entitlement_grants/.test(p)
      ? { ok: false, status: 503, json: async () => null }
      : realSb(cfg, p, o);
    try{
      const r = await api.call('checkout', 'POST', { period: 'monthly' });
      assert.equal(r.status, 503);
      assert.equal(r.json.error, 'unavailable',
        'a blocked purchase is an inconvenience; a double subscription is a refund we cannot process');
    } finally { S.sb = realSb; }
  });
});

test('a live key in an uncommissioned deployment refuses to charge anybody', async () => {
  await withWorld({ env: { STRIPE_SECRET_KEY: 'sk_live_notreal', VVV_COMMERCIAL_REQUIRED: '' } },
    async ({ stripe, api }) => {
      const r = await api.call('checkout', 'POST', { period: 'monthly' });
      assert.equal(r.status, 503);
      assert.equal(r.json.error, 'live_key_without_commercial_flag');
      assert.equal(stripe.state.requests.length, 0);
    });
});

test('the environment a subscription was created in is recorded, so sandbox is never production', async () => {
  await withWorld({}, async ({ f, stripe }) => {
    await withHook(f, stripe, stripe.sub({ id: 'sub_env' }), 'evt_env');
    assert.equal(subRow(f).environment, 'sandbox', 'a test key is not production');
    assert.equal(f.rows('billing_events')[0].environment, 'sandbox');
  });
});

// ===========================================================================
// 8. REGRESSION -- WHAT MUST NOT HAVE MOVED
// ===========================================================================
test('commerce is still off unless a deployment says otherwise', () => {
  const saved = { c: process.env.VVV_COMMERCE_ENABLED, r: process.env.VVV_COMMERCIAL_REQUIRED };
  delete process.env.VVV_COMMERCE_ENABLED;
  delete process.env.VVV_COMMERCIAL_REQUIRED;
  try{
    assert.equal(A.commerceEnabled(), false);
    assert.equal(A.commercialRequired(), false);
    /* And with enforcement off, every athlete with an account still gets in --
       which is what makes all of the above deployable without locking anybody
       out on the day it ships. */
    const d = A.resolveAccess({ uid: ATHLETE, entitlement: null,
                                accountRequired: true, commercialRequired: false });
    assert.equal(d.allow, true);
    assert.equal(d.reason, 'pre_commercial');
  } finally {
    if (saved.c === undefined) delete process.env.VVV_COMMERCE_ENABLED; else process.env.VVV_COMMERCE_ENABLED = saved.c;
    if (saved.r === undefined) delete process.env.VVV_COMMERCIAL_REQUIRED; else process.env.VVV_COMMERCIAL_REQUIRED = saved.r;
  }
});

test('the provider vocabulary is still web, apple, google -- and stripe is not one', () => {
  assert.deepEqual(Prod.PROVIDERS, ['web', 'apple', 'google']);
  assert.equal(P.PROVIDER, 'web');
  const stripComments = x => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ['api/_entitlement.js', 'api/_commercial-store.js', 'api/_products.js', 'api/_billing-apply.js']
    .forEach(file => {
      const src = stripComments(read(file));
      [/stripe/i, /customer\.subscription/, /invoice\./]
        .forEach(rx => assert.ok(!rx.test(src),
          file + ' has learned a payment provider’s vocabulary: ' + rx));
    });
});

test('the commercial path cannot reach the coaching engine', () => {
  /* No file added or changed by web billing may import the runtime, and none of
     them may name a coaching concept. Phase 2 is a door; the product is behind
     it and stays behind it. */
  ['api/_stripe.js', 'api/_checkout.js', 'api/_subscription.js', 'api/_billing-apply.js',
   'api/billing-webhook.js', 'api/_commercial-store.js', 'api/_entitlement.js'].forEach(file => {
    const src = read(file);
    assert.ok(src.indexOf('harness.js') === -1, file + ' loads the runtime');
    ['coachDecision', 'buildBlockWeeks', 'VOLUME_BLOCK_GROWTH_CAP', 'playbookAssess',
     'athleteMemory', 'progressionJustification']
      .forEach(sym => assert.ok(src.indexOf(sym) === -1, file + ' names ' + sym));
  });
});

test('the deployment still fits the plan it deploys to', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.ok(fns.length <= 12,
    'web billing must not cost a serverless function: ' + fns.length + ' -- ' + fns.join(', '));
  /* Everything this pass added is a MODULE behind the existing account router,
     which is exactly what the underscore convention is for. */
  ['_billing-apply.js', '_checkout.js', '_subscription.js', '_stripe.js']
    .forEach(m => assert.ok(fs.existsSync(path.join(ROOT, 'api', m)) && m.startsWith('_')));
});

// ---------------------------------------------------------------------------
// CUSTOMER #1 CANNOT AGREE TO THE PRIVATE-BETA DOCUMENTS
//
// The defect these assertions close: checkout asked for acceptance of "the
// Terms of Service" and linked to a document describing a private beta -- no
// subscription, no trial, no cancellation, no refund. A customer could have
// paid against evidence naming a contract that did not describe what they
// bought.
//
// Run against the REAL gate rather than the harness's published-world stand-in
// (agreements:false), so what is proven here is today's actual behaviour.
// ---------------------------------------------------------------------------
test('with no commercial Terms published, checkout refuses and says whose gap it is', async () => {
  await withWorld({ agreements: false, legalPublished: false, commercialRequired: true }, async ({ f, stripe, api }) => {
    const r = await api.call('checkout', 'POST', { period: 'monthly' });

    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'commercial_terms_not_published',
      'not "you have not accepted the Terms" -- the athlete has done nothing wrong');
    assert.equal(r.json.agreements.commercialLegalPublished, false);

    /* AND NOTHING HAPPENED AT THE PROVIDER. The refusal is in front of the
       Checkout Session, not after it: no customer created, no session opened,
       nothing for a webhook to arrive about later. */
    assert.deepEqual(stripe.calls || [], [],
      'the provider must not be touched for a purchase that cannot be evidenced');
  });
});

test('accepting the Terms through the router records the commercial identifier', async () => {
  /* THE ROW A PAYING CUSTOMER LEAVES BEHIND, written by the real handler. The
     browser named no version -- it sent a type and a decision -- and what
     landed is the commercial identifier, never the beta one. That is what
     makes it impossible to end up with evidence pointing at the five-tester
     document, whatever a surface asks for. */
  await withWorld({ agreements: false }, async ({ f, api }) => {
    const r = await api.call('subscription', 'POST',
      { action: 'agree', agreement: 'terms', decision: 'accepted', surface: 'checkout',
        agreement_version: 'terms_v1' });   // a browser trying to name it

    assert.equal(r.status, 200);
    const rows = f.db.account_agreements.filter(x => x.agreement_type === 'terms');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].agreement_version, 'commercial_terms_v1');
    assert.notEqual(rows[0].agreement_version, 'terms_v1',
      'the caller must not be able to name the version it is agreeing to');
    assert.equal(rows[0].privacy_version, 'commercial_privacy_v1',
      'the notice presented alongside, as context rather than consent');
  });
});

test('the immediate-start acknowledgement still stands on its own', async () => {
  /* The website's unpublished Terms are not a reason to tear down an approved
     acknowledgement. It records normally, keeps its own version, and the
     evidence an athlete has already given survives. */
  await withWorld({ agreements: false, legalPublished: false }, async ({ f, api }) => {
    const r = await api.call('subscription', 'POST',
      { action: 'agree', agreement: 'immediate_start', decision: 'accepted', surface: 'checkout' });

    assert.equal(r.status, 200);
    const rows = f.db.account_agreements.filter(x => x.agreement_type === 'immediate_start');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].agreement_version, 'immediate_start_v1');
    assert.equal(rows[0].decision, 'accepted');
  });
});

// ---------------------------------------------------------------------------
// WHAT CUSTOMER #1 IS SHOWN BEFORE THEY HAND OVER A CARD
//
// Run against the published world, because that is the screen that will exist
// the moment the gate opens. Every fact an athlete needs in order to consent
// to a recurring charge, asserted from the payload the screen actually renders
// from -- not from the markup, which could agree with a comment and disagree
// with the server.
// ---------------------------------------------------------------------------
test('the pre-checkout screen carries every fact a purchase decision needs', async () => {
  await withWorld({}, async ({ api }) => {
    const r = await api.call('subscription', 'GET');
    assert.equal(r.status, 200);
    const v = r.json;

    /* THE DOCUMENTS, by canonical URL and by the version that will be
       recorded against the decision. Same payload, so they cannot diverge. */
    const a = v.agreements;
    assert.equal(a.terms.url, 'https://velvetviking.co.uk/terms');
    assert.equal(a.privacy.url, 'https://velvetviking.co.uk/privacy');
    assert.equal(a.terms.version, 'commercial_terms_v1');
    assert.equal(a.privacy.version, 'commercial_privacy_v1');

    /* PRIVACY IS STILL A NOTICE. */
    assert.equal(a.privacy.isConsent, false);
    assert.equal(a.privacy.note, 'notice, not consent');

    /* THE IMMEDIATE-START ACKNOWLEDGEMENT, separate and unticked. */
    assert.equal(a.immediateStart.version, 'immediate_start_v1');
    assert.equal(a.immediateStart.preTicked, false);
    assert.equal(a.immediateStart.mustBeAffirmative, true);
    assert.match(a.immediateStart.text, /begin the service during the 14-day period/);

    /* THE MONEY: both offers, the trial, and the exact date of the first
       charge -- computed by the server so the date on the screen is the date
       the charge falls on. */
    const offers = {};
    v.catalogue.offers.forEach(o => { offers[o.code] = o; });
    assert.equal(offers.STANDARD_MONTHLY.priceMinor, 1199);
    assert.equal(offers.STANDARD_YEARLY.priceMinor, 8999);
    assert.equal(offers.STANDARD_MONTHLY.currency, 'GBP');
    assert.equal(offers.STANDARD_MONTHLY.billingPeriod, 'monthly');
    assert.equal(offers.STANDARD_YEARLY.billingPeriod, 'yearly');
    for (const o of Object.values(offers)){
      assert.equal(o.trialDays, 14);
      assert.ok(o.firstChargeAt, 'the exact first-charge date, not "in 14 days"');
      assert.equal(new Date(o.firstChargeAt) - new Date(v.catalogue.now || Date.now()) > 0, true);
    }

    /* Exactly one product, and no retired tier or founding price on the way
       to the athlete. */
    assert.deepEqual(Object.keys(offers).sort(), ['STANDARD_MONTHLY', 'STANDARD_YEARLY']);
  });
});

test('the £0-today sentence names the amount, the date and the cadence', () => {
  /* The screen composes it, so the screen is where it is checked -- but every
     value in it comes from the payload above rather than from this file. */
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'account.html'), 'utf8');
  assert.match(src, /£0 today\. ' \+ priceAmount\(o\) \+ ' will be taken on ' \+ when/);
  assert.match(src, /unless you cancel before then/, 'cancellation, before the charge');
  assert.match(src, /it renews ' \+\s*\(o\.billingPeriod === 'yearly' \? 'annually' : 'monthly'\) \+ ' until you cancel/);
});
