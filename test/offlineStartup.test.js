'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* OPENING VALHALLA WITHOUT A NETWORK
 * ===========================================================================
 * The startup audit found that the app could not open at all in airplane mode
 * even with a complete plan in localStorage: the shell needed to read that plan
 * had to be fetched first. Two things follow, and they are separable.
 *
 * THE SHELL. A service worker keeps the last granted delivery and may serve it
 * without a gate when the network cannot answer -- for a bounded window,
 * because offline there is provably no way to check entitlement. Online is
 * unchanged and network-first, so the gate stays authoritative whenever it can
 * be reached.
 *
 * THE STATE. resolvePlanOwnership() has always archived a departing athlete's
 * plan and restored the incoming one's; it just ran inside cloudReconcile(),
 * which needs the network. It now runs at the local-load boundary, before the
 * first paint, so a foreign owner's plan cannot be on screen waiting for a
 * reconcile that may never come.
 */

const SW = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
function sw(){
  const box = { self:{ addEventListener(){} }, caches:{}, Response: function(){}, Date, Math };
  vm.createContext(box);
  vm.runInContext(SW, box);
  return box;
}
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 1. THE BOUNDED OFFLINE WINDOW
// ---------------------------------------------------------------------------

test('the window is seven days, and expiry is measured from the last grant', () => {
  const s = sw();
  assert.equal(s.OFFLINE_WINDOW_MS, 7 * DAY, 'the offline window is no longer seven days');
  const at = (ms) => { const n = Date.now(); return { serverAt:n-ms, deviceAt:n-ms, highWater:n-ms }; };
  assert.equal(s.offlineAllowed(at(0)), true, 'day 0 offline was refused');
  assert.equal(s.offlineAllowed(at(6 * DAY)), true, 'day 6 offline was refused');
  assert.equal(s.offlineAllowed(at(7 * DAY - 60000)), true, 'just inside the window was refused');
  assert.equal(s.offlineAllowed(at(7 * DAY + 60000)), false, 'just past the window was allowed');
  assert.equal(s.offlineAllowed(at(8 * DAY)), false, 'day 8 offline was allowed');
});

test('with no grant on record, nothing is served offline', () => {
  const s = sw();
  assert.equal(s.offlineAllowed(null), false);
  assert.equal(s.offlineAllowed({}), false);
  assert.equal(s.offlineAllowed({ serverAt: Date.now() }), false,
    'a record with no device reading was treated as usable');
});

test('a clock moved backwards expires the window rather than extending it', () => {
  /* Offline, the device clock is the only clock there is, so elapsed time must
     come from it -- and setting it back would otherwise extend the window
     without limit. Both checks FAIL CLOSED: the cost of being wrong is one
     online launch; the cost of being permissive is an unbounded window. */
  const s = sw();
  const now = Date.now();
  assert.equal(s.offlineAllowed({ deviceAt: now + DAY, highWater: now + DAY }), false,
    'a clock behind the moment of the grant was accepted');
  assert.equal(s.offlineAllowed({ deviceAt: now - DAY, highWater: now + DAY }), false,
    'a clock behind the high-water mark was accepted');
  /* And the high-water mark only ever rises. */
  assert.match(SW, /highWater:\s*Math\.max\(now,\s*\(prev && prev\.highWater\) \|\| 0\)/,
    'the high-water mark can be lowered, which makes rollback useful again');
});

test('the stamp is server time, which the client cannot forge forward', () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'app.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(appSrc, /res\.setHeader\('x-vvv-entitled-at', String\(Date\.now\(\)\)\)/,
    'the entitlement stamp is no longer the server\'s own clock');
  /* And it is set inside the post-gate serve path, so only a GRANT carries it. */
  const serve = /function serveRuntime\(req, res\)\{[\s\S]*?\n\}/.exec(appSrc)[0];
  assert.match(serve, /x-vvv-entitled-at/);
  const shell = /function toShell\(res, why\)\{[\s\S]*?\n\}/.exec(appSrc)[0];
  assert.ok(!/x-vvv-entitled-at/.test(shell),
    'a DENIAL carries an entitlement stamp -- a revoked athlete could refresh their own window');
});

