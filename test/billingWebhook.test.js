'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const W = require('../api/billing-webhook.js');
const A = require('../api/_access.js');

// Phase 3A2. A webhook endpoint is the one door into the access model that is
// opened by somebody else's server, so it is the one place where "who is
// asking" cannot be answered by a session. It is answered by a signature, and
// these tests are about the ways that answer can be forged, replayed or
// skipped.
//
// The other half is behavioural, and it is easy to get exactly backwards: a
// provider reads 5xx as "try again". An endpoint that errors on a duplicate
// therefore receives that duplicate until the provider gives up, and an
// endpoint that answers 200 to something it could not read tells the provider
// to forget an event it should have redelivered. Both are tested.
const SECRET = 'test-secret-not-a-real-one';
const nowSec = () => Math.floor(Date.now() / 1000);

function sign(body, ts, secret){
  return crypto.createHmac('sha256', secret || SECRET)
    .update(String(ts) + '.' + body).digest('hex');
}
const verify = (body, ts, sig, secret, at) =>
  W.verifySignature(body, ts, sig, secret === undefined ? SECRET : secret, at || nowSec());

// ---------------------------------------------------------------------------
// THE SIGNATURE
// ---------------------------------------------------------------------------
test('a correctly signed request is accepted', () => {
  const body = '{"type":"subscription_started"}';
  const ts = nowSec();
  assert.equal(verify(body, ts, sign(body, ts)).ok, true);
});

test('no configured secret means nothing is accepted, not everything', () => {
  const body = '{}'; const ts = nowSec();
  const r = verify(body, ts, sign(body, ts), '');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_configured',
    'an unset secret failing open is the direction this mistake usually goes');
});

test('an unsigned request is refused', () => {
  const ts = nowSec();
  assert.equal(verify('{}', ts, null).ok, false);
  assert.equal(verify('{}', null, 'deadbeef').ok, false);
});

test('a signature from a different secret is refused', () => {
  const body = '{"type":"subscription_ended"}'; const ts = nowSec();
  assert.equal(verify(body, ts, sign(body, ts, 'someone-elses-secret')).ok, false);
});

test('a body edited after signing is refused', () => {
  const body = '{"type":"trial_started","period_end":"2026-07-01T00:00:00Z"}';
  const ts = nowSec();
  const sig = sign(body, ts);
  const tampered = body.replace('2026-07-01', '2036-07-01');
  assert.equal(verify(tampered, ts, sig).ok, false,
    'a decade of free access is what a mutable body buys');
});

test('a captured request cannot be replayed later', () => {
  const body = '{"type":"subscription_started"}';
  const ts = nowSec() - (W.MAX_SKEW_SEC + 60);
  const r = verify(body, ts, sign(body, ts));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'stale_timestamp',
    'the timestamp is inside the signed material precisely so this cannot be re-stamped');
});

test('a signature valid for one timestamp is not valid for another', () => {
  const body = '{"type":"subscription_started"}';
  const ts = nowSec();
  const sig = sign(body, ts);
  assert.equal(verify(body, ts + 1, sig).ok, false);
});

test('a wrong-length signature is refused without throwing', () => {
  const body = '{}'; const ts = nowSec();
  assert.doesNotThrow(() => verify(body, ts, 'abc'));
  assert.equal(verify(body, ts, 'abc').ok, false);
  assert.equal(verify(body, ts, 'abc').reason, 'bad_signature',
    'timingSafeEqual throws on a length mismatch, and throwing would leak the length');
});

test('a non-numeric timestamp is refused', () => {
  assert.equal(verify('{}', 'yesterday', 'x'.repeat(64)).ok, false);
});

test('the comparison is constant time', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'billing-webhook.js'), 'utf8');
  assert.match(src, /timingSafeEqual/,
    'comparing a signature with === leaks it one byte at a time');
});

// ---------------------------------------------------------------------------
// THE ADAPTER
// ---------------------------------------------------------------------------
/* A comment is allowed to NAME the vocabulary it is excluding -- "a provider
   that calls it invoice.payment_failed is normalised at the edge" is the most
   useful sentence in the file. The rule is about code, so the prose is
   stripped before the rule is applied, rather than the prose being reworded to
   dodge a regex. */
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('the adapter is the only thing that knows a provider’s vocabulary', () => {
  const src = stripComments(
    fs.readFileSync(path.join(__dirname, '..', 'api', '_billing.js'), 'utf8'));
  [/stripe/i, /paddle/i, /revenuecat/i, /lemonsqueezy/i, /invoice\./, /customer\.subscription/]
    .forEach(rx => assert.ok(!rx.test(src),
      'no payment provider\'s vocabulary may become the access model: ' + rx));
});

test('normalising keeps only fields the lifecycle understands', () => {
  const ev = W.normaliseEvent({
    type: 'subscription_started', user_id: 'u1', seq: '4',
    period_end: '2026-07-01T00:00:00Z',
    override: 'owner', state: 'active', access_until: '2099-01-01T00:00:00Z',
    capabilities: ['everything']
  });
  assert.equal(ev.seq, 4, 'a string sequence from JSON is still a sequence');
  ['override', 'state', 'access_until', 'capabilities'].forEach(k =>
    assert.ok(!(k in ev), 'a webhook body must not be able to name ' + k));
});

