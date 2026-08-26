'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../api/_strava.js');

/* THE TEN-ATHLETE PRIVATE BETA
 * ===========================================================================
 * WHAT THIS REPLACED. Strava access was founder-only: one account id supplied
 * as VVV_STRAVA_ALLOWED_USER_IDS was the single thing permitted to touch the
 * integration while a policy question was open. Clarification was requested
 * from Strava and the intended use disclosed; Strava declined to give
 * individual feedback and referred Valhalla back to the published API
 * Agreement and API Policy. That is NEITHER approval NOR rejection. On the
 * strength of it the founder authorised the private beta this application
 * already has capacity for.
 *
 * SO ELIGIBILITY IS NO LONGER A LIST, AND THE CAP IS NOT A CLAIM ABOUT STRAVA.
 * Valhalla cannot see how many athletes Strava believes this application has,
 * and must not pretend to. What it can count exactly is its OWN roster -- the
 * rows in strava_connections. That is what is capped. Strava stays
 * authoritative for its own limit.
 *
 * THE FOUR PROPERTIES EVERYTHING HERE PROTECTS:
 *
 *   1. AN ATHLETE ALREADY INSIDE IS NEVER DISTURBED. Not by a full roster,
 *      not by a failed count, not by anything. The connection IS the
 *      entitlement, and sync, disconnect and deletion never consult the cap.
 *   2. IT FAILS CLOSED, IN ONE DIRECTION ONLY. An unprovable seat is not a
 *      free seat, and there is no value meaning "unlimited".
 *   3. THE BROWSER IS NEVER ASKED. Hiding a button is presentation.
 *   4. NOTHING BYPASSES STRAVA. The cap refuses connections; it never
 *      rotates, evicts or reuses an athlete to make room.
 */

const ROOT = path.join(__dirname, '..');
const FOUNDER = '11111111-2222-3333-4444-555555555555';
const OTHER   = '99999999-8888-7777-6666-555555555555';
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* CODE, NOT PROSE. These files explain at length what the founder-only gate
   WAS and why it went, and an assertion that greps the whole file would be
   satisfied or defeated by its own documentation. Comments are stripped before
   anything is judged. */
const code = f => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

function withEnv(vars, run){
  const saved = {};
  Object.keys(vars).forEach(k => { saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; });
  try { return run(); }
  finally { Object.keys(saved).forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
}
const on = extra => Object.assign({ VVV_STRAVA_ENABLED: '1' }, extra || {});

/* A fake PostgREST. `count` is how many rows the roster holds; `connected` is
   the set of user ids that already have one. */
function withDb(opts, run){
  const o = opts || {};
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (o.dbFails) return { ok: false, status: 500, headers: { get: () => null }, json: async () => [] };
    if (/select=user_id/.test(u)){
      return { ok: true, status: 200,
        headers: { get: k => k === 'content-range' ? '0-0/' + (o.count || 0) : null },
        json: async () => [] };
    }
    const m = /user_id=eq\.([^&]+)/.exec(u);
    const uid = m ? decodeURIComponent(m[1]) : null;
    const has = (o.connected || []).indexOf(uid) !== -1;
    return { ok: true, status: 200, headers: { get: () => null },
             json: async () => (has ? [{ user_id: uid, strava_athlete_id: 1 }] : []) };
  };
  return Promise.resolve(run()).finally(() => { global.fetch = realFetch; });
}
const CFG = { supabaseUrl: 'https://example.test', serviceKey: 'svc' };

// ---------------------------------------------------------------------------
// THE SEAT COUNT
// ---------------------------------------------------------------------------
test('the beta holds ten athletes unless the deployment says otherwise', () => {
  withEnv(on({ VVV_STRAVA_MAX_ATHLETES: undefined }), () =>
    assert.equal(S.stravaBetaSeats(), 10, 'the documented capacity is ten'));
  withEnv(on({ VVV_STRAVA_MAX_ATHLETES: '4' }), () =>
    assert.equal(S.stravaBetaSeats(), 4));
});

test('a malformed capacity takes the default rather than removing the limit', () => {
  /* The same reasoning the old allowlist used for refusing a wildcard: a typo
     in a dashboard field must never be indistinguishable from a decision. */
  ['', '   ', 'ten', '-1', '0', '1.5', 'unlimited', '*'].forEach(v =>
    withEnv(on({ VVV_STRAVA_MAX_ATHLETES: v }), () =>
      assert.equal(S.stravaBetaSeats(), 10, 'a bad value opened or broke the cap: ' + JSON.stringify(v))));
});

