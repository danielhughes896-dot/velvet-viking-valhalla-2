'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const Prod = require('../api/_products.js');
const Agree = require('../api/_agreements.js');
const Checkout = require('../api/_checkout.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RUNTIME = read(RUNTIME_RELATIVE);
const PINNED = '2026-11-18T09:00:00Z';

// AUDIT REPRO (Final Full Product Audit, Part 17, finding A -- release
// blocker). start.html's #trial click handler POSTed straight to
// /api/checkout with only {period}. decideCheckout() (api/_checkout.js)
// refuses that call with terms_not_accepted/immediate_start_not_acknowledged
// whenever Agree.purchaseEvidence() isn't ok -- but start.html rendered
// ZERO checkboxes and never called the agreement-recording action, and its
// trial-error handler had no case for those two refusal codes. The fix gave
// /start the same two checkboxes account.html renders.
//
// UPDATED (founder, 18 November 2026: "Remove the old start."). /start's
// checkout is gone: the new-subscriber path is now the in-app journey's
// seven-day trial screen, on the website and in the website-distributed
// Android app alike. So the same guarantee is asserted THERE:
//   * the two agreements come from the server's own payload (the same
//     Agree.currentAgreements() /api/checkout and /account serve), never
//     from words kept in the page;
//   * neither box starts ticked, and Start My Free Trial stays disabled until
//     both are recorded;
//   * no Terms box is drawn while the commercial Terms are not published;
//   * a tick records {action:'agree', surface:'checkout'} on the server, and a
//     tick that could not be recorded is unticked again;
//   * the three refusals decideCheckout() returns for missing evidence each
//     get their own sentence and give the athlete a way to resolve them.

function fnSrc(name){
  const at = RUNTIME.indexOf('function ' + name + '(');
  assert.ok(at !== -1, name + '() is missing');
  const open = RUNTIME.indexOf('{', at);
  let depth = 0, i = open;
  for (; i < RUNTIME.length; i++){
    if (RUNTIME[i] === '{') depth++;
    else if (RUNTIME[i] === '}' && --depth === 0) break;
  }
  return RUNTIME.slice(at, i + 1);
}
function mkRes(){
  return { code: null, body: null, headers: {},
    setHeader(k, v){ this.headers[String(k).toLowerCase()] = v; },
    status(s){ this.code = s; return this; },
    send(b){ this.body = b; return this; },
    end(b){ if (b) this.body = b; return this; },
    json(){ return JSON.parse(this.body); } };
}
/* The trial screen, fed what GET /api/checkout really answers. */
async function trialScreen(opts){
  const o = opts || {};
  const saved = {};
  const env = { VVV_COMMERCE_ENABLED: o.commerce === false ? undefined : '1',
                VVV_PRICE_WEB_STANDARD_MONTHLY: 'price_m', VVV_PRICE_WEB_STANDARD_YEARLY: 'price_y' };
  Object.keys(env).forEach(k => { saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; });
  let offer;
  try {
    const res = mkRes();
    await Checkout.handle({ method: 'GET', headers: {} }, res);
    assert.equal(res.code, 200);
    offer = res.json();
  } finally {
    Object.keys(saved).forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  }
  if (o.unpublished) offer.agreements = Object.assign({}, offer.agreements, { commercialLegalPublished: false });
  const a = loadApp({ pinnedDate: PINNED });
  a.showToast = () => {};
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  a.journeyWrite({ v: 1, step: 'trial', built: true, drives: [], slide: 0, period: 'yearly' });
  a.journeyOfferAsked = true;
  a.journeyOffer = offer;
  if (o.native) a.isNativeApp = () => true;
  return { a, offer };
}

test('the trial screen renders the agreements from the server\'s own payload', async () => {
  const { a, offer } = await trialScreen();
  const cur = Agree.currentAgreements();
  assert.equal(JSON.stringify(offer.agreements), JSON.stringify(cur), '/api/checkout serves different agreements');
  const html = a.renderJourneyTrial();
  assert.ok(html.indexOf('href="' + cur.terms.url + '"') !== -1, 'the Terms link is not the server\'s');
  assert.ok(html.indexOf('href="' + cur.privacy.url + '"') !== -1, 'the Privacy link is not the server\'s');
  assert.ok(html.indexOf(a.escapeHtml(cur.immediateStart.text)) !== -1,
    'the immediate-start words recorded against the tick are not on the screen');
  assert.match(html, /data-action="journey-agree" data-kind="terms"/);
  assert.match(html, /data-action="journey-agree" data-kind="immediate_start"/);
});

test('neither box starts ticked, and the trial cannot start until both are recorded', async () => {
  const { a } = await trialScreen();
  let html = a.renderJourneyTrial();
  assert.doesNotMatch(html, /<input[^>]*\schecked[\s>]/, 'a box starts ticked');
  assert.match(html, /data-action="journey-trial-start" disabled/);
  a.journeyAgreed = { terms: true, immediate_start: false };
  assert.match(a.renderJourneyTrial(), /data-action="journey-trial-start" disabled/, 'one tick was enough');
  a.journeyAgreed = { terms: true, immediate_start: true };
  assert.doesNotMatch(a.renderJourneyTrial(), /data-action="journey-trial-start" disabled/);
});

test('no Terms box while the commercial Terms are not published, same as account.html', async () => {
  const { a } = await trialScreen({ unpublished: true });
  const html = a.renderJourneyTrial();
  assert.doesNotMatch(html, /journey-agree/, 'a Terms tickbox is drawn with no commercial Terms behind it');
  assert.match(html, /data-action="journey-trial-start" disabled/, 'the trial can start with nothing agreed');
  assert.match(fnSrc('renderJourneyTrial'), /defs\.commercialLegalPublished !== false/);
});

test('in the website-distributed app the agreements are exactly the website\'s', async () => {
  /* Founder, 18 November 2026: the installed Android app takes payment
     through the same checkout, so the same evidence is asked for. */
  const web = await trialScreen();
  const app = await trialScreen({ native: true });
  const boxes = h => (h.match(/<div class="jr-agree">[^]*?<\/div>\s*(?=<div class="jr-foot">)/) || [''])[0];
  assert.ok(boxes(web.a.renderJourneyTrial()).length > 0);
  assert.equal(boxes(app.a.renderJourneyTrial()), boxes(web.a.renderJourneyTrial()));
});

test('the tick records the decision on the server with surface "checkout", and an unrecorded tick is unticked', async () => {
  const agree = fnSrc('handleJourneyAgree');
  assert.match(agree, /action:'agree', agreement:kind, decision:'accepted', surface:'checkout'/);
  assert.match(agree, /'Authorization':'Bearer '\+cloudSession\.access_token/);

  const { a } = await trialScreen();
  a.cloudSession = { access_token: 't', user_id: 'u', expires_at: Date.now() + 3600e3 };
  const posted = [];
  a.fetch = async (url, o) => {
    if (url === '/api/subscription') posted.push([url, JSON.parse(o.body)]);
    return { status: 500, ok: false, json: async () => ({}) };
  };
  const el = { checked: true, disabled: false, getAttribute: () => 'terms' };
  a.handleJourneyAgree(el);
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.equal(posted.length, 1);
  assert.equal(posted[0][0], '/api/subscription');
  assert.equal(posted[0][1].surface, 'checkout');
  assert.equal(a.journeyAgreed.terms, false, 'a tick the server did not record still counts');
  assert.match(a.journeyTrialNote, /We could not record that just now/);
});

test('each missing-evidence refusal has its own sentence and leaves a way to resolve it', async () => {
  const copy = /var JOURNEY_CHECKOUT_COPY = \{([^]*?)\n\};/.exec(RUNTIME)[1];
  ['terms_not_accepted', 'immediate_start_not_acknowledged', 'commercial_terms_not_published']
    .forEach(code => assert.match(copy, new RegExp(code + ':'),
      'the trial screen falls through to a generic error for ' + code));
  assert.match(fnSrc('handleJourneyTrialStart'), /We could not open the payment page/,
    'the generic sentence must still be the last resort for an unknown code');

  for (const [code, kind] of [['terms_not_accepted', 'terms'], ['immediate_start_not_acknowledged', 'immediate_start']]){
    const { a } = await trialScreen();
    a.journeyAgreed = { terms: true, immediate_start: true };
    a.journeyWebCheckout = () => Promise.resolve({ ok: false, code });
    a.renderApp = () => {};
    a.handleJourneyTrialStart();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    assert.equal(a.journeyAgreed[kind], false, code + ' left the box ticked, so there was nothing to do');
    const html = a.renderJourneyTrial();
    assert.match(html, new RegExp('data-kind="' + kind + '"(?![^>]*checked)'), code + ' did not draw the box again');
    assert.match(html, /Please tick both boxes above before continuing\./);
  }
  const { a } = await trialScreen();
  a.journeyAgreed = { terms: true, immediate_start: true };
  a.journeyWebCheckout = () => Promise.resolve({ ok: false, code: 'commercial_terms_not_published' });
  a.renderApp = () => {};
  a.handleJourneyTrialStart();
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.equal(a.journeyOfferAsked, false, 'the agreements are not read again');
  assert.deepEqual(JSON.parse(JSON.stringify(a.journeyAgreed)), { terms: false, immediate_start: false });
  assert.equal(Prod.TRIAL_DAYS, 7);
});