test('a snapshot is normalised to the same closed set', () => {
  const snap = W.normaliseSnapshot({ state: 'active', override: 'owner', event_seq: 99 });
  assert.ok(!('override' in snap), 'granting an override by webhook must be impossible');
  assert.ok(!('event_seq' in snap));
  assert.equal(snap.state, 'active');
});

test('an absent provider is recorded as manual rather than as nothing', () => {
  assert.equal(W.normaliseEvent({ type: 'trial_started' }).provider, 'manual');
});

// ---------------------------------------------------------------------------
// THE BODY THE SIGNATURE COVERED
// ---------------------------------------------------------------------------
test('the raw body is preferred over anything the platform re-serialised', () => {
  const raw = '{"a":1,  "b":2}';
  assert.equal(W.rawBodyOf({ rawBody: raw, body: { a: 1, b: 2 } }), raw,
    'whitespace and key order change the bytes, and the bytes are what was signed');
  assert.equal(W.rawBodyOf({ rawBody: Buffer.from(raw), body: {} }), raw);
  assert.equal(W.rawBodyOf({ body: raw }), raw);
  assert.equal(W.rawBodyOf({ body: { a: 1 } }), '{"a":1}', 'a fallback, and only a fallback');
  assert.equal(W.rawBodyOf({}), '{}');
});

// ---------------------------------------------------------------------------
// WHAT THE HANDLER PROMISES A PROVIDER
// ---------------------------------------------------------------------------
const SRC = fs.readFileSync(path.join(__dirname, '..', 'api', 'billing-webhook.js'), 'utf8');

test('an already-applied event answers 200, or the provider retries it forever', () => {
  assert.match(SRC, /if \(!result\.applied\)\{[\s\S]*?S\.json\(res, 200,[\s\S]*?applied: false/,
    'a duplicate is a normal outcome, not an error');
});

test('a read or write we could not complete answers 5xx, so it IS retried', () => {
  assert.match(SRC, /ENTITLEMENT_UNREADABLE[\s\S]{0,80}/);
  assert.match(SRC, /S\.json\(res, 503, \{ error: 'unavailable', code: 'ENTITLEMENT_UNWRITABLE' \}\)/,
    'answering 200 to a failed write tells the provider to forget the event');
});

test('losing access kills live credentials in the same request', () => {
  assert.match(SRC, /endsAccessNow\(before, result\.next, now\)[\s\S]{0,200}revokeLeasesForUser/,
    'otherwise "revoked" means "revoked within twelve hours"');
});

test('only billing columns are ever written', () => {
  assert.match(SRC, /B\.billingPatch\(result\.next\)/);
  assert.ok(!/override/.test(SRC.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')),
    'the webhook has no business naming an override at all');
});

test('nothing sensitive reaches a log line', () => {
  const logs = [...SRC.matchAll(/log\((.*?)\);/g)].map(m => m[1]).join(' | ');
  /* The values, not the words. A verdict's .reason is a classification --
     unsigned, stale_timestamp, bad_signature -- and logging WHY a request was
     refused is the whole point of having the endpoint observable. What must
     never appear is the material itself. */
  [/email/i, /\bsecret\b/, /req\.headers/, /\braw\b/, /access_token/, /SIGNATURE_HEADER/]
    .forEach(rx => assert.ok(!rx.test(logs), 'log line must not carry ' + rx + ': ' + logs));
  assert.match(SRC, /function ref\(v\)\{ return v \? String\(v\)\.slice\(0, 8\)/,
    'a provider id is somebody\'s customer reference — enough to correlate, never enough to be one');
});

test('the subject comes from the body but is matched against a real row', () => {
  assert.match(SRC, /const ent = await A\.readEntitlement\(S, cfg, subject\)/);
  assert.ok(!/user_id: *body/.test(SRC), 'a body may not assert facts about who it is');
});

// ---------------------------------------------------------------------------
// THE GATE IS NOT WEAKENED BY ANY OF THIS
// ---------------------------------------------------------------------------
test('the commercial flag is still off unless a deployment says otherwise', () => {
  const saved = process.env.VVV_COMMERCIAL_REQUIRED;
  delete process.env.VVV_COMMERCIAL_REQUIRED;
  try{
    assert.equal(A.commercialRequired(), false);
    ['', '0', 'false', 'off', 'no', 'maybe'].forEach(v => {
      process.env.VVV_COMMERCIAL_REQUIRED = v;
      assert.equal(A.commercialRequired(), false, v + ' must not switch on a paywall');
    });
    process.env.VVV_COMMERCIAL_REQUIRED = '1';
    assert.equal(A.commercialRequired(), true);
  } finally {
    if (saved === undefined) delete process.env.VVV_COMMERCIAL_REQUIRED;
    else process.env.VVV_COMMERCIAL_REQUIRED = saved;
  }
});

test('with the flag off, every athlete with an account still gets in', () => {
  const d = A.resolveAccess({ uid: 'u', entitlement: { state: 'expired', access_until: null },
                              accountRequired: true, commercialRequired: false, now: new Date() });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'pre_commercial',
    'shipping the machinery must not be the same act as switching it on');
});
