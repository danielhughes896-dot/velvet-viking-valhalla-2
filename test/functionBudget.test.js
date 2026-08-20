'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Phase 3A2 did not fail a test or break a route. It failed to DEPLOY:
//
//   readyState: ERROR
//   exceeded_serverless_functions_per_deployment
//   No more than 12 Serverless Functions can be added to a Deployment on the
//   Hobby plan
//
// Vercel turns every non-underscore file under /api into its own function. The
// product sat at ten; 3A2 added four; fourteen is more than twelve, and the
// whole deployment was rejected. Nothing was slow and nothing was broken --
// there was simply no deployment at all, which is a failure mode no unit test
// in this repository could previously see.
//
// So the budget is now a test. It is the only kind of assertion that catches
// this before a push rather than after one, and it is deliberately written
// against the same rule Vercel applies rather than against a list somebody
// has to remember to update.
const ROOT = path.join(__dirname, '..');
const HOBBY_FUNCTION_LIMIT = 12;

/* Vercel's rule, restated: every file directly under /api becomes a Serverless
   Function UNLESS its name begins with an underscore. That is what makes
   _access.js, _billing.js and the rest shared modules rather than endpoints --
   and it is not a convention this repository invented, it is the platform's,
   which the failed deployment confirmed by counting exactly the fourteen
   non-underscore files and no more. */
function deployedFunctions(){
  return fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => f.endsWith('.js') && !f.startsWith('_'))
    .sort();
}

test('the deployment fits on the plan it is deployed to', () => {
  const fns = deployedFunctions();
  assert.ok(fns.length <= HOBBY_FUNCTION_LIMIT,
    'Vercel will refuse the whole deployment: ' + fns.length + ' functions, limit ' +
    HOBBY_FUNCTION_LIMIT + '\n  ' + fns.join('\n  '));
});

test('the budget is stated with its remaining headroom, so growth is a decision', () => {
  const spare = HOBBY_FUNCTION_LIMIT - deployedFunctions().length;
  assert.ok(spare >= 0);
  /* Not an assertion that headroom exists -- landing exactly on the limit is
     legitimate and is where this currently sits. It is here so the number
     appears in the run output, and so the next person to add an endpoint finds
     out from a test rather than from a failed deployment. */
  console.log('    serverless functions: ' + deployedFunctions().length +
              '/' + HOBBY_FUNCTION_LIMIT + ' (' + spare + ' spare)');
});

test('shared modules are underscored, or they silently become functions', () => {
  ['_access.js', '_billing.js', '_strava.js',
   '_subscription.js', '_account-data.js', '_account-delete.js',
   /* The Stripe foundation. Every one of these is a module rather than an
      endpoint precisely because the budget is full — an un-prefixed rename
      would cost a slot and the deployment failure would look unrelated. */
   '_checkout.js', '_stripe.js']
    .forEach(m => assert.ok(fs.existsSync(path.join(ROOT, 'api', m)),
      m + ' must exist and must stay underscored — an un-prefixed rename costs a ' +
      'function slot and nobody would connect the deployment failure to it'));
});

// ---------------------------------------------------------------------------
// THE ROUTER
// ---------------------------------------------------------------------------
const account = require('../api/account.js');

test('every consolidated resource resolves, and nothing else does', () => {
  assert.deepEqual(account.ROUTES.slice().sort(),
    ['account-data', 'account-delete', 'checkout', 'subscription']);
  account.ROUTES.forEach(r => {
    assert.equal(account.resolveResource({ query: { resource: r } }), r);
    assert.equal(account.resolveResource({ url: '/api/account?resource=' + r }), r);
  });
});

test('an unrecognised resource resolves to nothing rather than to a guess', () => {
  ['', 'delete', 'account', '../session', 'subscription-x', 'SUBSCRIPTION']
    .forEach(v => assert.equal(account.resolveResource({ query: { resource: v } }), null,
      '"' + v + '" must not reach a handler — one of the three deletes accounts'));
  assert.equal(account.resolveResource({ url: '/api/account' }), null);
  assert.equal(account.resolveResource({}), null);
});

test('a direct hit still resolves if the rewrite is ever removed', () => {
  assert.equal(account.resolveResource({ url: '/api/account-data' }), 'account-data');
  assert.equal(account.resolveResource({ url: '/api/account-delete?x=1' }), 'account-delete');
  assert.equal(account.resolveResource({ url: '/api/account-data/' }), 'account-data');
});

test('the query parameter outranks the path, since the rewrite is the authority', () => {
  assert.equal(account.resolveResource({
    query: { resource: 'subscription' }, url: '/api/account-delete' }), 'subscription');
});

