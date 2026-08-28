'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const app = require('../api/app.js');

/* THE APP SHELL IS CACHED PRIVATELY AND REVALIDATED EVERY TIME
 * ===========================================================================
 * The runtime used to be sent with `no-store`, which forbids the BROWSER from
 * keeping a copy as well as forbidding intermediaries. Its own comment noted
 * that the bytes are identical for everyone -- and they are: runtime() reads
 * the file verbatim, once per warm instance, with no templating and no
 * per-athlete injection. So 1.75MB (551KB gzipped) of unchanged application
 * crossed the wire on every launch, an eleven-second wait on a slow connection,
 * and the app could not open at all without a network even with a full plan
 * already in localStorage.
 *
 * `private, max-age=0, must-revalidate` + a strong content ETag keeps every
 * protection that mattered:
 *
 *   private          no shared cache, CDN or proxy may store it
 *   max-age=0        a stored copy is stale immediately
 *   must-revalidate  and asking is not optional -- the gate runs every launch
 *
 * THE INVARIANT THESE TESTS EXIST FOR: a cached document must never become an
 * authorisation bypass. That is structural here rather than a rule -- the
 * conditional check lives inside serveRuntime(), which is unreachable except
 * after the gate has decided -- and the tests below prove the structure holds.
 */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// 1. AUTH BEFORE 304 — the whole security argument
// ---------------------------------------------------------------------------

