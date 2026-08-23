'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const W = require('../api/billing-webhook.js');
const A = require('../api/_access.js');

/* ONE DOOR INTO THE ACCESS MODEL.
 *
 * A webhook is the one place where "who is asking" cannot be answered by a
 * session, so it is answered by a signature. Until this pass there were TWO
 * answers to that question in this file's endpoint: Stripe's scheme, and a
 * generic HMAC of our own that led to a completely different implementation --
 * _billing.js's state machine, which PATCHED public.entitlements directly.
 *
 * That second door is gone. It was not merely redundant:
 *
 *   it bypassed resolveStandardEntitlement(), so the row the runtime reads
 *   could say something the subscriptions and grants behind it did not;
 *
 *   and it invented seven days of grace on a failed payment, when the approved
 *   rule is that Valhalla honours provider-supplied grace and adds nothing.
 *
 * These tests are now about the door that remains, the door that is refused,
 * and the guarantee that no third one can be opened by accident. The Stripe
 * path's own behaviour -- claim, upsert, trial, project -- is exercised end to
 * end in stripeLifecycle.test.js against a fake Supabase.
 */

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function res(){
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = c => { r.statusCode = c; return r; };
  r.send = s => { try{ r.body = JSON.parse(s); }catch(e){ r.body = s; } return r; };
  r.end = s => { r.body = s; return r; };
  return r;
}
const req = (over) => Object.assign({ method: 'POST', headers: {}, body: {} }, over || {});

// ---------------------------------------------------------------------------
// THE DOOR THAT IS REFUSED
// ---------------------------------------------------------------------------

test('a delivery without a Stripe signature is refused, not interpreted', async () => {
  const r = res();
  await W(req({ headers: {}, body: { type: 'subscription_started', user_id: 'u1' } }), r);
  assert.equal(r.statusCode, 501);
  assert.equal(r.body.code, 'PROVIDER_NOT_SUPPORTED');
});

test('the old generic secret no longer opens anything', async () => {
  /* The retired path was gated on VVV_BILLING_WEBHOOK_SECRET. Setting it must
     now change nothing at all -- otherwise a stale environment variable on a
     deployed instance quietly re-opens a door this pass closed. */
  const prev = process.env.VVV_BILLING_WEBHOOK_SECRET;
  process.env.VVV_BILLING_WEBHOOK_SECRET = 'still-set-somewhere';
  try{
    const r = res();
    await W(req({
      headers: { 'x-vvv-billing-signature': 'deadbeef', 'x-vvv-billing-timestamp': '1' },
      body: { type: 'subscription_started', user_id: 'u1' }
    }), r);
    assert.equal(r.statusCode, 501);
    assert.equal(r.body.code, 'PROVIDER_NOT_SUPPORTED');
  } finally {
    if (prev === undefined) delete process.env.VVV_BILLING_WEBHOOK_SECRET;
    else process.env.VVV_BILLING_WEBHOOK_SECRET = prev;
  }
});

test('a refused delivery writes nothing, so a forged body cannot reach the database', () => {
  /* Structural, because the behavioural version would need a database to prove
     a negative against. After the Stripe branch returns, the only statement
     left in the handler is the refusal -- there is no code path between the
     header check and the 501 that could touch Supabase. */
  const src = stripComments(read('api/billing-webhook.js'));
  const handler = src.slice(src.indexOf('module.exports = async function handler'));
  const afterStripeBranch = handler.slice(handler.indexOf('STRIPE_SIG_HEADER'));
  assert.ok(!/S\.sb\(/.test(afterStripeBranch),
    'the refusal path must not reach the database');
  assert.ok(/501/.test(afterStripeBranch), 'and it must refuse rather than accept');
});

test('only one method is accepted', async () => {
  const r = res();
  await W(req({ method: 'GET' }), r);
  assert.equal(r.statusCode, 405);
  assert.equal(r.headers.allow, 'POST');
});

// ---------------------------------------------------------------------------
// NO SECOND AUTHORITY CAN COME BACK
// ---------------------------------------------------------------------------

test('the retired second commercial authority is gone from the repository', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'api', '_billing.js')),
    '_billing.js was a second source of commercial truth and must stay retired');
  const apiFiles = fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f));
  apiFiles.forEach(f => assert.ok(!/require\(['"]\.\/_billing\.js['"]\)/.test(read('api/' + f)),
    f + ' still requires the retired billing module'));
});