test('an unroutable request is refused before any handler is reached', async () => {
  /* The Vercel response shape S.json() writes to: setHeader, then
     status().send(). Stubbed rather than mocked, so the assertion is about
     what the real handler actually emits. */
  let status = null, body = null;
  const res = { setHeader(){},
    status(s){ status = s; return this; },
    send(b){ body = b; } };
  await account({ url: '/api/account?resource=nope', headers: {}, method: 'GET' }, res);
  assert.equal(status, 404, 'a path that does not route is a path that does not exist');
  assert.ok(!/subscription|delete|export/i.test(String(body || '')),
    'and the answer must not describe the shape of the router to a stranger');
});

/* Dispatch, proved without a network or a database. Each of the three modules
   allows a different set of methods, so the Allow header on a 405 is a
   fingerprint: it can only have been written by that module's own handler.
   That is what makes this a test of ROUTING rather than of a mock. */
async function call(resource, method){
  let status = null, allow = null;
  const res = { setHeader(k, v){ if (String(k).toLowerCase() === 'allow') allow = v; },
                status(s){ status = s; return this; }, send(){} };
  await account({ url: '/api/account?resource=' + resource, method, headers: {} }, res);
  return { status, allow };
}

test('each resource reaches its own module and no other', async () => {
  assert.deepEqual(await call('subscription', 'PUT'), { status: 405, allow: 'GET, POST' });
  assert.deepEqual(await call('account-data', 'POST'), { status: 405, allow: 'GET' });
  assert.deepEqual(await call('account-delete', 'GET'), { status: 405, allow: 'POST' });
});

test('export is still read-only and deletion is still not', async () => {
  assert.equal((await call('account-data', 'DELETE')).status, 405,
    'an export endpoint that accepted a write would be a different endpoint');
  assert.equal((await call('account-delete', 'PUT')).status, 405);
});

// ---------------------------------------------------------------------------
// THE PUBLIC SURFACE IS UNCHANGED
// ---------------------------------------------------------------------------
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

test('every consolidated path still exists as a public URL', () => {
  const map = {};
  (CFG.routes || []).forEach(r => { if (r.src) map[r.src] = r.dest; });
  assert.equal(map['/api/subscription'], '/api/account?resource=subscription');
  assert.equal(map['/api/account-data'], '/api/account?resource=account-data');
  assert.equal(map['/api/account-delete'], '/api/account?resource=account-delete');
});

test('the rewrites are reached before the filesystem handler', () => {
  const routes = CFG.routes || [];
  const fsAt = routes.findIndex(r => r.handle === 'filesystem');
  ['/api/subscription', '/api/account-data', '/api/account-delete'].forEach(src => {
    const at = routes.findIndex(r => r.src === src);
    assert.ok(at !== -1 && at < fsAt, src + ' must be rewritten before the filesystem is tried');
  });
});

test('the account shell and the app still call the URLs they always called', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'account.html'), 'utf8');
  ['/api/subscription', '/api/account-data', '/api/account-delete']
    .forEach(u => assert.ok(shell.indexOf(u) !== -1,
      shell.indexOf(u) + ' consolidation is packaging — no caller should have had to change: ' + u));
  assert.ok(shell.indexOf('/api/account?') === -1,
    'the internal routing shape must not leak into a caller');
});

// ---------------------------------------------------------------------------
// WHAT WAS DELIBERATELY NOT CONSOLIDATED
// ---------------------------------------------------------------------------
test('the billing webhook keeps its own function, and its own auth model', () => {
  const fns = deployedFunctions();
  assert.ok(fns.indexOf('billing-webhook.js') !== -1,
    'a third party\'s server authenticated by HMAC must not share a handler with ' +
    'account deletion — one mis-ordered branch would be the whole boundary');
  const router = fs.readFileSync(path.join(ROOT, 'api', 'account.js'), 'utf8');
  assert.ok(!/billing-webhook|verifySignature/.test(
    router.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')),
    'the router must not learn anything about signature verification');
});

test('the session endpoint keeps its own function too', () => {
  assert.ok(deployedFunctions().indexOf('session.js') !== -1,
    'it answers 403 when access has ended, which is why it cannot also be what ' +
    'talks to a locked-out athlete');
});

test('the router routes and does nothing else', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'account.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  [/verifyUser/, /readEntitlement/, /serviceKey/, /Bearer/, /resolveAccess/, /localStorage/]
    .forEach(rx => assert.ok(!rx.test(src),
      'a decision moved into the router is a decision that left its module: ' + rx));
});
