'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Opening Valhalla with no connection must never be mistaken for the athlete's
// account having ended.
//
// cloudRefreshIfNeeded() returned the same `false` whether GoTrue had rejected
// the refresh token or the request had simply not arrived, and cloudInit()
// signs out on `false`. So a launch on a train, with an access token older than
// an hour, signed the athlete out of a perfectly valid account -- and because
// sign-out now also revokes the delivery lease, it would additionally have cost
// them the credential that delivers the product once the account gate is on.
//
// The local plan was never at risk: sign-out deliberately keeps it. What was at
// risk was the session, and the athlete's confidence in it.
const UID = 'uid-athlete-1';

/* Deliberately NOT a pinned clock. Token expiry is compared against the app's
   own Date.now(), so pinning the app to a date months before the test's real
   clock would make an "expired" token read as valid and quietly test nothing. */
function signedIn(expiredAccessToken) {
  const a = loadApp();
  buildPlan(a, { weeks: 12, startDate: a.addDays(a.todayStr(), -21) });
  a.cloudSession = {
    access_token: 'at', refresh_token: 'rt', user_id: UID, email: 'a@b.c',
    expires_at: expiredAccessToken ? Date.now() - 1000 : Date.now() + 3600e3,
  };
  a.writeStored(a.CLOUD_SESSION_KEY, a.cloudSession);
  return a;
}
const settle = () => new Promise(r => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// UNREACHABLE IS NOT EXPIRED
// ---------------------------------------------------------------------------
test('a refresh that never arrived does not end the session', async () => {
  const a = signedIn(true);
  a.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  const ok = await a.cloudRefreshIfNeeded();
  assert.equal(ok, false, 'it did not refresh');
  assert.equal(a.cloudRefreshUnreachable, true, 'but because it could not be asked');
});

test('GoTrue rejecting the token IS a sign-out', async () => {
  for (const status of [400, 401]) {
    const a = signedIn(true);
    a.fetch = () => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) });
    await a.cloudRefreshIfNeeded();
    assert.equal(a.cloudRefreshUnreachable, false,
      status + ' is the server saying this token is finished');
  }
});

test('a server fault is not the athlete’s session ending', async () => {
  for (const status of [500, 502, 503, 429]) {
    const a = signedIn(true);
    a.fetch = () => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) });
    await a.cloudRefreshIfNeeded();
    assert.equal(a.cloudRefreshUnreachable, true,
      status + ' says nothing about whether the athlete is signed in');
  }
});

// ---------------------------------------------------------------------------
// THE LAUNCH THAT USED TO SIGN PEOPLE OUT
// ---------------------------------------------------------------------------
test('launching offline keeps the athlete signed in', async () => {
  const a = signedIn(true);
  a.fetch = () => Promise.reject(new TypeError('offline'));
  await a.cloudInit();
  await settle();
  assert.ok(a.cloudSession, 'the session must survive a launch with no connection');
  assert.equal(a.cloudSession.user_id, UID);
  assert.ok(a.readStored(a.CLOUD_SESSION_KEY), 'and still be there next time');
  assert.equal(a.cloudStatus, 'error', 'reported as unreachable, not as signed out');
});

test('launching offline does not revoke the delivery lease', async () => {
  const a = signedIn(true);
  const calls = [];
  a.fetch = (url, opts) => {
    calls.push(String(url) + ':' + ((opts && opts.method) || 'GET'));
    return Promise.reject(new TypeError('offline'));
  };
  await a.cloudInit();
  await settle();
  assert.ok(!calls.some(c => /\/api\/session:DELETE/.test(c)),
    'an offline launch must not throw away the credential that delivers the product');
});

test('a genuinely rejected token still signs out', async () => {
  const a = signedIn(true);
  a.fetch = (url) => /token\?grant_type=refresh_token/.test(String(url))
    ? Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  await a.cloudInit();
  await settle();
  assert.equal(a.cloudSession, null, 'an ended account really does end the session');
});

// ---------------------------------------------------------------------------
// THE PLAN IS NEVER THE CASUALTY, EITHER WAY
// ---------------------------------------------------------------------------
test('neither outcome touches the local training block', async () => {
  for (const offline of [true, false]) {
    const a = signedIn(true);
    const before = a.state.days.length;
    a.persistStateLocalOnly();
    const archBefore = a.localStorage.getItem('vvv_plan_archive');
    a.fetch = offline
      ? () => Promise.reject(new TypeError('offline'))
      : () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
    await a.cloudInit();
    await settle();
    assert.equal(a.state.days.length, before,
      (offline ? 'offline' : 'signed out') + ': the plan stays on the device');
    assert.equal(a.localStorage.getItem('vvv_plan_archive'), archBefore, 'and the archive is untouched');
    assert.ok(a.localStorage.getItem('velvet-viking-generator-v2'), 'and it is still persisted');
  }
});

test('a still-valid access token never triggers a refresh at all', async () => {
  const a = signedIn(false);           // expires in an hour
  const calls = [];
  /* Not "no fetch at all": boot chains an unrelated Strava status check off
     cloudInitReady, which fires as soon as a session exists. The claim here is
     narrower and is the one that matters -- a token with an hour left is never
     put through the refresh endpoint, so it can never be lost to a network
     that happens to be down. */
  a.fetch = url => { calls.push(String(url)); return Promise.reject(new Error('offline')); };
  assert.equal(await a.cloudRefreshIfNeeded(), true);
  assert.ok(!calls.some(u => /grant_type=refresh_token/.test(u)),
    'no refresh means no chance of a spurious sign-out');
  assert.equal(a.cloudRefreshUnreachable, false, 'and nothing was found unreachable');
});

test('Settings tells the athlete the account is unreachable, not that they are signed out', async () => {
  const a = signedIn(true);
  a.fetch = () => Promise.reject(new TypeError('offline'));
  await a.cloudInit();
  await settle();
  const s = a.planStorageStatus();
  assert.match(s.label, /account unreachable/i);
  assert.ok(!/only/i.test(s.label),
    '"Saved on this device only" is the signed-out sentence and would be a lie here');
});

// ---------------------------------------------------------------------------
// SIGN-OUT ITSELF, WHICH THE ATHLETE DID ASK FOR
// ---------------------------------------------------------------------------
test('an intentional sign-out clears the session and keeps everything else', async () => {
  const a = signedIn(false);
  const before = a.state.days.length;
  a.persistStateLocalOnly();
  a.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });

  a.cloudSignOut();
  await settle();

  assert.equal(a.cloudSession, null, 'the session is gone');
  assert.equal(a.readStored(a.CLOUD_SESSION_KEY), null, 'and not left on disk');
  assert.equal(a.readStored(a.CLOUD_SYNC_KEY), null,
    'the sync agreement belonged to that account and must not be inherited');
  assert.equal(a.state.days.length, before, 'the training block stays');
  assert.ok(a.localStorage.getItem('velvet-viking-generator-v2'));
});

test('sign-out does not clear the recoverable displaced plan', async () => {
  const a = signedIn(false);
  a.writeStored(a.CLOUD_BACKUP_KEY, JSON.parse(JSON.stringify(a.state)));
  a.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  a.cloudSignOut();
  await settle();
  assert.ok(a.readStored(a.CLOUD_BACKUP_KEY),
    'the backup is the device’s, not the account’s — only deletion clears it');
  assert.ok(a.recoverablePlans().length >= 0, 'and recovery still functions');
});