test('only a granted response can refresh the window', () => {
  /* The refresh is driven off the header, and the header only exists on a
     grant. A redirect or an error passes through and changes nothing. */
  assert.match(SW, /var stamp = resp\.headers\.get\('x-vvv-entitled-at'\)/);
  assert.match(SW, /if \(resp\.ok && stamp\)/, 'a non-ok response can cache the body');
  assert.ok(!/stampEntitlement\(\)/.test(SW), 'the window can be refreshed with no stamp at all');
});

// ---------------------------------------------------------------------------
// 2. ONLINE IS UNCHANGED
// ---------------------------------------------------------------------------

test('navigation is network-first, so the live gate stays authoritative', () => {
  /* THE INVARIANT THAT PROTECTS THE PREVIOUS PASS. If the cache were tried
     first, an online launch could open without the gate running, and
     revalidation would be dead code. */
  const handler = /self\.addEventListener\('fetch'[\s\S]*?\n\}\);/.exec(SW)[0];
  const fetchAt = handler.indexOf('fetch(req)');
  const cacheAt = handler.indexOf('caches.open(SHELL_CACHE).then(function(c){\n          return c.match');
  assert.ok(fetchAt > -1, 'navigation no longer goes to the network');
  assert.ok(cacheAt === -1 || fetchAt < cacheAt,
    'the cache is consulted before the network -- the gate could be skipped online');
  assert.match(handler, /\}\)\.catch\(function\(\)\{/,
    'the cached shell is no longer a fallback for a failed network');
});

test('only navigations are intercepted -- cloud calls still fail honestly offline', () => {
  /* Comments stripped: the handler's own comment names the API routes it
     deliberately leaves alone, and matching that prose as if it were code
     failed the correct implementation. */
  const CODE = SW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const handler = /self\.addEventListener\('fetch'[\s\S]*?\n\}\);/.exec(CODE)[0];
  assert.match(handler, /req\.mode !== 'navigate'/, 'non-navigation requests are being intercepted');
  assert.match(handler, /req\.method !== 'GET'/);
  /* Nothing here may answer for the model, the voice or the database. */
  assert.ok(!/voice|strava|supabase|api\//i.test(handler),
    'the service worker answers for an API route, which would fake cloud availability');
});

test('old caches are retired on activation, so no one is pinned to an old build', () => {
  const act = /self\.addEventListener\('activate'[\s\S]*?\n\}\);/.exec(SW)[0];
  assert.match(act, /caches\.keys\(\)/, 'old caches are never enumerated');
  assert.match(act, /caches\.delete\(n\)/, 'old caches are never deleted');
  assert.match(act, /n !== SHELL_CACHE && n !== META_CACHE/,
    'the retirement rule does not name the current caches');
  assert.match(SW, /skipWaiting\(\)/, 'a new build waits behind the old one indefinitely');
});

// ---------------------------------------------------------------------------
// 3. OWNERSHIP, BEFORE THE FIRST PAINT
// ---------------------------------------------------------------------------

function withStored(entries){
  const store = {};
  Object.keys(entries).forEach(k => { store[k] = JSON.stringify(entries[k]); });
  return loadApp({ storage: store });
}

test('ownership is resolved at the local-load boundary, before rendering', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const init = /function init\(\)\{[\s\S]*?\n\}/.exec(src)[0];
  const load = init.indexOf('loadState()');
  const own = init.indexOf('resolveOwnershipBeforeRender()');
  const render = init.indexOf('renderApp()');
  assert.ok(load > -1 && own > -1 && render > -1, 'the startup order changed shape');
  assert.ok(load < own, 'ownership is resolved before the state is even read');
  assert.ok(own < render,
    'the app renders before ownership is resolved -- a foreign plan would flash on screen');
});

