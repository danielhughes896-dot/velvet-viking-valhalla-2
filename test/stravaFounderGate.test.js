'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../api/_strava.js');

/* FOUNDER-ONLY STRAVA ACCESS
 * ===========================================================================
 * Strava's API Policy (effective 1 June 2026) leaves a real question open
 * about Valhalla's coaching use, and written clarification has been requested.
 * Until it arrives the integration is exercised end to end by exactly one
 * account, so the deployment can be verified for real without any other
 * athlete's Strava Data being processed at all.
 *
 * THE TWO PROPERTIES EVERYTHING HERE PROTECTS:
 *
 *   1. IT FAILS CLOSED IN EVERY DIRECTION. Unset, empty, whitespace,
 *      malformed, wildcard, no user, wrong user -- all the same answer, and
 *      the answer is no. There is deliberately no "allow all" value.
 *   2. THE BROWSER IS NEVER ASKED. Hiding a button is presentation; the gate
 *      is the server comparing the verified account id on the JWT against a
 *      list only the deployment holds.
 */

const ROOT = path.join(__dirname, '..');
const FOUNDER = '11111111-2222-3333-4444-555555555555';
const OTHER   = '99999999-8888-7777-6666-555555555555';
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function withEnv(vars, run){
  const saved = {};
  Object.keys(vars).forEach(k => { saved[k] = process.env[k]; 
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; });
  try { return run(); }
  finally { Object.keys(saved).forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
}
const on = extra => Object.assign({ VVV_STRAVA_ENABLED: '1' }, extra || {});

// ---------------------------------------------------------------------------
// FAIL CLOSED
// ---------------------------------------------------------------------------
test('the allowlist fails closed in every direction', () => {
  const cases = [
    ['unset',            undefined],
    ['empty',            ''],
    ['whitespace',       '   '],
    ['malformed',        'not-a-uuid'],
    ['partial uuid',     '11111111-2222'],
    ['wildcard',         '*'],
    ['sql-ish wildcard', '%'],
    ['a name',           'daniel'],
    ['an email',         'someone@example.com']
  ];
  cases.forEach(([label, value]) => {
    withEnv(on({ VVV_STRAVA_ALLOWED_USER_IDS: value }), () => {
      assert.equal(S.stravaPermitted(FOUNDER), false, label + ' allowed access');
    });
  });
});

test('there is deliberately no allow-all value', () => {
  /* A wildcard would make an accidental `*` in a dashboard field
     indistinguishable from a decision, and this is not a decision anybody
     should be able to take by typo. */
  withEnv(on({ VVV_STRAVA_ALLOWED_USER_IDS: '*' }), () => {
    assert.equal(S.stravaAllowedUserIds().length, 0);
    assert.equal(S.stravaPermitted(FOUNDER), false);
    assert.equal(S.stravaPermitted(OTHER), false);
  });
});

test('an absent user is refused even when the list is valid', () => {
  withEnv(on({ VVV_STRAVA_ALLOWED_USER_IDS: FOUNDER }), () => {
    [null, undefined, '', '   '].forEach(uid =>
      assert.equal(S.stravaPermitted(uid), false, JSON.stringify(uid) + ' was allowed'));
  });
});

test('the deployment switch and the allowlist are both required', () => {
  withEnv({ VVV_STRAVA_ENABLED: '', VVV_STRAVA_ALLOWED_USER_IDS: FOUNDER }, () => {
    assert.equal(S.stravaPermitted(FOUNDER), false, 'the switch alone must not be bypassable');
  });
  withEnv(on({ VVV_STRAVA_ALLOWED_USER_IDS: '' }), () => {
    assert.equal(S.stravaPermitted(FOUNDER), false, 'the list alone must not be bypassable');
  });
});

// ---------------------------------------------------------------------------
// WHO IS ALLOWED
// ---------------------------------------------------------------------------
test('exactly the listed account is permitted, and nobody else', () => {
  withEnv(on({ VVV_STRAVA_ALLOWED_USER_IDS: FOUNDER }), () => {
    assert.equal(S.stravaPermitted(FOUNDER), true);
    assert.equal(S.stravaPermitted(OTHER), false);
    /* A near miss is a miss. */
    assert.equal(S.stravaPermitted(FOUNDER.slice(0, -1) + '6'), false);
    assert.equal(S.stravaPermitted(FOUNDER + ' '), true, 'surrounding space is trimmed, not matched');
  });
});

test('case and separators do not change who is allowed', () => {
  withEnv(on({ VVV_STRAVA_ALLOWED_USER_IDS: FOUNDER.toUpperCase() }), () =>
    assert.equal(S.stravaPermitted(FOUNDER), true, 'a UUID is case-insensitive'));
  withEnv(on({ VVV_STRAVA_ALLOWED_USER_IDS: OTHER + ', ' + FOUNDER }), () => {
    assert.equal(S.stravaPermitted(FOUNDER), true);
    assert.equal(S.stravaPermitted(OTHER), true);
  });
  withEnv(on({ VVV_STRAVA_ALLOWED_USER_IDS: OTHER + '\n' + FOUNDER }), () =>
    assert.equal(S.stravaPermitted(FOUNDER), true, 'newlines separate too'));
});

test('one malformed entry does not poison a valid list', () => {
  withEnv(on({ VVV_STRAVA_ALLOWED_USER_IDS: 'garbage, ' + FOUNDER + ', *' }), () => {
    assert.equal(S.stravaPermitted(FOUNDER), true);
    assert.equal(S.stravaPermitted(OTHER), false);
    assert.equal(S.stravaAllowedUserIds().length, 1, 'only the well-formed entry survives');
  });
});

// ---------------------------------------------------------------------------
// EVERY SERVER BOUNDARY
// ---------------------------------------------------------------------------
test('every athlete-facing Strava route consults the gate', () => {
  /* Asserted on the source rather than by driving each handler, because what
     matters is that no route can be added that forgets. Each of these is a
     path an athlete can reach with their own token. */
  const gated = {
    'api/_strava-auth.js':     /S\.stravaPermitted\(uid\)/,
    'api/_strava-sync.js':     /S\.stravaAllowedForUser\(uid\)/,
    'api/_strava-callback.js': /S\.stravaAllowedForUser\(uid\)/,
    'api/_strava-enabled.js':  /S\.stravaAllowedForUser\(uid\)/,
    'api/_strava-webhook.js':  /S\.stravaAllowedForUser\(conn\.user_id\)/
  };
  Object.keys(gated).forEach(f =>
    assert.match(read(f), gated[f], f + ' does not consult the founder gate'));
});

test('the OAuth callback is gated where the token would be WRITTEN', () => {
  /* /api/strava-auth already refuses to issue an authorize URL to anybody
     else, but an athlete can arrive holding a link issued before the list
     changed, or one assembled by hand. Refusing where the credential would be
     persisted is what makes the gate real. */
  const src = read('api/_strava-callback.js');
  const gateAt = src.indexOf('stravaAllowedForUser');
  const exchangeAt = src.indexOf('exchangeCode');
  const saveAt = src.indexOf('saveConnection');
  assert.ok(gateAt > 0 && exchangeAt > 0, 'the callback no longer exchanges or no longer gates');
  assert.ok(gateAt < exchangeAt, 'the gate must precede the code exchange');
  if (saveAt > 0) assert.ok(gateAt < saveAt, 'the gate must precede the token write');
});

test('disconnect stays open, deliberately', () => {
  /* Removing an account from the list must never strand a live authorization.
     Disconnect only ever REDUCES what is held, and a gate that could trap a
     connected athlete would be a worse privacy outcome than the one it
     protects. */
  const src = read('api/_strava-auth.js');
  assert.match(src, /action !== 'disconnect' && !S\.stravaPermitted\(uid\)/);
});

test('activity deletion is never blocked by the gate', () => {
  /* A `delete` webhook REMOVES Strava-derived data. Blocking it would turn an
     access restriction into a retention problem, which is the opposite of what
     the policy requires. */
  const src = read('api/_strava-webhook.js');
  assert.match(src, /aspect_type !== 'delete' && !S\.stravaAllowedForUser\(conn\.user_id\)/);
});

test('the webhook resolves the account from the connection, never from the caller', () => {
  /* There is no request token on this path, so the id checked has to be the
     owner of the grant. Resolution is by Strava athlete id, which is UNIQUE
     across connections -- so an event can only land on the account that
     authorised it, and a forged owner_id cannot select somebody else's row. */
  const src = read('api/_strava-webhook.js');
  const resolveAt = src.indexOf('getConnectionByAthlete');
  const gateAt = src.indexOf('stravaAllowedForUser');
  assert.ok(resolveAt > 0 && gateAt > resolveAt,
    'the gate must check the resolved connection owner, not the event payload');
  assert.ok(!/stravaAllowedForUser\(\s*event\./.test(src),
    'the gate must never read an id straight off the event');
});

// ---------------------------------------------------------------------------
// THE BROWSER CANNOT GRANT ITSELF ACCESS
// ---------------------------------------------------------------------------
test('no client-side value can open the gate', () => {
  /* The browser asks for what it may see, so anything the browser can set is
     an answer the browser can forge. The gate reads the verified JWT id and an
     environment variable, and nothing else. */
  const fn = /function stravaAllowedForUser\([^]*?\n\}/.exec(read('api/_strava.js'))[0];
  assert.ok(!/req\b/.test(fn), 'the gate reads the request');
  assert.ok(!/body|query|header/i.test(fn), 'the gate reads caller-supplied input');
  assert.match(fn, /stravaAllowedUserIds\(\)/);
});

test('the founder is not identified by anything but an account id', () => {
  /* Not a name, not an email, not a Strava athlete id, and not a
     localStorage flag. And the id itself is not in the repository. */
  const src = read('api/_strava.js');
  const fn = src.slice(src.indexOf('function stravaAllowedUserIds'),
                       src.indexOf('function stravaPermitted'));
  assert.ok(!/@/.test(fn), 'an email address appears in the gate');
  assert.ok(!/strava_athlete_id|athleteId/.test(fn), 'the gate identifies by Strava id');
  assert.ok(!/localStorage/.test(fn));
  /* No UUID literal anywhere in the runtime or the server modules. */
  const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  ['api/_strava.js', 'api/_strava-auth.js', 'api/_strava-sync.js',
   'api/_strava-callback.js', 'api/_strava-webhook.js', 'api/_strava-enabled.js']
    .forEach(f => assert.ok(!UUID.test(read(f)), f + ' hard-codes an account id'));
});

test('the refusal describes nothing', () => {
  /* An ordinary athlete has no use for the words "allowlist" or "API policy",
     and a refusal that explains its own mechanism describes that mechanism to
     whoever is probing it. The code is the same one the deployment switch
     gives. */
  ['api/_strava-auth.js', 'api/_strava-sync.js', 'api/_strava-enabled.js'].forEach(f => {
    const src = read(f);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    assert.ok(!/allowlist|allow-list|founder/i.test(code),
      f + ' names the mechanism in code an athlete could see');
  });
  assert.match(read('api/_strava-auth.js'), /STRAVA_UNAVAILABLE/);
});

// ---------------------------------------------------------------------------
// THE POLICY WORK IS UNTOUCHED
// ---------------------------------------------------------------------------
test('founder access does not exempt anything from the policy boundary', () => {
  /* Being the founder does not convert Strava-derived metrics into
     unrestricted data. The provenance markers and the AI boundary are
     unchanged, and no taint-stripping shortcut was added. */
  const runtime = read('protected/velvet-viking-valhalla.html');
  ['isStravaDerived', 'stravaDerivedFields', 'aiEligibleDays', 'STRAVA_WRITTEN_FIELDS']
    .forEach(fn => assert.match(runtime, new RegExp('(function|var|const|let) ' + fn + '\\b'),
      fn + ' was removed or renamed'));

  const code = runtime.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/untaint|stripTaint|clearStravaProvenance|forgetProvenance/i.test(code),
    'a taint-stripping shortcut appeared');

  /* And the Article 9 strip still reaches per-split heart rate. */
  const HC = require('../api/_health-consent.js');
  const stripped = HC.stripCovered({ km: 5, hr: 150, splits: [{ km: 1, sec: 280, hr: 148 }] });
  assert.equal(stripped.hr, undefined);
  assert.equal(stripped.splits[0].hr, undefined);
});

test('OAuth state signing is unchanged', () => {
  const src = read('api/_strava.js');
  assert.match(src, /function signState/);
  assert.match(src, /function verifyState/);
  assert.match(src, /createHmac/, 'state is still signed');
  assert.match(read('api/_strava-callback.js'), /S\.verifyState\(q\.state, cfg\.clientSecret\)/,
    'the callback no longer verifies state');
});
