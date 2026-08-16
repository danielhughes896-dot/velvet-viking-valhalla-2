'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The delivery gate is only as good as the routing that reaches it. On the first
// real Preview, /protected/velvet-viking-valhalla.html returned the full runtime
// -- the exact bypass the gate exists to prevent.
//
// The config that produced it had two `continue: true` header routes sitting
// AHEAD of the security guards, one of which -- `/(.*\.html)` -- matched the
// leaked path itself. A matching route with a capturing group, no `dest`, and
// `continue` semantics, positioned in front of the guard that protects the same
// path, is an ordering hazard with no upside: its only job was a cache header.
//
// These tests resolve paths through the route table the way Vercel's legacy
// router does -- in order, first match wins, `handle: filesystem` last -- and
// assert the security-critical paths reach /api/app. They fail against the old
// config and pass against the new one.
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
const ROUTES = CFG.routes || [];
const FS_INDEX = ROUTES.findIndex(r => r.handle === 'filesystem');
const PRE = ROUTES.slice(0, FS_INDEX === -1 ? ROUTES.length : FS_INDEX);

/* Vercel anchors `src` at both ends. */
const matches = (src, p) => new RegExp('^' + src + '$').test(p);

/* First pre-filesystem route whose src matches, mirroring Vercel's ordering. */
function firstMatch(p) {
  for (const r of PRE) if (r.src && matches(r.src, p)) return r;
  return null;
}

const GUARDED = [
  '/',
  '/protected/velvet-viking-valhalla.html',
  '/velvet-viking-valhalla.html',
  '/auth',
];

// ---------------------------------------------------------------------------
// THE BYPASS THAT ACTUALLY HAPPENED
// ---------------------------------------------------------------------------
test('the protected runtime path resolves to the gate, not the filesystem', () => {
  const hit = firstMatch('/protected/velvet-viking-valhalla.html');
  assert.ok(hit, 'no route matched — the filesystem would serve the runtime unguarded');
  assert.equal(hit.dest, '/api/app',
    'this exact path returned the full runtime on a real Preview; the first ' +
    'matching route must be the gate');
});

test('every guarded path reaches the gate first', () => {
  GUARDED.forEach(p => {
    const hit = firstMatch(p);
    assert.ok(hit, p + ' matched no route at all');
    assert.equal(hit.dest, '/api/app', p + ' must resolve to the gate, got ' + hit.dest);
  });
});

test('nothing whatsoever precedes the guards', () => {
  // The failure was an ordering hazard, so the invariant is positional: the
  // guards are the first thing the router considers.
  const firstNonGuard = PRE.findIndex(r => r.dest !== '/api/app');
  const guards = firstNonGuard === -1 ? PRE : PRE.slice(0, firstNonGuard);
  assert.ok(guards.length >= 4, 'expected the gate routes at the top of the table');
  guards.forEach(r => assert.equal(r.dest, '/api/app'));
  GUARDED.forEach(p => {
    const idx = PRE.findIndex(r => r.src && matches(r.src, p));
    assert.ok(idx < guards.length, p + ' is matched by a route after the guards');
  });
});

test('no route uses continue:true, which is what let a header rule sit in front of a guard', () => {
  const cont = PRE.filter(r => r.continue);
  assert.deepEqual(cont, [],
    'a continue route ahead of the guards matched /protected/…html and is not worth ' +
    'the cache header it existed for; /api/app sets its own no-store');
});

// ---------------------------------------------------------------------------
// THE GUARDS MUST NOT SWALLOW THE PUBLIC SURFACE
// ---------------------------------------------------------------------------
test('the public surface still resolves to its own static files', () => {
  [['/account', '/account.html'], ['/privacy', '/privacy.html'],
   ['/terms', '/terms.html'], ['/get', '/get.html']].forEach(([p, dest]) => {
    const hit = firstMatch(p);
    assert.ok(hit, p + ' matched nothing');
    assert.equal(hit.dest, dest, p + ' must stay publicly reachable without entitlement');
  });
});

test('the account shell is never routed through the gate it redirects to', () => {
  const hit = firstMatch('/account');
  assert.notEqual(hit.dest, '/api/app',
    'the shell behind the gate is a redirect loop with nowhere to sign in');
});

test('assets and API routes fall through to the filesystem untouched', () => {
  ['/assets/icon.png', '/sw.js', '/api/session', '/api/beta-signin', '/api/app']
    .forEach(p => assert.equal(firstMatch(p), null, p + ' must not be rewritten'));
});

// ---------------------------------------------------------------------------
// STRUCTURE
// ---------------------------------------------------------------------------
test('the filesystem handler comes last', () => {
  assert.ok(FS_INDEX > 0, 'handle:filesystem must exist and follow the guards');
  assert.equal(FS_INDEX, ROUTES.length - 1, 'nothing may run after the filesystem phase');
});

test('legacy routes are not mixed with the modern properties they exclude', () => {
  ['rewrites', 'redirects', 'headers', 'cleanUrls', 'trailingSlash'].forEach(k =>
    assert.ok(!(k in CFG),
      '`' + k + '` cannot be combined with `routes`; Vercel rejects the config and ' +
      'a rejected config means no gate at all'));
});

test('the gate function can still find the runtime it serves', () => {
  const inc = ((CFG.functions || {})['api/app.js'] || {}).includeFiles;
  assert.equal(inc, 'protected/**', 'without this the function cannot read the file it gates');
  const app = require('../api/app.js');
  assert.ok(fs.existsSync(app.RUNTIME_FILE));
});

// ---------------------------------------------------------------------------
// THE GATE MUST BE OBSERVABLE
// ---------------------------------------------------------------------------
test('every exit path declares what the gate decided', async () => {
  // Two different faults produced an identical response on the real Preview --
  // routes not running, and the flag not reaching the function. Without this
  // header the two cannot be told apart from outside.
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
  const body = src.slice(src.indexOf('module.exports = async function handler'));
  const exits = (body.match(/return toShell\(|serveRuntime\(res\)/g) || []).length;
  const stamps = (body.match(/stamp\(res,/g) || []).length;
  assert.ok(stamps >= exits,
    'every exit must stamp: ' + exits + ' exits but only ' + stamps + ' stamps');
  assert.match(src, /x-vvv-gate/, 'the header itself');
});

test('the stamp reveals posture, never identity', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8');
  const values = (src.match(/stamp\(res, '([^']+)'\)/g) || []).map(s => s.split("'")[1]);
  assert.deepEqual([...new Set(values)].sort(),
    ['denied', 'granted', 'no-lease', 'no-session', 'off', 'unavailable']);
  values.forEach(v => assert.ok(!/uid|user|email|lease-|token/i.test(v),
    'a diagnostic header must not carry an identity: ' + v));
});
