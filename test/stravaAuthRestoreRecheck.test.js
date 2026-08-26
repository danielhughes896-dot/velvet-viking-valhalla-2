'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* STRAVA MUST SURVIVE AUTHENTICATION ARRIVING LATE.
 * ===========================================================================
 * THE DEFECT THIS PINS. Whether an athlete may use Strava is a PER-ATHLETE
 * server answer, so it cannot be answered before there is an athlete to ask
 * about. Two ordinary situations ask it while nobody is signed in yet:
 *
 *   - init()'s launch probe runs on every start, but a start that opens
 *     signed out reaches stravaRefreshStatus() with no session, which returns
 *     early and leaves availability at its fail-closed default;
 *   - Settings opened before the session restores latches __vvvStravaProbed
 *     against a tokenless answer for the whole session.
 *
 * On Android neither is recoverable, because the sign-in link returns over a
 * custom scheme through handleAuthDeepLink() rather than as a page load: there
 * is no reload to re-run the launch probe. The athlete signs in successfully
 * and Sync & Export draws Garmin Connect, Garmin File Import and Export to
 * iCal -- none of which are gated -- but NO STRAVA AT ALL, until the app is
 * restarted. That is the signed Play-build symptom this file reproduces.
 *
 * WHAT THE FIX MUST NOT COST. The gate still fails closed, the server is still
 * the only thing that can open it, and an athlete the deployment refuses must
 * be asked once per sign-in and never enter a retry loop.
 */

const TODAY = '2026-08-24';
const LIVE_SESSION = () => ({
  access_token: 'access-token', refresh_token: 'refresh-token',
  expires_at: Date.now() + 3600000, user_id: 'user-uuid', email: 'founder@example.com',
});

/* `enabled` is what the SERVER says on the status round trip -- the same field
   /api/strava-auth already carries beside connection status, so availability
   and connection can never disagree on the one screen. */
function app(opts) {
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {}; a.patchCloudCard = () => {};
  a.calls = [];
  a.fetch = (url, init) => {
    const u = String(url);
    const authed = !!(init && init.headers &&
      (init.headers.Authorization || init.headers.authorization));
    a.calls.push({ url: u, authed });
    // The unauthenticated availability probe. Signed out, the honest answer is
    // false -- and that is the answer this whole file is about recovering from.
    if (u.indexOf('/api/strava-enabled') !== -1)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ enabled: false }) });
    if (u.indexOf('/api/strava-auth') !== -1) {
      if (o.statusFails) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'server' }) });
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve({ enabled: o.enabled === true, connected: false }) });
    }
    if (u.indexOf('/auth/v1/user') !== -1)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'user-uuid', email: 'founder@example.com' }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  };
  return a;
}

const settle = () => new Promise(r => setTimeout(r, 40));
const countStatus = a => a.calls.filter(c => c.url.indexOf('/api/strava-auth') !== -1).length;

// ---------------------------------------------------------------------------
// THE SYMPTOM
// ---------------------------------------------------------------------------
test('Settings opened before the session restores gets a tokenless answer, and draws no Strava', async () => {
  const a = app({ enabled: true });
  assert.equal(a.cloudSignedIn(), false, 'the session has not restored yet');

  await a.stravaCheckAvailability();

  assert.equal(a.stravaAvailable, false, 'the fail-closed default survives an unauthenticated answer');
  assert.equal(a.calls.length, 1, 'exactly one probe was made');
  assert.equal(a.calls[0].authed, false, 'and it carried no bearer token, because there was none');
  assert.equal(a.renderStravaSection(), '<div id="strava-section"></div>',
    'Sync & Export draws an empty wrapper -- the reported symptom');
});

// ---------------------------------------------------------------------------
// THE RECOVERY
// ---------------------------------------------------------------------------
test('a session restoring after that probe re-asks, and an eligible athlete gets the UI with no restart', async () => {
  const a = app({ enabled: true });

  await a.stravaCheckAvailability();
  assert.equal(a.stravaAvailable, false);

  // Supabase restores the session.
  a.cloudSession = LIVE_SESSION();
  assert.equal(a.cloudSignedIn(), true);

  assert.equal(a.stravaRecheckAfterAuth(), true, 'the re-check runs');
  await settle();

  assert.equal(a.stravaAvailable, true, 'the server was asked again, this time about an athlete');
  assert.equal(countStatus(a), 1, 'one status round trip, not a burst');
  const authed = a.calls.filter(c => c.url.indexOf('/api/strava-auth') !== -1)[0];
  assert.equal(authed.authed, true, 'and it carried the restored bearer token');

  const html = a.renderStravaSection();
  assert.match(html, /strava-connect/, 'the Connect control is drawn');
  assert.notEqual(html, '<div id="strava-section"></div>', 'the empty wrapper is gone');
});

test('the native sign-in deep link recovers Strava end to end, which is the Android path', async () => {
  const a = app({ enabled: true });

  // Settings was opened first, signed out -- the latch is already set.
  await a.stravaCheckAvailability();
  assert.equal(a.stravaAvailable, false);

  /* The custom-scheme return. No page load happens here, so init()'s launch
     probe cannot run again -- which is precisely why the deep-link path has to
     ask for itself. */
  const handled = a.handleAuthDeepLink(
    'com.velvetviking.valhalla://auth#access_token=AAA&refresh_token=BBB&expires_in=3600');
  assert.equal(handled, true, 'the link carried a session');
  await settle();

  assert.equal(a.cloudSignedIn(), true, 'the athlete is signed in');
  assert.equal(a.stravaAvailable, true, 'and Strava was re-asked without a restart');
  assert.match(a.renderStravaSection(), /strava-connect/, 'Sync & Export now offers Strava');
});