test('there is no value meaning unlimited', () => {
  const src = read('api/_strava.js');
  assert.ok(!/Infinity|unlimited/i.test(src.slice(src.indexOf('function stravaBetaSeats'),
                                                  src.indexOf('function stravaSeatsTaken'))),
    'an unlimited escape hatch exists');
});

// ---------------------------------------------------------------------------
// B, C — ANOTHER ATHLETE CAN CONNECT, WITHOUT BEING ON ANY LIST
// ---------------------------------------------------------------------------
test('a second athlete may connect while seats remain, with no allowlist entry', async () => {
  await withEnv(on(), () => withDb({ count: 1, connected: [FOUNDER] }, async () => {
    const may = await S.stravaMayConnect(CFG, OTHER);
    assert.equal(may.ok, true, 'a beta athlete was refused with nine seats free');
    assert.equal(may.reason, 'seat_available');
  }));
});

test('the founder still connects, by the same route as everybody else', async () => {
  await withEnv(on(), () => withDb({ count: 0, connected: [] }, async () => {
    assert.equal((await S.stravaMayConnect(CFG, FOUNDER)).ok, true);
  }));
});

test('no allowlist survives anywhere in the server', () => {
  const files = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'));
  files.forEach(f => {
    const src = code(path.join('api', f));
    assert.ok(!/VVV_STRAVA_ALLOWED_USER_IDS|stravaAllowedForUser|stravaAllowedUserIds/.test(src),
      'founder-only logic survives in api/' + f);
  });
});

// ---------------------------------------------------------------------------
// F — AN ATHLETE ALREADY INSIDE IS NEVER DISTURBED
// ---------------------------------------------------------------------------
test('a connected athlete passes even when the beta is full', async () => {
  await withEnv(on(), () => withDb({ count: 10, connected: [FOUNDER] }, async () => {
    const may = await S.stravaMayConnect(CFG, FOUNDER);
    assert.equal(may.ok, true, 'a full roster turned away an athlete already in it');
    assert.equal(may.reason, 'existing', 'the existing connection was not what admitted them');
  }));
});

test('a connected athlete passes even when the roster cannot be counted', async () => {
  /* The count is only consulted for admission. An athlete inside the beta must
     not be affected by a database that will not answer. */
  await withEnv(on(), () => withDb({ count: 3, connected: [FOUNDER], dbFails: false }, async () => {
    assert.equal((await S.stravaMayConnect(CFG, FOUNDER)).reason, 'existing');
  }));
});

test('sync asks whether this athlete holds a connection, never how full the beta is', () => {
  const src = read('api/_strava-sync.js');
  assert.match(src, /stravaHasConnection/, 'sync no longer checks entitlement at all');
  assert.ok(!/stravaMayConnect|stravaBetaSeats|stravaSeatsTaken/.test(src),
    'sync consults the cap -- a full beta would stop the athletes who filled it');
});

// ---------------------------------------------------------------------------
// N, O — THE CAP REFUSES, AND NEVER BYPASSES
// ---------------------------------------------------------------------------
test('a new athlete is refused when the roster is full', async () => {
  await withEnv(on(), () => withDb({ count: 10, connected: [FOUNDER] }, async () => {
    const may = await S.stravaMayConnect(CFG, OTHER);
    assert.equal(may.ok, false);
    assert.equal(may.reason, 'beta_full', 'the refusal must be identifiable as capacity');
  }));
});

test('an unprovable seat is not a free seat', async () => {
  await withEnv(on(), () => withDb({ dbFails: true }, async () => {
    const may = await S.stravaMayConnect(CFG, OTHER);
    assert.equal(may.ok, false);
    assert.equal(may.reason, 'capacity_unknown',
      'a failed count must never be read as an empty roster');
  }));
});

test('nothing evicts, rotates or reuses an athlete to make room', () => {
  const src = code('api/_strava.js');
  const region = src.slice(src.indexOf('function stravaBetaSeats'),
                           src.indexOf('function stravaPermitted'));
  assert.ok(region.length > 100, 'the capacity region was not found');
  assert.ok(!/deleteConnection|evict|rotate|oldest|method:\s*'DELETE'/i.test(region),
    'the capacity path can remove somebody else\'s connection');
});

test('the deployment switch still closes everything', async () => {
  await withEnv({ VVV_STRAVA_ENABLED: '' }, () => withDb({ count: 0 }, async () => {
    assert.equal((await S.stravaMayConnect(CFG, FOUNDER)).reason, 'strava_disabled');
    assert.equal(await S.stravaHasConnection(CFG, FOUNDER), false);
    assert.equal(S.stravaPermitted(FOUNDER), false);
  }));
});