test('the existing ownership mechanism is reused, not duplicated', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  /* One implementation of the archive/restore rule, called from two places. */
  assert.equal((src.match(/function resolvePlanOwnership\(/g) || []).length, 1,
    'a second ownership implementation appeared');
  assert.match(src, /function resolveOwnershipBeforeRender\(\)\{[\s\S]*?resolvePlanOwnership\(uid\)/,
    'the load-time path no longer delegates to the existing mechanism');
});

test('a foreign owner\'s plan is archived rather than rendered or destroyed', () => {
  const a = loadApp({});
  a.showToast = () => {}; a.persistStateLocalOnly = () => {};
  a.state = a.makeDefaultState();
  a.state.setup = { distanceKey:'10k', currentVolume:40 };
  a.state.days = [{ id:'d1', date:'2026-08-27', type:'easy', km:8, week:1 }];
  a.stampPlanOwner('user-A');
  const verdict = a.resolvePlanOwnership('user-B');
  assert.equal(verdict, 'cleared', 'user B inherited user A\'s plan: ' + verdict);
  assert.equal(a.state.setup, null, 'the foreign plan is still the live state');
  /* Archived, not destroyed -- the departing athlete keeps their plan. */
  const archive = a.readPlanArchive();
  assert.ok(archive['user-A'], 'user A\'s plan was destroyed rather than archived');
  /* And coming back restores it. */
  const back = a.resolvePlanOwnership('user-A');
  assert.equal(back, 'restored');
  assert.ok(a.state.setup, 'user A did not get their own plan back');
});

test('signing out is not a foreign owner, and the plan stays on the device', () => {
  /* THE SHIPPED CONTRACT, unchanged: "Signed out -- your plan stays on this
     device". With no session there is no uid and nothing is archived. */
  const a = loadApp({});
  a.state = a.makeDefaultState();
  a.state.setup = { distanceKey:'10k' };
  a.stampPlanOwner('user-A');
  assert.equal(a.resolvePlanOwnership(null), 'no-session');
  assert.ok(a.state.setup, 'signing out removed the plan');
  assert.equal(a.resolveOwnershipBeforeRender(), 'no-session',
    'with no stored session the load-time path did something other than nothing');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.match(src, /Signed out — your plan stays on this device/,
    'the shipped logout promise was changed');
});

test('the same owner offline renders their own last-known-good state', () => {
  const a = loadApp({});
  a.state = a.makeDefaultState();
  a.state.setup = { distanceKey:'half' };
  a.state.days = [{ id:'d1', date:'2026-08-27', type:'easy', km:8, week:1 }];
  a.stampPlanOwner('user-A');
  assert.equal(a.resolvePlanOwnership('user-A'), 'own');
  assert.ok(a.state.setup, 'the owner\'s own plan was taken away');
  assert.equal(a.state.days.length, 1);
});

test('a corrupt or unreadable session cannot throw during startup', () => {
  const a = loadApp({});
  a.readStored = () => { throw new Error('storage exploded'); };
  assert.equal(a.resolveOwnershipBeforeRender(), 'no-session',
    'a storage failure during startup was not contained');
  a.readStored = () => ({ user_id: 'user-A' });
  a.resolvePlanOwnership = () => { throw new Error('boom'); };
  assert.equal(a.resolveOwnershipBeforeRender(), 'error',
    'a failure inside ownership resolution escaped startup');
});

// ---------------------------------------------------------------------------
// 4. LOCAL RENDER IS NOT GATED ON THE CLOUD
// ---------------------------------------------------------------------------

test('startup renders before any cloud work, and never awaits it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const init = /function init\(\)\{[\s\S]*?\n\}/.exec(src)[0];
  const render = init.indexOf('renderApp()');
  const cloud = init.indexOf('cloudInit()');
  assert.ok(render > -1 && cloud > -1);
  assert.ok(render < cloud, 'the app waits for the cloud before painting');
  assert.ok(!/await\s+cloudInit|\.then\([^)]*\)\s*;\s*renderApp/.test(init),
    'cloud initialisation is awaited before rendering');
});

test('today resolves from the local plan and the local date, with no request', () => {
  /* DATE ROLLOVER OFFLINE. Which stored session is "today" must be answerable
     from the device alone, or a runner without signal cannot see their run. */
  const a = loadApp({ pinnedDate: '2026-08-27T09:00:00Z' });
  a.state = a.makeDefaultState();
  a.state.setup = { distanceKey:'half' };
  a.state.days = [
    { id:'d1', date:'2026-08-26', type:'easy', km:8, week:1 },
    { id:'d2', date:'2026-08-27', type:'long', km:16, week:1 },
    { id:'d3', date:'2026-08-28', type:'rest', km:0, week:1 }
  ];
  let fetched = 0;
  a.fetch = () => { fetched++; return new Promise(() => {}); };
  const today = a.findDayByDate(a.todayStr());
  assert.ok(today, 'today could not be resolved locally');
  assert.equal(today.id, 'd2');
  assert.equal(fetched, 0, 'resolving today made a network request');
});