// ---------------------------------------------------------------------------
// AN ATHLETE THE DEPLOYMENT DOES NOT PERMIT
// ---------------------------------------------------------------------------
test('a refused athlete is asked once per sign-in and never enters a retry loop', async () => {
  const a = app({ enabled: false });

  await a.stravaCheckAvailability();
  a.cloudSession = LIVE_SESSION();

  assert.equal(a.stravaRecheckAfterAuth(), true, 'the question is asked');
  await settle();

  assert.equal(a.stravaAvailable, false, 'the server said no, and no is respected');
  assert.equal(countStatus(a), 1, 'exactly one status request');

  /* THE LOOP CHECK. Nothing re-triggers this on its own: the caller is a
     discrete sign-in event, not a render, a timer or a poll. Time passing
     must therefore cost nothing at all. */
  await settle(); await settle();
  assert.equal(countStatus(a), 1, 'no further request appeared on its own');
  assert.equal(a.stravaAvailable, false, 'and availability never flipped');

  // Re-rendering the screen the card lives on must not ask either.
  a.renderStravaSection(); a.renderStravaSection(); a.renderStravaSection();
  await settle();
  assert.equal(countStatus(a), 1, 'rendering is not a trigger');
  assert.equal(a.renderStravaSection(), '<div id="strava-section"></div>',
    'a refused athlete is offered nothing, which is the founder-only rule');
});

test('a second sign-in for a refused athlete costs one more request and no more', async () => {
  const a = app({ enabled: false });
  /* Let init()'s launch probe run signed out first, which is the real order:
     the app opens, asks, gets nothing because there is no session, and only
     then does authentication arrive. */
  await settle();
  assert.equal(countStatus(a), 0, 'the launch probe makes no Strava request signed out');
  a.cloudSession = LIVE_SESSION();

  a.stravaRecheckAfterAuth(); await settle();
  assert.equal(countStatus(a), 1);

  a.stravaRecheckAfterAuth(); await settle();
  assert.equal(countStatus(a), 2, 'one per discrete sign-in event, bounded by the caller');
  assert.equal(a.stravaAvailable, false);
});

// ---------------------------------------------------------------------------
// SELF-LIMITING, AND FAIL-CLOSED
// ---------------------------------------------------------------------------
test('once Strava is available the re-check never asks again', async () => {
  const a = app({ enabled: true });
  await settle();
  assert.equal(countStatus(a), 0, 'the launch probe makes no Strava request signed out');
  a.cloudSession = LIVE_SESSION();

  a.stravaRecheckAfterAuth(); await settle();
  assert.equal(a.stravaAvailable, true);
  assert.equal(countStatus(a), 1);

  assert.equal(a.stravaRecheckAfterAuth(), false, 'the guard short-circuits');
  assert.equal(a.stravaRecheckAfterAuth(), false);
  await settle();
  assert.equal(countStatus(a), 1, 'and no request was made');
});

test('the re-check does nothing while signed out', async () => {
  const a = app({ enabled: true });
  assert.equal(a.cloudSignedIn(), false);
  assert.equal(a.stravaRecheckAfterAuth(), false, 'there is no athlete to ask about');
  await settle();
  assert.equal(countStatus(a), 0, 'no Strava request is made signed out');
  assert.equal(a.stravaAvailable, false);
});

test('a failing status round trip leaves Strava off rather than on', async () => {
  const a = app({ statusFails: true });
  a.cloudSession = LIVE_SESSION();

  a.stravaRecheckAfterAuth(); await settle();

  assert.equal(a.stravaAvailable, false, 'a failure can never open the gate');
  assert.equal(a.renderStravaSection(), '<div id="strava-section"></div>');
});

test('a Strava failure never reports a successful sign-in as an error', async () => {
  const a = app({ statusFails: true });
  let cloudErrored = false;
  a.patchCloudCard = () => { if (a.cloudStatus === 'error') cloudErrored = true; };

  const handled = a.handleAuthDeepLink(
    'com.velvetviking.valhalla://auth#access_token=AAA&refresh_token=BBB&expires_in=3600');
  assert.equal(handled, true);
  await settle();

  assert.equal(a.cloudSignedIn(), true, 'the sign-in itself succeeded');
  assert.equal(cloudErrored, false, 'and was not reported as a failure because Strava said no');
  assert.equal(a.stravaAvailable, false, 'Strava stays closed, which is correct');
});

// ---------------------------------------------------------------------------
// THE GATE ITSELF IS UNCHANGED
// ---------------------------------------------------------------------------
test('the re-check reads the server answer and never decides for itself', async () => {
  /* It must be impossible for the client to turn Strava on. The only thing
     that flips availability here is the server's own `enabled` field. */
  const refused = app({ enabled: false });
  refused.cloudSession = LIVE_SESSION();
  refused.stravaRecheckAfterAuth(); await settle();
  assert.equal(refused.stravaAvailable, false);

  const permitted = app({ enabled: true });
  permitted.cloudSession = LIVE_SESSION();
  permitted.stravaRecheckAfterAuth(); await settle();
  assert.equal(permitted.stravaAvailable, true);
});