test('nothing in the api invents a grace period of its own', () => {
  /* The specific number is beside the point -- what must not exist is any
     constant that ADDS time to what a provider said. Grace arrives as a
     timestamp on a subscription row and is read, never computed. */
  const apiFiles = fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f));
  apiFiles.forEach(f => {
    const src = stripComments(read('api/' + f));
    assert.ok(!/GRACE_DAYS/.test(src), f + ' declares a grace length of its own');
    assert.ok(!/grace[A-Za-z]*\s*=\s*new Date\([^)]*\+/.test(src),
      f + ' computes a grace end rather than reading one');
  });
});

test('the webhook writes the projection only through the resolver', () => {
  /* Neither the endpoint nor the shared apply may PATCH or POST /entitlements.
     Both go through syncEntitlementRow, which resolves first and projects
     second -- and the apply module is where the write now lives, because the
     reconcile action needs the identical sequence and a second copy of it would
     be a second commercial authority. */
  ['api/billing-webhook.js', 'api/_billing-apply.js', 'api/_subscription.js'].forEach(f => {
    assert.ok(!/\/entitlements/.test(stripComments(read(f))),
      f + ' must not address the projection table directly');
  });
  assert.ok(/syncEntitlementRow/.test(stripComments(read('api/_billing-apply.js'))),
    'it must go through the resolver');
  assert.ok(/Apply\.applySubscriptionFacts/.test(stripComments(read('api/billing-webhook.js'))),
    'and the endpoint must reach the core through that one implementation');
});

test('the pushed and the pulled route are the same implementation', () => {
  /* A webhook is a notification and notifications are late. So the same facts
     can be PULLED -- _subscription.js's reconcile action fetches the Checkout
     Session and the subscription from the provider with the secret key. What
     must never happen is that the two routes each grow their own idea of what
     a subscription does to the core, because the way they would differ is that
     one of them would spend a trial the other did not. */
  const sub  = stripComments(read('api/_subscription.js'));
  const hook = stripComments(read('api/billing-webhook.js'));
  [sub, hook].forEach(src => assert.ok(/Apply\.applySubscriptionFacts/.test(src)));
  ['upsertSubscription', 'lockAgreedPrice', 'consumeTrialForAccount', 'syncEntitlementRow']
    .forEach(fn => {
      assert.ok(!new RegExp('Store\\.' + fn + '\\(').test(sub),
        'reconcile must not call Store.' + fn + ' itself -- that is the second implementation');
      assert.ok(!new RegExp('Store\\.' + fn + '\\(').test(hook),
        'the webhook must not call Store.' + fn + ' itself either');
    });
});

test('the adapter is the only thing that knows a provider’s vocabulary', () => {
  /* The core every provider will eventually feed must stay free of any single
     provider's words. _billing.js used to be what this guarded; the rule
     followed the authority when the authority moved. */
  const src = stripComments(read('api/_entitlement.js'));
  [/stripe/i, /paddle/i, /revenuecat/i, /lemonsqueezy/i, /invoice\./, /customer\.subscription/]
    .forEach(rx => assert.ok(!rx.test(src),
      'no payment provider\'s vocabulary may become the access model: ' + rx));
});

// ---------------------------------------------------------------------------
// THE BODY
// ---------------------------------------------------------------------------

test('the raw body is preferred over anything the platform re-serialised', () => {
  /* A signature is over bytes. Re-serialising an already-parsed body can
     reorder keys or change spacing, and the signature then fails for a request
     that was never tampered with. */
  const raw = '{"b":1,"a":2}';
  assert.equal(W.rawBodyOf({ rawBody: raw, body: { a: 2, b: 1 } }), raw);
  assert.equal(W.rawBodyOf({ body: { a: 2, b: 1 } }), '{"a":2,"b":1}');
  assert.equal(W.rawBodyOf({}), '{}');
});

// ---------------------------------------------------------------------------
// THE FLAGS THIS ALL SITS BEHIND
// ---------------------------------------------------------------------------

test('the commercial flag is still off unless a deployment says otherwise', () => {
  const prev = process.env.VVV_COMMERCIAL_REQUIRED;
  delete process.env.VVV_COMMERCIAL_REQUIRED;
  try{ assert.equal(A.commercialRequired(), false); }
  finally{ if (prev !== undefined) process.env.VVV_COMMERCIAL_REQUIRED = prev; }
});

test('with the flag off, every athlete with an account still gets in', () => {
  const d = A.resolveAccess({ uid: 'u1', entitlement: null,
                              accountRequired: true, commercialRequired: false });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'pre_commercial');
});
