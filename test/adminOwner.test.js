'use strict';
/* THE OWNER CHECK ON /admin.
 *
 * Founder, 21 November 2026: /admin answered OWNER_MISMATCH to the owner,
 * signed in as the account the database itself marks as the owner. Both
 * owner-only routes compared VVV_OWNER_USER_ID exactly as stored, so a value
 * pasted with a space or line break at either end, in quotes or in capitals
 * could never match. S.ownerConfig() drops those and nothing else: one
 * Supabase user id, matched in full. These tests drive both real routes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const S = require('../api/_strava.js');
const StravaAdmin = require('../api/_strava-admin.js');
const adminUser = require('../api/admin-user.js');

const OWNER = '8e00b5c3-8a2f-49a7-b189-17ab2c0e3581';
const OTHER = '11111111-2222-4333-8444-555555555555';

function withEnv(vars, fn){
  const was = {};
  Object.keys(vars).forEach((k) => { was[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; });
  const restore = () => Object.keys(was).forEach((k) => { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; });
  return Promise.resolve().then(fn).finally(restore);
}
function fakeRes(){
  const r = { status: 0, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.writeHead = (s, h) => { r.status = s; Object.assign(r.headers, h || {}); };
  r.end = (b) => { if (b != null){ try { r.body = JSON.parse(b); } catch (e) { r.body = b; } } };
  r.status = 0;
  return r;
}
/* Both routes answer through S.json; it is wrapped here so the status and
   the body can be read back whatever S.json does with the response. */
async function drive(route, uid){
  const realVerify = S.verifyUser, realJson = S.json;
  let answer = null;
  S.verifyUser = async () => ({ uid: uid, code: uid ? 'AUTH_OK' : 'AUTH_VERIFY_401', diag: {} });
  S.json = (res, status, body) => { answer = { status, body }; };
  try {
    const req = { method: 'POST', headers: { authorization: 'Bearer x' }, body: { action: 'not-an-action' } };
    await route(req, fakeRes());
  } finally { S.verifyUser = realVerify; S.json = realJson; }
  return answer;
}
const routes = { 'strava-admin': (q, s) => StravaAdmin.handle(q, s), 'admin-user': (q, s) => adminUser(q, s) };
const BASE = { STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: 'secret', VVV_SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' };

test('the stored id is read without the debris pasting leaves, and nothing else changes', () => {
  const ok = (v) => S.ownerConfig({ VVV_OWNER_USER_ID: v });
  assert.deepEqual(ok(OWNER), { state: 'ok', id: OWNER });
  assert.deepEqual(ok(' ' + OWNER + '\n'), { state: 'ok', id: OWNER }, 'a space or line break at either end');
  assert.deepEqual(ok('"' + OWNER + '"'), { state: 'ok', id: OWNER }, 'wrapped in quotes');
  assert.deepEqual(ok(OWNER.toUpperCase()), { state: 'ok', id: OWNER }, 'in capitals');
  assert.deepEqual(ok(''), { state: 'missing', id: '' });
  assert.deepEqual(ok('   '), { state: 'missing', id: '' });
  ['not-an-id', OWNER.slice(0, -1), OWNER + 'a', OWNER.replace(/-/g, ''), 'owner@example.com', OWNER + ',' + OTHER]
    .forEach((v) => assert.equal(ok(v).state, 'malformed', JSON.stringify(v) + ' was taken for an id'));
});

test('only the same id is the owner', () => {
  const env = { VVV_OWNER_USER_ID: ' ' + OWNER.toUpperCase() + '\n' };
  assert.equal(S.isOwner(OWNER, env), true);
  assert.equal(S.isOwner(OTHER, env), false);
  assert.equal(S.isOwner('', env), false);
  assert.equal(S.isOwner(null, env), false);
  assert.equal(S.isOwner(OWNER, { VVV_OWNER_USER_ID: 'not-an-id' }), false);
  assert.equal(S.isOwner(OWNER, {}), false);
});

for (const [name, route] of Object.entries(routes)){
  test(name + ': the owner gets past the gate even when the stored id carries pasting debris', async () => {
    for (const stored of [OWNER, ' ' + OWNER + '\n', '"' + OWNER + '"', OWNER.toUpperCase()]){
      const a = await withEnv(Object.assign({}, BASE, { VVV_OWNER_USER_ID: stored }), () => drive(route, OWNER));
      assert.equal(a.status, 400, JSON.stringify(stored) + ': ' + JSON.stringify(a));
      assert.equal(a.body.code || a.body.error, 'unknown_action', 'past the owner gate, refused only for the made-up action');
    }
  });

  test(name + ': anyone else is still told the route does not exist', async () => {
    const a = await withEnv(Object.assign({}, BASE, { VVV_OWNER_USER_ID: OWNER }), () => drive(route, OTHER));
    assert.deepEqual(a, { status: 404, body: { error: 'not_found', code: 'OWNER_MISMATCH' } });
  });

  test(name + ': a value that is not an id is reported as the setting, and lets nobody in', async () => {
    const a = await withEnv(Object.assign({}, BASE, { VVV_OWNER_USER_ID: 'owner@example.com' }), () => drive(route, OWNER));
    assert.deepEqual(a, { status: 503, body: { error: 'owner_misconfigured', code: 'OWNER_MALFORMED' } });
    const b = await withEnv(Object.assign({}, BASE, { VVV_OWNER_USER_ID: null }), () => drive(route, OWNER));
    assert.deepEqual(b, { status: 503, body: { error: 'owner_not_configured', code: 'OWNER_NOT_CONFIGURED' } });
  });

  test(name + ': signed out is still signed out', async () => {
    const a = await withEnv(Object.assign({}, BASE, { VVV_OWNER_USER_ID: OWNER }), () => drive(route, null));
    assert.equal(a.status, 401);
  });
}

test('both routes read the owner through the one shared function', () => {
  ['api/_strava-admin.js', 'api/admin-user.js'].forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /const owner = S\.ownerConfig\(\);/, f);
    assert.equal(/process\.env\.VVV_OWNER_USER_ID/.test(src), false, f + ' reads the variable around the shared function');
  });
});