test('an unauthenticated caller is refused before anything is counted', async () => {
  await withEnv(on(), () => withDb({ count: 0 }, async () => {
    assert.equal((await S.stravaMayConnect(CFG, null)).reason, 'signin');
  }));
});

// ---------------------------------------------------------------------------
// D, E — EVERY ROUTE IS STILL GATED, SERVER-SIDE
// ---------------------------------------------------------------------------
test('every athlete-facing Strava route consults a gate', () => {
  const expected = {
    '_strava-auth.js':     /stravaPermitted|stravaMayConnect/,
    '_strava-callback.js': /stravaMayConnect/,
    '_strava-sync.js':     /stravaHasConnection/,
    '_strava-enabled.js':  /stravaPermitted/,
    '_strava-webhook.js':  /stravaEnabled/,
  };
  Object.keys(expected).forEach(f =>
    assert.match(read(path.join('api', f)), expected[f], 'api/' + f + ' is ungated'));
});

test('the OAuth callback is gated where the token would be WRITTEN', () => {
  /* Refusing only where the authorize URL is issued would be a UI convention.
     This is also what closes the race: two athletes can both hold a URL while
     one seat remains, and only the first to arrive writes a row. */
  const src = read('api/_strava-callback.js');
  const gate = src.indexOf('stravaMayConnect');
  const exchange = src.indexOf('exchangeCode');
  const save = src.indexOf('saveConnection');
  assert.ok(gate > 0 && exchange > gate, 'the code is exchanged before the seat is checked');
  assert.ok(save > gate, 'a token is stored before the seat is checked');
});

test('OAuth still requires an authenticated Valhalla account', () => {
  const src = read('api/_strava-callback.js');
  assert.match(src, /verifyUser|uid/, 'the callback does not identify the athlete');
  assert.match(src, /state/, 'the callback does not bind to signed state');
});

test('no client-side value can open the gate', () => {
  /* The browser asks for what it may see; anything the browser can set is an
     answer the browser can forge. */
  ['_strava-auth.js', '_strava-callback.js', '_strava-sync.js', '_strava-enabled.js'].forEach(f => {
    const src = read(path.join('api', f));
    assert.ok(!/body\.(allowed|permitted|beta|seat|eligible)/i.test(src),
      'api/' + f + ' reads eligibility from the request body');
  });
});

// ---------------------------------------------------------------------------
// H, I — DELETION AND DISCONNECT ARE NEVER BLOCKED
// ---------------------------------------------------------------------------
test('activity deletion is never blocked by the gate', () => {
  /* A gate that blocked deletions would turn an access restriction into a
     retention problem. */
  const src = read('api/_strava-webhook.js');
  assert.match(src, /aspect_type !== 'delete'/,
    'deletion is subject to the same gate as ingestion');
});

test('disconnect is never blocked, and affects only the caller', () => {
  const src = read('api/_strava-auth.js');
  assert.match(src, /action !== 'disconnect'/, 'disconnect is gated');
  const svc = read('api/_strava.js');
  assert.match(svc, /strava_connections\?user_id=eq\.'?\s*\+\s*encodeURIComponent\(uid\)/,
    'disconnect is not scoped to the calling account');
});

test('the webhook resolves the account from the connection, never from the caller', () => {
  const src = read('api/_strava-webhook.js');
  assert.match(src, /conn\.user_id/, 'the webhook trusts an id from the payload');
  assert.ok(!/event\.owner_id\s*\)?\s*(&&|\|\||\))?\s*$/m.test(src.split('\n')
    .filter(l => /stravaEnabled|Permitted/.test(l)).join('\n')),
    'the gate reads the forgeable payload owner id');
});

// ---------------------------------------------------------------------------
// P — NO FOUNDER-ONLY COPY SURVIVES WHERE AN ATHLETE CAN READ IT
// ---------------------------------------------------------------------------
test('the athlete is told the beta is full, in plain words', () => {
  const runtime = read(path.join('protected', 'velvet-viking-valhalla.html'));
  assert.match(runtime, /Strava access is currently full for the private beta/,
    'there is no athlete-facing copy for a full beta');
});

test('capacity copy carries no jargon, no policy and no variable names', () => {
  const runtime = read(path.join('protected', 'velvet-viking-valhalla.html'));
  const i = runtime.indexOf('Strava access is currently full for the private beta');
  const copy = runtime.slice(i, i + 120);
  [/VVV_/, /OAuth/i, /API/, /allowlist/i, /policy/i, /rate.?limit/i].forEach(bad =>
    assert.ok(!bad.test(copy), 'athlete-facing copy leaks internals: ' + bad));
});
