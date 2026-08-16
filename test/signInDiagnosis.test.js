'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

// A physical Pixel, on a working network, tapped "Email me a sign-in link" and
// was told to check its connection. The connection was fine.
//
// /api/beta-signin can fail six materially different ways and only ONE of them
// is a connection problem, but every one except a refused address was reported
// as though it were. That is what made the first real device sign-in
// undiagnosable -- and the app loading normally is not evidence against a
// server fault, because delivery does not need the Supabase service key while
// the account gate is off. "The app works but sign-in says check your
// connection" is exactly the shape a server-side outage takes.
//
// These tests pin that each failure is now told apart, and that the connection
// message is reserved for the one case where the request never completed.
const app = () => loadApp({ pinnedDate: '2026-03-11T09:00:00Z' });

/* Answer /api/beta-signin however the scenario needs, and capture the toast. */
function withServer(a, respond) {
  const toasts = [];
  a.showToast = m => toasts.push(m);
  a.fetch = (url, opts) => {
    if (!/\/api\/beta-signin$/.test(String(url))) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    return respond(opts);
  };
  a.document.getElementById = () => ({ value: 'tester@example.com' });
  return toasts;
}
const httpFail = (status, body) => () =>
  Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });
const settle = () => new Promise(r => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// THE ONE CASE THAT IS REALLY A CONNECTION PROBLEM
// ---------------------------------------------------------------------------
test('only a request that never completed blames the connection', async () => {
  const a = app();
  const toasts = withServer(a, () => Promise.reject(new TypeError('Failed to fetch')));
  a.handleCloudSignIn();
  await settle();
  assert.match(toasts.join(' '), /check your connection/i,
    'radio off, no DNS, TLS refused — here the advice is true');
});

test('a server that answered is never reported as a connection problem', async () => {
  const cases = [
    [503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' }],
    [503, { error: 'unavailable', code: 'ALLOWLIST_UNREADABLE' }],
    [502, { error: 'send_failed' }],
    [400, { error: 'bad_email' }],
    [405, { error: 'method_not_allowed' }],
    [404, {}],
  ];
  for (const [status, body] of cases) {
    const a = app();
    const toasts = withServer(a, httpFail(status, body));
    a.handleCloudSignIn();
    await settle();
    assert.ok(!/check your connection/i.test(toasts.join(' ')),
      status + ' answered, so the network is demonstrably fine: ' + toasts.join(' '));
  }
});

// ---------------------------------------------------------------------------
// EACH FAILURE IS TOLD APART
// ---------------------------------------------------------------------------
test('the server being unable to reach Supabase says so, in plain words', async () => {
  const a = app();
  const toasts = withServer(a, httpFail(503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' }));
  a.handleCloudSignIn();
  await settle();
  assert.match(toasts.join(' '), /can’t reach its sign-in service/i);
  assert.ok(!/tester list|email address/i.test(toasts.join(' ')),
    'it is not the athlete’s address that is wrong');
});

test('a refused address still gets the truth about the beta', async () => {
  const a = app();
  const toasts = withServer(a, httpFail(403, { error: 'not_in_beta' }));
  a.handleCloudSignIn();
  await settle();
  assert.match(toasts.join(' '), /private beta/i);
});

test('a malformed address is distinguished from everything else', async () => {
  const a = app();
  const toasts = withServer(a, httpFail(400, { error: 'bad_email' }));
  a.handleCloudSignIn();
  await settle();
  assert.match(toasts.join(' '), /doesn’t look like an email address/i);
});

test('an email the provider refused to send is its own case', async () => {
  const a = app();
  const toasts = withServer(a, httpFail(502, { error: 'send_failed' }));
  a.handleCloudSignIn();
  await settle();
  assert.match(toasts.join(' '), /couldn’t be sent/i);
  assert.ok(!/check your connection/i.test(toasts.join(' ')));
});

test('every code maps to distinct athlete-facing copy', () => {
  const a = app();
  const codes = ['not_in_beta', 'bad_email', 'unavailable', 'send_failed', 'offline'];
  const seen = codes.map(c => a.signInErrorCopy(c));
  assert.equal(new Set(seen).size, codes.length,
    'two different faults sharing one sentence is how this became undiagnosable');
  seen.forEach(t => assert.ok(t.length < 110, 'copy must stay simple: ' + t));
});

test('an unknown code degrades to something honest rather than to the connection', () => {
  const a = app();
  const copy = a.signInErrorCopy('some_future_code');
  assert.ok(!/check your connection/i.test(copy),
    'a fault we have not met is not evidence about the network');
  assert.match(copy, /try again/i);
});

// ---------------------------------------------------------------------------
// DIAGNOSABLE WITHOUT LEAKING ANYTHING
// ---------------------------------------------------------------------------
test('the failure carries a status and code for diagnosis', async () => {
  const a = app();
  a.fetch = () => Promise.resolve({ ok: false, status: 503,
    json: () => Promise.resolve({ error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' }) });
  const err = await a.cloudSendMagicLink('tester@example.com').then(() => null, e => e);
  assert.ok(err, 'it must reject');
  assert.equal(err.code, 'unavailable');
  assert.equal(err.status, 503, 'a 503 and a 502 are different problems');
  assert.equal(err.diag, 'SUPABASE_KEY_UNUSABLE');
});

test('nothing sensitive reaches the athlete or the log line', () => {
  const a = app();
  const all = Object.keys(a.SIGNIN_ERROR_COPY).map(k => a.SIGNIN_ERROR_COPY[k]).join(' ');
  [/service_role/i, /sb_secret/i, /eyJ/, /supabase\.co/i, /apikey/i, /token/i]
    .forEach(rx => assert.ok(!rx.test(all), 'copy must not leak: ' + rx));
});

test('the request still sends the native redirect target unchanged', async () => {
  const a = app();
  let sent = null;
  a.fetch = (url, opts) => { sent = JSON.parse(opts.body);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ sent: true }) }); };
  await a.cloudSendMagicLink('tester@example.com');
  assert.equal(sent.email, 'tester@example.com');
  assert.ok('redirect' in sent, 'the redirect target is what routes the link back into the app');
});

test('a successful send still reports success', async () => {
  const a = app();
  const toasts = withServer(a, () =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ sent: true }) }));
  a.handleCloudSignIn();
  await settle();
  assert.match(toasts.join(' '), /Check your email/i);
});

