'use strict';
// THE FIRST-TIME JOURNEY, OPEN TO EVERYONE (founder, 18 November 2026:
// "Open steps 1-6 to everyone").
//
// With VVV_ACCOUNT_REQUIRED on, a visitor with no session is served the app
// runtime in JOURNEY-ONLY mode instead of being redirected to sign in. These
// tests hold the line that decision draws:
//   * the gate: no session at all -> the journey runtime, marked, uncached and
//     unstamped; every other gate outcome is exactly what it was, and with the
//     gate off nothing changes;
//   * the page: inside journey-only mode the app draws the journey's screens
//     up to Make It Yours and nothing else, whatever view is asked for, and
//     refuses every action that is not the journey's, the builder's or
//     sign-in's;
//   * the server: every API that reads or writes an account, or costs money,
//     refuses an anonymous caller itself. Hiding a button is not the guard.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const A = require('../api/_access.js');
const S = require('../api/_strava.js');
const appHandler = require('../api/app.js');

const ROOT = path.join(__dirname, '..');
const RUNTIME = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

function mockRes(){
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(k, v){ this.headers[String(k).toLowerCase()] = v; },
    getHeader(k){ return this.headers[String(k).toLowerCase()]; },
    status(code){ this.statusCode = code; return this; },
    send(body){ this.body = body; if (this.statusCode == null) this.statusCode = 200; return this; },
    json(obj){ this.body = JSON.stringify(obj); return this; },
    end(b){ if (b) this.body = b; if (this.statusCode == null) this.statusCode = 200; return this; },
    write(){ return true; },
    writeHead(code, h){ this.statusCode = code; Object.keys(h || {}).forEach(k => this.setHeader(k, h[k])); return this; },
    flushHeaders(){}
  };
}
async function withPatched(mod, patches, fn){
  const saved = {};
  Object.keys(patches).forEach(k => { saved[k] = mod[k]; mod[k] = patches[k]; });
  try { return await fn(); } finally { Object.keys(saved).forEach(k => { mod[k] = saved[k]; }); }
}
function setEnv(vars){
  const saved = {};
  Object.keys(vars).forEach(k => { saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; });
  return () => Object.keys(saved).forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
}
const FAKE_CFG = { serviceKey: 'fake', serviceKeySource: 'test' };

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------
test('gate on, no session: the journey runtime, marked, never cached and never stamped as granted', async () => {
  await withPatched(A, { accountRequired: () => true, readGateCookie: () => null }, async () => {
    await withPatched(S, { config: () => FAKE_CFG }, async () => {
      const res = mockRes();
      await appHandler({ method: 'GET', headers: {} }, res);
      assert.equal(res.statusCode, 200);
      const html = String(res.body);
      assert.match(html, /^<!DOCTYPE html>\s*<html data-vvv-access="journey"/, 'the runtime is not marked journey-only');
      assert.ok(html.length > 100000, 'not the real runtime');
      assert.equal(res.headers['x-vvv-gate'], 'journey');
      assert.match(res.headers['cache-control'], /no-store/, 'the journey copy can be stored');
      assert.equal(res.headers['x-vvv-entitled-at'], undefined,
        'the journey copy is stamped as a grant, so the service worker would keep it as one');
      assert.equal(res.headers.etag, undefined);
    });
  });
});

test('gate on, every other outcome is what it was', async () => {
  await withPatched(A, { accountRequired: () => true, readGateCookie: () => 'stale', resolveLease: async () => null }, async () => {
    await withPatched(S, { config: () => FAKE_CFG }, async () => {
      const res = mockRes();
      await appHandler({ method: 'GET', headers: {} }, res);
      assert.equal(res.statusCode, 302, 'a stale lease is no longer sent to sign in');
      assert.match(res.headers.location, /why=signin/);
    });
  });
  await withPatched(A, { accountRequired: () => true }, async () => {
    await withPatched(S, { config: () => ({ serviceKey: '', serviceKeySource: 'absent' }) }, async () => {
      const res = mockRes();
      await appHandler({ method: 'GET', headers: {} }, res);
      assert.equal(res.statusCode, 302);
      assert.match(res.headers.location, /why=unavailable/);
    });
  });
  await withPatched(A, { accountRequired: () => false }, async () => {
    const res = mockRes();
    await appHandler({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(String(res.body).slice(0, 200), /data-vvv-access/, 'gate off now serves the journey copy');
    assert.equal(res.headers['x-vvv-gate'], 'off');
  });
});

test('the full runtime is never the journey copy: only the no-session branch serves it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/app.js'), 'utf8');
  assert.equal((src.match(/return serveJourneyOnly\(res\)/g) || []).length, 1);
  assert.match(src, /if \(!leaseId\)\{ stamp\(res, 'journey'\); return serveJourneyOnly\(res\); \}/);
});