test('a 304 can only be produced from inside the post-gate serve path', () => {
  /* If a conditional check ever appears anywhere else in this file, a request
     could be answered 304 without the gate having run. There is exactly one
     place that reads If-None-Match and exactly one place that sends 304, and
     both are inside serveRuntime(). */
  /* The header is read in exactly one FUNCTION -- etagMatches reads both
     casings of it, which is two mentions and one reader. What matters is that
     no other function reads it, and that its only caller is serveRuntime. */
  const matcher = /function etagMatches\(req, tag\)\{[\s\S]*?\n\}/.exec(CODE);
  assert.ok(matcher, 'etagMatches is gone');
  const outside = CODE.replace(matcher[0], '');
  assert.ok(!/if-none-match/i.test(outside),
    'If-None-Match is read outside etagMatches, so a request could be answered ' +
    'conditionally before the gate has run');
  const callers = (CODE.match(/etagMatches\(/g) || []).length;
  assert.equal(callers, 2, 'etagMatches has callers other than serveRuntime');
  const threeOhFour = (CODE.match(/\b304\b/g) || []).length;
  assert.equal(threeOhFour, 1, '304 is produced in more than one place');
  const serve = /function serveRuntime\(req, res\)\{[\s\S]*?\n\}/.exec(CODE);
  assert.ok(serve, 'serveRuntime is gone or changed shape');
  assert.match(serve[0], /etagMatches\(req, tag\)/, 'the conditional check left serveRuntime');
  assert.match(serve[0], /304/, 'the 304 left serveRuntime');
});

test('every call site of serveRuntime is after a gate decision', () => {
  /* Two, and only two: the gate being off, and access granted. A third would
     be a path to the document that had not been decided. */
  const calls = (CODE.match(/serveRuntime\(req, res\)/g) || []).length - 1;  /* less the declaration */
  assert.equal(calls, 2,
    'serveRuntime has ' + calls + ' call sites; expected exactly two');
  /* Each is immediately preceded by the stamp recording the decision that
     allowed it. */
  assert.match(CODE, /stamp\(res, 'off'\);\s*\n\s*serveRuntime\(req, res\);/);
  assert.match(CODE, /stamp\(res, 'granted'\);\s*\n\s*serveRuntime\(req, res\);/);
});

test('every denial path still refuses without storing anything', () => {
  /* A denied athlete is redirected, never served and never given a validator
     to revalidate against later. toShell keeps no-store, deliberately. */
  const shell = /function toShell\(res, why\)\{[\s\S]*?\n\}/.exec(CODE);
  assert.ok(shell, 'toShell is gone');
  assert.match(shell[0], /no-store/, 'a denial became cacheable');
  assert.ok(!/etag/i.test(shell[0]), 'a denial carries a validator');
  /* And the denial branches route through it rather than through the runtime. */
  ['no-session', 'no-lease', 'denied', 'unavailable'].forEach(state => {
    assert.match(CODE, new RegExp("stamp\\(res, '" + state + "'\\);[\\s\\S]{0,80}?toShell\\("),
      "the '" + state + "' branch no longer ends at the account shell");
  });
});

// ---------------------------------------------------------------------------
// 2. THE HEADERS
// ---------------------------------------------------------------------------

test('the shell is privately cacheable and must always be revalidated', () => {
  const serve = /function serveRuntime\(req, res\)\{[\s\S]*?\n\}/.exec(CODE)[0];
  const cc = /cache-control',\s*'([^']+)'/.exec(serve);
  assert.ok(cc, 'the shell has no cache-control at all');
  const value = cc[1];
  assert.match(value, /\bprivate\b/,
    'the protected shell became storable by a shared cache');
  assert.match(value, /\bmax-age=0\b/, 'a stored copy could be reused without asking');
  assert.match(value, /\bmust-revalidate\b/,
    'revalidation became optional -- the gate could be skipped under cache pressure');
  assert.ok(!/\bpublic\b/.test(value), 'the shell was made publicly cacheable');
  assert.ok(!/\bs-maxage\b/.test(value), 'a shared-cache lifetime was granted');
  assert.ok(!/\bimmutable\b/.test(value), 'immutable would let a revoked athlete skip the gate');
});

test('the shell still varies on the cookie that carries authorisation', () => {
  const serve = /function serveRuntime\(req, res\)\{[\s\S]*?\n\}/.exec(CODE)[0];
  assert.match(serve, /vary',\s*'Cookie'/,
    'without Vary: Cookie a cache could reuse one session\'s copy for another');
});

// ---------------------------------------------------------------------------
// 3. THE VALIDATOR
// ---------------------------------------------------------------------------

test('the validator is a strong hash of the document, not of the deployment', () => {
  const tag = app.runtimeEtag();
  assert.match(tag, /^"[0-9a-f]{32}"$/, 'the validator is not a strong content hash: ' + tag);
  assert.ok(!/^W\//.test(tag),
    'a weak validator says "equivalent enough" about a payload the athlete executes');
  assert.equal(tag, app.runtimeEtag(), 'the validator is not stable across calls');
  /* Nothing time-, build- or environment-derived may reach it. */
  const fn = /function runtimeEtag\(\)\{[\s\S]*?\n\}/.exec(CODE)[0];
  /* Word-bounded: an earlier version of this matched "date" inside
     `update(runtime())` and failed the correct implementation. */
  assert.ok(!/\bDate\b|\bDate\.now\b|\bVERCEL\w*\b|\bDEPLOY\w*\b|\bmtime\b|\bMath\.random\b|\buuid\b/i.test(fn),
    'the validator is derived from something other than the content: ' + fn);
  assert.match(fn, /createHash\('sha256'\)\.update\(runtime\(\)\)/,
    'the validator is not computed from the document itself');
});

test('the validator tracks the content, byte for byte', () => {
  const crypto = require('crypto');
  const tagOf = (buf) => '"' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32) + '"';
  const real = fs.readFileSync(app.RUNTIME_FILE);
  assert.equal(tagOf(real), app.runtimeEtag(), 'the validator does not describe the shipped file');
  /* One byte different is a different document. */
  const changed = Buffer.concat([real, Buffer.from(' ')]);
  assert.notEqual(tagOf(changed), tagOf(real),
    'a changed build would validate against the old one');
  /* And identical content is the same validator, however it was produced. */
  assert.equal(tagOf(Buffer.from(real)), tagOf(real));
});

test('conditional requests are parsed as a list, with weak markers and *', () => {
  const t = app.runtimeEtag();
  assert.equal(app.etagMatches({ headers:{ 'if-none-match': t } }, t), true);
  assert.equal(app.etagMatches({ headers:{ 'if-none-match': 'W/' + t } }, t), true,
    'a weak-marked validator from a proxy was treated as a mismatch');
  assert.equal(app.etagMatches({ headers:{ 'if-none-match': '"a", ' + t + ' , "b"' } }, t), true,
    'a list of validators was not searched');
  assert.equal(app.etagMatches({ headers:{ 'if-none-match': '*' } }, t), true);
  assert.equal(app.etagMatches({ headers:{ 'if-none-match': '"other"' } }, t), false,
    'a DIFFERENT build was accepted as a match');
  assert.equal(app.etagMatches({ headers:{} }, t), false);
  assert.equal(app.etagMatches({}, t), false);
  assert.equal(app.etagMatches(null, t), false);
});

// ---------------------------------------------------------------------------
// 4. THE DOCUMENT ITSELF
// ---------------------------------------------------------------------------

test('the shell is identical for every athlete, which is what makes this safe', () => {
  /* If the document were templated per athlete, a private cache would still be
     correct but the reasoning would be different and the ETag would have to
     vary. It is not: the file is read verbatim, once, and sent unchanged. */
  const fn = /function runtime\(\)\{[\s\S]*?\n\}/.exec(CODE)[0];
  assert.match(fn, /readFileSync\(RUNTIME_FILE\)/);
  assert.ok(!/replace|template|inject|uid|user|lease|token|entitle/i.test(fn),
    'the runtime is being personalised before it is sent: ' + fn);
  const serve = /function serveRuntime\(req, res\)\{[\s\S]*?\n\}/.exec(CODE)[0];
  /* PER-ATHLETE identifiers, specifically. An earlier version of this banned
     the substring "entitle" and so failed on `x-vvv-entitled-at`, a SERVER
     TIMESTAMP that is identical for every athlete served in the same
     millisecond and is a response header rather than document content. The
     invariant is that nothing identifying a person reaches the document, not
     that a word never appears. */
  assert.ok(!/\blease\b|\buid\b|\buser_id\b|\bemail\b|\btoken\b|\bdecision\b/i.test(serve),
    'athlete-specific data reached the served document: ' + serve);
  /* And whatever headers it does set carry no body content. */
  assert.ok(!/setHeader\([^)]*\b(lease|uid|user|email|token)\b/i.test(serve),
    'an athlete-identifying header was added to the shell');
  /* And the shipped file carries no server-injected state. */
  const html = fs.readFileSync(app.RUNTIME_FILE, 'utf8');
  assert.ok(!/__VVV_(USER|LEASE|TOKEN|ENTITLEMENT)__|\{\{\s*\w+\s*\}\}/.test(html),
    'the shell contains a server-injection placeholder');
});

test('the service worker never short-circuits the gate while online', () => {
  /* THIS TEST CHANGED SHAPE, AND THE REASON MATTERS. When revalidation shipped,
     the service worker had no fetch handler at all, and asserting its absence
     was the cheapest way to know the gate could not be bypassed. Offline
     startup then gave it one deliberately -- a cached shell is the only way to
     open with no network, and no network means no gate can run.

     The invariant did not change: an ONLINE navigation must still reach the
     gate. What enforces it is now NETWORK-FIRST ordering rather than the
     absence of a handler, so that is what is asserted. The bounded offline
     fallback and its window are covered in test/offlineStartup.test.js. */
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const handler = /self\.addEventListener\('fetch'[\s\S]*?\n\}\);/.exec(sw);
  assert.ok(handler, 'the fetch handler is gone; offline startup depends on it');
  const nav = handler[0].slice(handler[0].indexOf("req.mode !== 'navigate'"));
  const network = nav.indexOf('fetch(req)');
  const cache = nav.indexOf('c.match(SHELL_KEY)');
  assert.ok(network > -1, 'navigation no longer reaches the network');
  assert.ok(cache === -1 || network < cache,
    'the cached shell is consulted before the network -- an online launch could ' +
    'open without the gate running');
  /* And the cached shell is reached only from the network-failure path. */
  assert.match(nav, /\}\)\.catch\(function\(\)\{[\s\S]*?c\.match\(SHELL_KEY\)/,
    'the cached shell is reachable other than as a fallback for a failed network');
});