// ---------------------------------------------------------------------------
// THE THREE WAYS THE EMAIL PROVIDER CAN REFUSE
//
// A live Pixel hit the 502 branch. Rate limit, a redirect target the project
// does not allow, and a disabled email provider all produced that one 502 and
// one sentence, so the three were indistinguishable from outside -- and each
// needs a completely different action. The server now classifies by upstream
// status and returns its own vocabulary; the upstream error code is logged and
// never returned, because GoTrue's `msg` can echo the submitted address.
// ---------------------------------------------------------------------------
test('each refusal class tells the reader a different thing to do', async () => {
  const seen = {};
  for (const reason of ['rate_limited', 'request_rejected', 'provider_error']) {
    const a = app();
    const toasts = withServer(a, httpFail(502, { error: 'send_failed', reason }));
    a.handleCloudSignIn();
    await settle();
    seen[reason] = toasts.join(' ');
    assert.ok(!/check your connection/i.test(seen[reason]),
      reason + ' is not a network fault: ' + seen[reason]);
  }
  assert.equal(new Set(Object.values(seen)).size, 3,
    'three different actions cannot share one sentence');
  assert.match(seen.rate_limited, /wait a few minutes/i, 'the only one the athlete can act on alone');
});

test('the specific reason outranks the general error code', async () => {
  const a = app();
  const toasts = withServer(a, httpFail(502, { error: 'send_failed', reason: 'rate_limited' }));
  a.handleCloudSignIn();
  await settle();
  assert.match(toasts.join(' '), /wait a few minutes/i,
    'falling back to "send_failed" would discard the only useful part of the answer');
});

test('a 502 with no reason still degrades to the general sentence', async () => {
  const a = app();
  const toasts = withServer(a, httpFail(502, { error: 'send_failed' }));
  a.handleCloudSignIn();
  await settle();
  assert.match(toasts.join(' '), /couldn’t be sent just now/i);
});

test('no refusal copy names a provider, a project or an address', () => {
  const a = app();
  const all = Object.keys(a.SIGNIN_ERROR_COPY).map(k => a.SIGNIN_ERROR_COPY[k]).join(' ');
  [/supabase/i, /gotrue/i, /smtp/i, /@/, /vercel/i, /redirect_to/i]
    .forEach(rx => assert.ok(!rx.test(all), 'athlete copy must not leak internals: ' + rx));
});