// ---------------------------------------------------------------------------
// THE PAGE IN JOURNEY-ONLY MODE
// ---------------------------------------------------------------------------
function journeyOnly(opts){
  const a = loadApp(Object.assign({ pinnedDate: '2026-11-18T09:00:00Z' }, opts || {}));
  a.showToast = () => {};
  a.JOURNEY_ONLY_MODE = true;
  return a;
}

test('the app reads the marker the gate writes, and only that', () => {
  assert.match(RUNTIME, /getAttribute\('data-vvv-access'\) === 'journey'/);
  assert.equal(loadApp().JOURNEY_ONLY_MODE, false, 'journey-only is on without the marker');
});

test('journey-only draws the journey whatever view is asked for, and never the tabs', () => {
  const a = journeyOnly();
  ['today', 'week', 'full', 'planhq', 'settings'].forEach(v => {
    a.state.view = v;
    const html = a.renderMainContent();
    assert.match(html, /class="jr /, v + ' drew something other than the journey');
    assert.doesNotMatch(html, /view-heading|bottom-nav|view-settings|view-plan"/, v + ' leaked a tab');
  });
  a.state.view = 'today';
  a.handleSetView('settings');
  assert.notEqual(a.state.view, 'settings', 'the tabs can still be navigated to');
  assert.equal(a.journeyScreen(), true, 'the top bar and the tabs would be drawn');
});

test('journey-only stops at Make It Yours: the trial and everything after need an account', () => {
  const a = journeyOnly();
  buildPlan(a, { distanceKey: 'half', weeks: 12, volume: 35 });
  ['trial', 'arrive', 'done'].forEach(step => {
    a.journeyWrite({ v: 1, step: step, built: true, drives: [], slide: 0 });
    assert.equal(a.journeyStep(), 'account', step + ' is reachable without an account');
    assert.match(a.renderMainContent(), /Make It Yours\./);
  });
  /* a device holding a plan from before, signed out: the Welcome, whose
     Existing Member is the way back in -- never the plan itself */
  const b = journeyOnly();
  buildPlan(b, { distanceKey: '10k', weeks: 10 });
  assert.match(b.renderMainContent(), /Your Journey Starts Here[^]*Existing Member/);
  assert.doesNotMatch(b.renderMainContent(), /day-top|view-today/);
});

test('journey-only refuses every action that is not the journey\'s, the builder\'s or sign-in\'s', () => {
  const a = journeyOnly();
  ['journey-start', 'journey-achieve', 'bld-next', 'bld-back', 'generate-plan', 'set-event-mode', 'cal-open',
   'close-modal', 'open-signin-sheet', 'cloud-sign-in', 'open-external', 'ask-yes', 'bld-decide-yes', 'time-wheel-use']
    .forEach(x => assert.equal(a.journeyOnlyAllows(x), true, x + ' is refused, so the journey cannot be completed'));
  ['set-view', 'open-settings-panel', 'open-stg-sheet', 'share-workout', 'open-circle', 'circle-open',
   'voice-ask-submit', 'voice-ask-open', 'open-ask', 'restriction-open', 'open-new-block', 'strava-connect',
   'subscription-resubscribe', 'subscription-manage', 'cloud-export', 'open-restore', 'toggle-complete', 'welcome-ack']
    .forEach(x => assert.equal(a.journeyOnlyAllows(x), false, x + ' reaches past the journey'));
  /* and every action the builder itself draws is allowed: a blocked builder
     button would strand the visitor halfway through step 4 */
  const at = RUNTIME.indexOf('function openSetupModal(');
  const builder = RUNTIME.slice(at, RUNTIME.indexOf('async function handleGeneratePlan(', at));
  const acts = new Set((builder.match(/data-action="([a-z0-9-]+)"/g) || []).map(m => m.slice(13, -1)));
  ['strava-connect', 'save-recalibrate', 'rc-suggest-goals'].forEach(x => acts.delete(x));   // account-only, or not a new build
  acts.forEach(x => assert.equal(a.journeyOnlyAllows(x), true, 'the builder\'s ' + x + ' is refused in journey-only mode'));
  /* the dispatcher asks before anything else */
  assert.match(RUNTIME, /if \(JOURNEY_ONLY_MODE && !journeyOnlyAllows\(action\)\)\{/);
});

test('a session in journey-only mode goes back through the gate for the real app', () => {
  const a = journeyOnly({ storage: { vvv_cloud_session: JSON.stringify({ access_token: 't', expires_at: Date.now() + 3600e3 }) } });
  assert.match(a.renderMainContent(), /One moment/, 'a signed-in visitor is shown the journey instead of being let through');
  const went = []; a.journeyNavigate = u => { went.push(u); return true; }; a.journeyReload = () => went.push('reload');
  a.journeyOnlyLift(true);
  assert.deepEqual(went, ['reload'], 'a granted session does not reload into the gated app');
  a.journeyOnlyLift(false);
  assert.deepEqual(went, ['reload', '/account?why=locked'], 'a refused session loops back into the journey');
  /* nothing is sent to the account before there is one */
  const b = journeyOnly();
  let pushed = 0; b.cloudPutPlan = () => { pushed++; return Promise.resolve(); };
  buildPlan(b, { distanceKey: 'half', weeks: 12 });
  b.scheduleCloudPush();
  assert.equal(pushed, 0);
  assert.equal(b.cloudSignedIn(), false);
});

// ---------------------------------------------------------------------------
// THE SERVER REFUSES AN ANONYMOUS CALLER, WHATEVER THE PAGE DRAWS
// ---------------------------------------------------------------------------
const account = require('../api/account.js');
const voice = require('../api/voice.js');
const strava = require('../api/strava.js');
const garmin = require('../api/garmin.js');
const session = require('../api/session.js');
const adminUser = require('../api/admin-user.js');
const billingWebhook = require('../api/billing-webhook.js');

/* Every route that reads or writes an account, spends money, or calls a
   model. Public routes are listed below them, with why they are public. */
const GUARDED = [
  ['account', account, 'subscription', 'GET'],
  ['account', account, 'subscription', 'POST', { action: 'agree', agreement: 'terms', decision: 'accepted' }],
  ['account', account, 'checkout', 'POST', { period: 'yearly' }],
  ['account', account, 'portal', 'POST'],
  ['account', account, 'account-data', 'GET'],
  ['account', account, 'account-delete', 'POST', { confirm: true }],
  ['account', account, 'coach-memory', 'GET'],
  ['account', account, 'coach-memory', 'POST', { action: 'record', kind: 'decision', code: 'extra_day_declined' }],
  ['voice', voice, 'voice-ask', 'POST', { question: 'How hard today?', context: {} }],
  ['voice', voice, 'voice-tts', 'POST', { text: 'Run easy.' }],
  ['voice', voice, 'voice-note', 'POST', { evidence: { engineNote: 'Run easy.' } }],
  ['voice', voice, 'voice-explain', 'POST', { kind: 'run', evidence: {} }],
  ['strava', strava, 'strava-auth', 'GET'],
  ['strava', strava, 'strava-sync', 'POST'],
  ['strava', strava, 'strava-admin', 'GET'],
  ['session', session, null, 'POST'],
  ['admin', adminUser, null, 'GET'],
  ['billing', billingWebhook, null, 'POST', { type: 'customer.subscription.created' }]
];

test('every account, money or model route refuses an anonymous caller server-side', async () => {
  const restore = setEnv({ VVV_ACCOUNT_REQUIRED: '1', VVV_SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    VVV_VOICE_ENABLED: 'on', ANTHROPIC_API_KEY: 'test-key', VVV_STRAVA_ENABLED: 'on',
    VVV_COMMERCE_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x', VVV_PRICE_WEB_STANDARD_YEARLY: 'price_y' });
  const realFetch = globalThis.fetch;
  const calls = [];
  /* Supabase answers an absent or bad token the way it does: 401. Anything
     sent to a model, to Stripe, or written to a table is recorded. */
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
  };
  try {
    for (const [name, handler, route, method, body] of GUARDED){
      const q = route ? (name === 'account' ? { resource: route } : { route: route }) : {};
      const req = { method, headers: {}, query: q, url: '/api/' + (route || name), body: body || {} };
      const res = mockRes();
      calls.length = 0;
      await handler(req, res);
      const label = (route || name) + ' ' + method;
      assert.ok(res.statusCode >= 400, label + ' answered ' + res.statusCode + ' to an anonymous caller');
      calls.forEach(c => {
        assert.doesNotMatch(c.url, /anthropic|api\.stripe\.com|elevenlabs|openai/i, label + ' spent money for nobody: ' + c.url);
        assert.ok(!(/\/rest\/v1\//.test(c.url) && c.method !== 'GET'), label + ' wrote to the database for nobody: ' + c.method + ' ' + c.url);
      });
    }
  } finally { globalThis.fetch = realFetch; restore(); }
});

test('the Strava return, hit by nobody, sends the browser back with a refusal and connects nothing', async () => {
  /* An OAuth callback answers with a redirect by nature, so "4xx" is not its
     shape: what it must not do is exchange a code or store a token. */
  const restore = setEnv({ VVV_STRAVA_ENABLED: 'on', STRAVA_CLIENT_ID: '1', STRAVA_CLIENT_SECRET: 's',
    VVV_SUPABASE_SERVICE_ROLE_KEY: 'test-service' });
  const realFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push(String(url) + ' ' + ((opts && opts.method) || 'GET'));
    return { ok: false, status: 401, json: async () => ({}), text: async () => '' }; };
  try {
    const res = mockRes();
    await strava({ method: 'GET', headers: {}, query: { route: 'strava-callback', code: 'abc' }, url: '/api/strava-callback?code=abc' }, res);
    assert.equal(res.statusCode, 302);
    assert.doesNotMatch(String(res.headers.location || ''), /strava=connected/);
    calls.forEach(c => {
      assert.doesNotMatch(c, /strava\.com\/(api\/v3\/)?oauth\/token/, 'a code was exchanged for nobody');
      assert.doesNotMatch(c, /\/rest\/v1\/[^ ]* (POST|PATCH|PUT|DELETE)$/, 'a token was stored for nobody');
    });
  } finally { globalThis.fetch = realFetch; restore(); }
});

test('what an anonymous journey may reach on the server is public by design, and says nothing about anybody', async () => {
  /* The catalogue and the agreement wording (the trial screen's prices), the
     ways in (Make It Yours), and whether the voice, Strava and Garmin exist
     at all (configuration probes that read no account and call nothing).
     POST /api/preview is public too, by its own earlier design: it runs the
     plan engine on the answers given and reads no account. */
  const restore = setEnv({ VVV_AUTH_PROVIDERS: undefined });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('a public route reached the network'); };
  try {
    const cases = [[account, { resource: 'checkout' }], [voice, { route: 'voice-enabled' }],
      [strava, { route: 'strava-enabled' }], [garmin, { route: 'garmin-status' }]];
    for (const [h, q] of cases){
      const res = mockRes();
      await h({ method: 'GET', headers: {}, query: q, url: '/api/x' }, res);
      assert.equal(res.statusCode, 200);
      assert.doesNotMatch(String(res.body), /"email"|user_id|uid/);
    }
    const signin = require('../api/beta-signin.js');
    const res = mockRes();
    await signin({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 200);
  } finally { globalThis.fetch = realFetch; restore(); }
});
