'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// PHASE 5 -- RELEASE READINESS.
//
// Every test here exists because the Phase 5 audit found the thing it describes
// and then fixed it. None of them is a restatement of an implementation detail:
// each one failed against a657c51 and passes now, and each protects something
// an athlete or an invoice depends on.
//
// The commercial-activation tests are the exception to that shape, and
// deliberately so. Nothing is fixed there, because the fix is a database
// migration this repository cannot run. What they pin is the FACT that makes
// the migration necessary, so that "we still have to run that before charging
// anyone" is executable rather than a paragraph in a report nobody re-reads.
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SRC = read(RUNTIME_RELATIVE);

const TODAY = '2026-05-20';
const app = () => { const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' }); a.showToast = () => {}; return a; };
const clone = o => JSON.parse(JSON.stringify(o));
const settle = () => new Promise(r => setTimeout(r, 0));

function plan(a, logged) {
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28) });
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(0, logged || 0)
    .forEach(d => { d.completed = true;
                    d.actual = Object.assign(a.emptyActual(), { km: d.km, pace: '5:10' }); });
  return a;
}
const loggedCount = st => (st.days || []).filter(d => d.completed).length;

/* cloudReconcile driven for real, with the account row served from a fixture.
   Returns the requests it made, because the SHAPE of the plan read is itself
   under test. */
function reconcileAgainst(a, remote) {
  const calls = [];
  a.fetch = (url, opts) => {
    calls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    if (/\/rest\/v1\/plans\?select=/.test(String(url)))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
        remote ? [{ data: remote, updated_at: '2026-05-20T08:00:00Z' }] : []) });
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve([{ updated_at: '2026-05-20T09:00:00Z' }]) });
  };
  return a.cloudReconcile().then(settle).then(() => calls);
}

// ---------------------------------------------------------------------------
// 1. THE EXPORT KNOWS WHOSE ACCOUNT IT IS
// ---------------------------------------------------------------------------
/* verifyUser() returned only the uid. Three call sites already asked it for an
   email -- _account-data.js puts it in the athlete's export, session.js and
   _subscription.js render it -- so `who.email` was undefined at all three and
   the export has always said "email": null. An export that omits the
   identifier the account is keyed on is not the whole of what is held. */
test('1. verifyUser hands back the address the account is keyed on', async () => {
  const S = require('../api/_strava.js');
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200,
    json: async () => ({ id: 'uid-1', email: 'athlete@example.com' }) });
  try {
    const who = await S.verifyUser({ headers: { authorization: 'Bearer a.b.c' } },
      { supabaseUrl: 'https://eqiydxissphygnycpouu.supabase.co', anonKey: 'k', serviceKeySource: 'x' });
    assert.equal(who.uid, 'uid-1');
    assert.equal(who.email, 'athlete@example.com',
      'the data export reads this field and reported null for every athlete who ever used it');
  } finally { globalThis.fetch = real; }
});

test('1. a user object with no address yields null rather than undefined', async () => {
  const S = require('../api/_strava.js');
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'uid-2' }) });
  try {
    const who = await S.verifyUser({ headers: { authorization: 'Bearer a.b.c' } },
      { supabaseUrl: 'https://eqiydxissphygnycpouu.supabase.co', anonKey: 'k', serviceKeySource: 'x' });
    assert.equal(who.email, null, 'explicitly absent, not accidentally absent');
  } finally { globalThis.fetch = real; }
});

test('1. the address is never written to a log line', () => {
  const S = require('../api/_strava.js');
  const line = S.diagLine('AUTH_OK', { authHeader: true, jwtShape: true,
    project: 'eqiydxissphygnycpouu.supabase.co', anonKey: true,
    serviceKeySource: 'vvv_namespaced', status: 200, tokenIssuer: 'eqiydxissphygnycpouu.supabase.co' });
  assert.ok(!/@/.test(line), 'diagnostics carry booleans and a status, never an identity: ' + line);
});

// ---------------------------------------------------------------------------
// 2. "YOUR PLAN REMAINS ON THIS DEVICE" SURVIVES THE NEXT SIGN-IN
// ---------------------------------------------------------------------------
/* THE DEFECT. Account deletion cleared the session and the displaced-plan slot
   but left the sync mark -- the record of what this device last agreed with the
   now-deleted account's row about. Deletion also releases the ownership stamp,
   on purpose, so the plan survives locally and the next athlete to sign in here
   adopts it. cloudReconcile then compared local against THEIR account using a
   base signature inherited from the deleted one, read "this device has logged
   nothing new", and took the other account's plan without asking.
   cloudSignOut() has always cleared the mark, and documents exactly why. */
test('2. deletion drops the sync mark, exactly as signing out does', () => {
  const a = plan(app(), 3);
  a.cloudSession = { access_token: 't', user_id: 'uid-old', email: 'a@b.c',
                     expires_at: Date.now() + 3600e3 };
  a.writeSyncMark('2026-05-20T08:00:00Z', a.planContentSignature(a.state));
  assert.ok(a.readSyncMark(), 'the fixture must start with a mark');
  a.cloudSignOut();
  assert.equal(a.readSyncMark(), null, 'sign-out already did this');

  /* The deletion path is confirm-gated and network-bound, so the tail that runs
     after the RPC succeeds is asserted where it lives. The behavioural
     consequence is the next two tests. */
  const at = SRC.indexOf('function handleCloudDeleteAccount');
  assert.ok(at !== -1, 'the deletion handler must be findable');
  const body = SRC.slice(at, SRC.indexOf('\nfunction cloudSignOut', at));
  assert.match(body, /writeStored\(CLOUD_SYNC_KEY,\s*null\)/,
    'deletion must clear the mark or the next account silently wins');
});

test('2. after deletion, a different account cannot silently replace the plan', async () => {
  const a = plan(app(), 4);
  const remote = clone(a.state);
  remote.days.forEach(d => { d.completed = false; delete d.actual; });

  // the state deletion leaves behind: stamp released, mark cleared
  a.writeStored(a.CLOUD_SYNC_KEY, null);
  delete a.state.ownerUid;
  a.cloudSession = { access_token: 't', user_id: 'uid-new', email: 'a@b.c',
                     expires_at: Date.now() + 3600e3 };
  let asked = false;
  a.openModal = () => { asked = true; };

  await reconcileAgainst(a, remote);
  assert.equal(asked, true, 'two genuinely different plans is a question, not a guess');
  assert.equal(loggedCount(a.state), 4, 'and nothing moves until the athlete answers');
});

test('2. a stale mark is what made it silent — the same run with one left behind', async () => {
  const a = plan(app(), 4);
  const remote = clone(a.state);
  remote.days.forEach(d => { d.completed = false; delete d.actual; });
  a.writeSyncMark('2026-05-20T08:00:00Z', a.planContentSignature(a.state));  // the bug
  delete a.state.ownerUid;
  a.cloudSession = { access_token: 't', user_id: 'uid-new', email: 'a@b.c',
                     expires_at: Date.now() + 3600e3 };
  let asked = false;
  a.openModal = () => { asked = true; };

  await reconcileAgainst(a, remote);
  assert.equal(asked, false, 'this is the reproduction, kept so the cause stays legible');
  assert.equal(loggedCount(a.state), 0, 'four logged sessions off the screen with no modal');
  const displaced = a.readStored(a.CLOUD_BACKUP_KEY);
  assert.equal(loggedCount(displaced), 4,
    'never destroyed — Recovery could reach it — but the athlete was not asked');
});

// ---------------------------------------------------------------------------
// 3. THE PLAN READ NAMES THE ATHLETE
// ---------------------------------------------------------------------------
test('3. the plan is fetched for one athlete, not for whoever the policy allows', async () => {
  const a = plan(app(), 2);
  a.cloudSession = { access_token: 't', user_id: 'uid-1', email: 'a@b.c',
                     expires_at: Date.now() + 3600e3 };
  const calls = await reconcileAgainst(a, null);
  const get = calls.filter(c => /plans\?select=/.test(c.url))[0];
  assert.ok(get, 'reconcile must read the plan row');
  assert.match(get.url, /user_id=eq\.uid-1/,
    'RLS is still what isolates athletes; this means a policy regression shows up ' +
    'as an empty result rather than as somebody else’s training');
});

test('3. the isolation the policy provides is still relied on, not replaced', () => {
  const setup = read('supabase-setup.sql');
  ['select', 'insert', 'update'].forEach(op =>
    /* Both forms accepted: `(select auth.uid()) = user_id` is the InitPlan
     rewrite -- evaluated once per statement instead of once per row -- and it
     is the SAME predicate. What this guards is that the caller's own id is
     what scopes the row, not how many times Postgres works it out. */
  assert.match(setup, new RegExp('for ' + op + '[\\s\\S]{0,120}\\(?\\s*(?:select\\s+)?auth\\.uid\\(\\)\\s*\\)?\\s*= user_id'),
      'plans.' + op + ' must remain scoped by auth.uid()'));
  assert.match(setup, /strava_connections[\s\S]*?enable row level security/,
    'the token table keeps RLS enabled');
  const conn = setup.slice(setup.indexOf('create table if not exists public.strava_connections'));
  assert.ok(!/create policy[^;]*strava_connections/.test(conn),
    'and no policy, which is what makes it unreachable from any browser session');
});

// ---------------------------------------------------------------------------
// 4. RESTORE DOES NOT REWRITE A RUN THAT HAPPENED
// ---------------------------------------------------------------------------
/* THE DEFECT. sessionRan() refuses any future-dated day, correctly. The Strava
   write path produces exactly the shape that rule cannot see: applyCompletion()
   refuses a future-dated day and stravaWriteActivity() stamps the activity id
   and the actuals anyway -- a run recorded past midnight, a disagreeing clock,
   a timezone boundary. Phase 4 closed that for the coaching consumers. Restore
   still read it through sessionRan() and still said yes, so the prescription
   could be rewritten under a real run. The next day the same day refused, which
   is the tell: the guard was right and its window was wrong. */
function adjustedFutureDay(a) {
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-3).forEach(d => {
    d.completed = true;
    d.actual = Object.assign(a.emptyActual(),
      { km: d.km, pace: '5:20', hr: 158, rpe: 7, notes: 'sharp pain in my left knee' });
  });
  const ev = a.planEvolution();
  assert.ok(ev && ev.changes.length, 'the fixture must produce a proposal to accept');
  a.handleAcceptEvolution(ev.proposalId);
  const dd = a.findDay(ev.changes[0].dayId);
  assert.ok(dd.date > TODAY, 'the proposal must land on a future day, which is the whole case');
  return dd;
}

test('4. a future-dated day with a Strava activity on it is not restorable', () => {
  const a = plan(app());
  const dd = adjustedFutureDay(a);
  assert.equal(a.coachRestoreState(dd).ok, true, 'restorable before any run is attached');

  dd.stravaActivityId = '99887766';
  dd.actual = Object.assign(a.emptyActual(),
    { km: dd.km, pace: '4:40', hr: 152, movingTimeSec: 2400, activityType: 'Run' });
  assert.equal(a.sessionRan(dd), false,
    'sessionRan still refuses a future date, and must — athleteMemory depends on it');
  assert.equal(a.performedOrClaimed(dd), true, 'but an attached activity is evidence on its own');
  const st = a.coachRestoreState(dd);
  assert.equal(st.ok, false);
  assert.equal(st.reason, 'session_ran');
});

test('4. and the handler refuses it too, not only the state function', () => {
  const a = plan(app());
  const dd = adjustedFutureDay(a);
  const adjusted = dd.km, original = dd.coachAdjust.from.km;
  assert.notEqual(adjusted, original, 'the fixture must actually have changed the distance');
  dd.stravaActivityId = '99887766';
  dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '4:40' });

  a.handleCoachRestore(dd.id);
  assert.equal(dd.km, adjusted, 'the prescription under a real run stays as it was run');
  assert.ok(dd.coachAdjust, 'and nothing is silently cleared');
});

test('4. the narrowing refuses more and never allows more', () => {
  const a = plan(app());
  const dd = adjustedFutureDay(a);
  // every previously-refusing case still refuses
  const cases = [
    ['completed', d => { d.completed = true; }],
    ['manualEdit', d => { d.manualEdit = { at: TODAY, fields: [], from: {} }; }],
    ['no snapshot', d => { delete d.coachAdjust.from; }]
  ];
  cases.forEach(([name, spoil]) => {
    const b = plan(app());
    const bd = adjustedFutureDay(b);
    spoil(bd);
    assert.equal(b.coachRestoreState(bd).ok, false, name + ' must still refuse');
  });
  // and the ordinary case still succeeds
  assert.equal(a.coachRestoreState(dd).ok, true, 'an untouched adjustment is still restorable');
});

// ---------------------------------------------------------------------------
// 5. THE DOCUMENT'S ASSETS RESOLVE FROM EVERY URL IT IS SERVED AT
// ---------------------------------------------------------------------------
/* Phase 4 recorded a missing crest as a local-tooling artifact. It is that at
   / and /app. It is not that at the two other URLs the route table serves this
   document from: the reference was RELATIVE, so under /protected/... and
   /auth/... it resolved beneath the served directory, where the catch-all
   routes swallowed it and returned the ~830KB HTML runtime with
   content-type: text/html instead of a PNG. Every other asset in the file was
   already root-absolute, which is what made this an oversight rather than a
   choice. */
const CFG = JSON.parse(read('vercel.json'));
const PRE = (() => {
  const r = CFG.routes || [];
  const i = r.findIndex(x => x.handle === 'filesystem');
  return r.slice(0, i === -1 ? r.length : i);
})();
const firstRoute = p => PRE.filter(r => r.src && new RegExp('^' + r.src + '$').test(p))[0] || null;
const SERVED_AT = ['/', '/app', '/protected/velvet-viking-valhalla.html', '/auth', '/auth/callback'];

test('5. every asset the runtime references reaches the filesystem from every served URL', () => {
  const refs = Array.from(new Set(
    Array.from(SRC.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)).map(m => m[1])));
  assert.ok(refs.length, 'the sweep must actually find the asset references');
  const broken = [];
  refs.forEach(ref => SERVED_AT.forEach(url => {
    const resolved = ref.charAt(0) === '/' ? ref : url.slice(0, url.lastIndexOf('/') + 1) + ref;
    const hit = firstRoute(resolved);
    if (hit) broken.push(url + ' -> ' + resolved + ' routed to ' + hit.dest);
  }));
  assert.deepEqual(broken, [],
    'a relative asset path under /protected or /auth is served the HTML runtime, not the file');
});

test('5. the two catch-alls that swallow them are still there, so the rule still matters', () => {
  assert.ok(firstRoute('/protected/anything.png'), 'the protected catch-all guards the runtime');
  assert.ok(firstRoute('/auth/anything.png'), 'and the auth route serves the callback landing');
});

// ---------------------------------------------------------------------------
// 6. THE DEPLOYMENT'S IDEA OF ITSELF CAN BE PINNED
// ---------------------------------------------------------------------------
/* siteOrigin() is derived from the forwarded Host, which is what makes
   previews and the apex domain work with no configuration, and which is also a
   request header. _account-delete.js forwards the athlete's own access token to
   siteOrigin(req) + '/api/strava-auth'. Whether a spoofed Host can reach a
   Vercel function is not knowable from this repository, so this is not a claim
   that it is reachable -- it is the cheap way to stop depending on the answer. */
test('6. unset VVV_SITE_ORIGIN behaves exactly as before', () => {
  const S = require('../api/_strava.js');
  const was = process.env.VVV_SITE_ORIGIN;
  delete process.env.VVV_SITE_ORIGIN;
  try {
    assert.equal(S.siteOrigin({ headers: { host: 'velvetviking.co.uk' } }),
      'https://velvetviking.co.uk');
    assert.equal(S.siteOrigin({ headers: { 'x-forwarded-proto': 'http', host: 'localhost:3000' } }),
      'http://localhost:3000');
  } finally { if (was === undefined) delete process.env.VVV_SITE_ORIGIN; else process.env.VVV_SITE_ORIGIN = was; }
});

test('6. set, it wins over any header the request carried', () => {
  const S = require('../api/_strava.js');
  const was = process.env.VVV_SITE_ORIGIN;
  process.env.VVV_SITE_ORIGIN = 'https://velvetviking.co.uk/';
  try {
    assert.equal(S.siteOrigin({ headers: {
      host: 'attacker.example', 'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'http' } }), 'https://velvetviking.co.uk',
      'and the trailing slash is trimmed so callers can concatenate a path');
  } finally { if (was === undefined) delete process.env.VVV_SITE_ORIGIN; else process.env.VVV_SITE_ORIGIN = was; }
});

/* This used to read safeRedirect's SOURCE for the spellings `indexOf(origin`
   and `return origin`. It was checking that the function still looked the way
   it looked, which is a different thing from checking what it guarantees --
   and when the canonical-domain fix gave it a LIST of this deployment's
   origins instead of a single one, the guarantee was untouched while every
   spelling changed. So it is driven rather than read now: the same three
   claims, asserted against what the function actually returns. */
test('6. the redirect target is still confined to this deployment', () => {
  const B = require('../api/beta-signin.js');
  const own = ['https://app.velvetviking.co.uk', 'https://vvv.vercel.app'];

  own.forEach(o => assert.equal(B.safeRedirect(o + '/start', own), o + '/start',
    'this deployment answers on both of its own origins'));

  ['https://attacker.example/steal',
   'https://app.velvetviking.co.uk.attacker.example/steal',
   'https://attacker.example/?u=https://app.velvetviking.co.uk',
   '//attacker.example', 'javascript:alert(1)', ''
  ].forEach(bad => assert.equal(B.safeRedirect(bad, own), own[0] + B.ENTRY_PATH,
    'anything not this deployment is discarded — ' + JSON.stringify(bad)));

  assert.equal(B.safeRedirect(B.NATIVE_REDIRECT, own), B.NATIVE_REDIRECT,
    'except the app’s own custom scheme');
  assert.equal(B.safeRedirect('https://attacker.example', own).indexOf(own[0]), 0,
    'and the fallback is this deployment, never the request');
});

// ---------------------------------------------------------------------------
// 7. COMMERCIAL ACTIVATION IS BLOCKED IN THE DATABASE, AND SAYS SO
// ---------------------------------------------------------------------------
/* Nothing is fixed by these. They pin the facts that make
   supabase-commercial-activation.sql necessary, so the requirement is
   executable rather than a paragraph in a closeout report. If someone changes
   the schema and forgets the report, these are what notice. */
test('7. the flags are off, and off is what an unset variable means', () => {
  const A = require('../api/_access.js');
  const was = { a: process.env.VVV_ACCOUNT_REQUIRED, c: process.env.VVV_COMMERCIAL_REQUIRED };
  delete process.env.VVV_ACCOUNT_REQUIRED;
  delete process.env.VVV_COMMERCIAL_REQUIRED;
  try {
    assert.equal(A.accountRequired(), false);
    assert.equal(A.commercialRequired(), false);
    ['', ' ', '0', 'false', 'off', 'no', 'maybe', 'TRUEISH'].forEach(v => {
      process.env.VVV_COMMERCIAL_REQUIRED = v;
      assert.equal(A.commercialRequired(), false, JSON.stringify(v) + ' must not activate billing');
    });
  } finally {
    if (was.a === undefined) delete process.env.VVV_ACCOUNT_REQUIRED; else process.env.VVV_ACCOUNT_REQUIRED = was.a;
    if (was.c === undefined) delete process.env.VVV_COMMERCIAL_REQUIRED; else process.env.VVV_COMMERCIAL_REQUIRED = was.c;
  }
});

test('7. an auto-seeded beta override outranks every commercial rule', () => {
  const A = require('../api/_access.js');
  /* Exactly the row supabase-entitlement.sql STEP 6 writes for every new
     auth.users insert: override='beta', no expiry, state='expired'. */
  const seeded = { user_id: 'u', state: 'expired', tier: 'standard', access_until: null,
                   override: 'beta', override_expires_at: null };
  const d = A.resolveAccess({ uid: 'u', entitlement: seeded,
    accountRequired: true, commercialRequired: true, now: new Date() });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'override_beta',
    'so every account the current signup trigger creates is free forever, ' +
    'whatever VVV_COMMERCIAL_REQUIRED says — which is correct for a private ' +
    'beta and is the first thing supabase-commercial-activation.sql changes');
});

test('7. no signup trigger grants access unconditionally any more', () => {
  // This used to assert the OPPOSITE -- that the signup trigger granted an
  // override without asking who the account belonged to. That was accurate
  // while private beta was the only route in. Phase 3 opened a commercial
  // front door, at which point an unconditional grant would have handed every
  // arriving athlete permanent free access, so the trigger was retired.
  const sql = read('supabase-entitlement.sql').replace(/--.*$/gm, ' ');
  assert.equal(/create trigger seed_entitlement_on_signup/i.test(sql), false,
    'a signup trigger writing an override is what the commercial gate cannot survive');
  // What a new account DOES get is the Phase 1 row, and nothing else.
  const core = read('supabase-commercial-core.sql');
  assert.match(core, /create trigger seed_account_commercial_on_signup/);
  assert.match(core, /NO TRIAL\. NO ENTITLEMENT\./);
});

test('7. cloud sync is beta-gated, so a customer who is not a tester cannot use it', () => {
  const gate = read('supabase-beta-gate.sql');
  ['plans', 'strava_activities'].forEach(t => {
    const rx = new RegExp('create policy "own [a-z]+: select" on public\\.' + t +
                          '[\\s\\S]{0,120}is_beta_approved');
    assert.match(gate, rx, t + ' select is gated on the allowlist');
  });
  assert.match(gate, /before insert on auth\.users/,
    'and an address that is not on the allowlist cannot become an account at all');
});

test('7. the migration that lifts all three exists, is inert, and is reversible', () => {
  const m = read('supabase-commercial-activation.sql');
  assert.match(m, /_vvv_commercial_launch_authorised/, 'it has a switch');
  assert.match(m, /select 'no'::text/, 'and the switch is off');
  assert.match(m, /raise exception[\s\S]{0,200}ABORTED/, 'so running it unedited changes nothing');
  // it addresses all three blockers, and nothing else
  assert.match(m, /seed_entitlement_for_new_user/, 'the free-forever seed');
  assert.match(m, /drop trigger if exists beta_allowlist_gate/, 'the creation gate');
  assert.match(m, /create policy "own plan: select"[\s\S]{0,80}auth\.uid\(\) = user_id/,
    'and the beta predicate on the ownership policies');
  assert.ok(!/is_beta_approved/.test(m.slice(m.indexOf('STEP 3'), m.indexOf('STEP 4'))),
    'STEP 3 must remove the predicate, not re-add it');
  // and it does not do the things it must not do
  assert.ok(!/VVV_COMMERCIAL_REQUIRED\s*=|alter system|set VVV_/i.test(m),
    'a migration cannot and must not switch a Vercel flag');
  assert.ok(!/delete from public\.entitlements|update public\.entitlements[\s\S]{0,80}override\s*=\s*null/.test(m),
    'no existing tester loses access');
  assert.match(m, /STEP 5[\s\S]*enforce_beta_allowlist/, 'and the inverse is written down');
});

test('7. isolation is not what the migration relaxes', () => {
  const m = read('supabase-commercial-activation.sql');
  /* Anchored on the step HEADERS. Plain 'STEP 3' also appears in the preamble,
     and so does 'STEP 4' -- earlier in the file -- which slices backwards. */
  const step3 = m.slice(m.indexOf('-- STEP 3 --'), m.indexOf('-- STEP 4 --'));
  assert.ok(step3.length > 200, 'the slice must actually contain STEP 3');
  const policies = step3.match(/create policy[\s\S]*?;/g) || [];
  assert.equal(policies.length, 5, 'three on plans, two on strava_activities');
  policies.forEach(p => assert.match(p, /\(?\s*(?:select\s+)?auth\.uid\(\)\s*\)?\s*= user_id/,
    'every policy keeps the predicate that separates one athlete from another'));
  assert.ok(!/strava_connections/.test(step3.replace(/--[^\n]*/g, '')),
    'and the token table is not touched');
});

// ---------------------------------------------------------------------------
// 8. WHAT AN ATHLETE KEEPS WHEN THEY STOP PAYING
// ---------------------------------------------------------------------------
test('8. losing access never touches the training history', () => {
  const B = require('../api/_billing.js');
  assert.ok(B.BILLING_COLUMNS.indexOf('state') !== -1, 'billing owns the commercial columns');
  ['user_id', 'override', 'override_expires_at', 'override_note'].forEach(c =>
    assert.equal(B.BILLING_COLUMNS.indexOf(c), -1, 'billing must not be able to write ' + c));
  const patch = B.billingPatch({ state: 'expired' });
  assert.ok(!Object.prototype.hasOwnProperty.call(patch, 'override'),
    'a lapsed subscription cannot revoke a tester or an owner');
});

test('8. no server path deletes a plan except the athlete\'s own erasure and the owner tool', () => {
  const deleters = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => /\.js$/.test(f))
    .filter(f => /\/plans\?[\s\S]{0,120}method:\s*'DELETE'/.test(read('api/' + f)));
  assert.deepEqual(deleters, ['admin-user.js'],
    'expiry, cancellation and the webhook must not be able to erase training');
  const setup = read('supabase-setup.sql');
  assert.match(setup, /delete from public\.plans where user_id = auth\.uid\(\)/,
    'and the athlete’s own erasure still does exactly that');
});

test('8. the door stays open with zero entitlement', () => {
  const A = require('../api/_access.js');
  const denied = A.resolveAccess({ uid: 'u', entitlement: { state: 'expired', access_until: null },
    accountRequired: true, commercialRequired: true, now: new Date() });
  assert.equal(denied.allow, false);
  assert.deepEqual(denied.locked_capabilities.slice().sort(),
    ['account_delete', 'account_manage', 'data_export', 'legal'],
    'pay again, take your history out, close the account, read the terms');
  assert.deepEqual(denied.capabilities, [], 'and nothing that produces training');
});

// ---------------------------------------------------------------------------
// 9. FAILURE IS SAFE AND SAYS NOTHING IT SHOULD NOT
// ---------------------------------------------------------------------------
test('9. a failed cloud write leaves the local plan and the sync mark alone', async () => {
  const a = plan(app(), 2);
  a.cloudSession = { access_token: 't', user_id: 'u1', email: 'a@b.c',
                     expires_at: Date.now() + 3600e3 };
  const before = JSON.stringify(a.state);
  a.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
  let threw = false;
  await a.cloudPutPlan().catch(() => { threw = true; });
  assert.equal(threw, true);
  assert.equal(JSON.stringify(a.state), before, 'nothing local depends on the write succeeding');
  assert.equal(a.readSyncMark(), null,
    'and no agreement is recorded for a write that did not land');
});

test('9. an unreachable account cannot take a plan away', async () => {
  const a = plan(app(), 3);
  a.cloudSession = { access_token: 't', user_id: 'u1', email: 'a@b.c',
                     expires_at: Date.now() + 3600e3 };
  /* The TRAINING, not the whole blob: resolvePlanOwnership runs before the
     fetch and legitimately stamps this athlete onto an unstamped plan, so a
     raw JSON comparison would fail on the one write that is supposed to
     happen. planContentSignature is the product's own answer to "is this the
     same plan", which is the question being asked. */
  const before = a.planContentSignature(a.state);
  const logged = loggedCount(a.state);
  a.fetch = () => Promise.reject(new Error('offline'));
  await a.cloudReconcile().then(settle);
  assert.equal(a.planContentSignature(a.state), before, 'no training changed');
  assert.equal(loggedCount(a.state), logged, 'and nothing logged was lost');
  assert.equal(a.cloudStatus, 'error', 'observable, and nothing more than that');
});

test('9. corrupted local storage boots rather than throwing', () => {
  const a = app();
  a.localStorage.setItem(a.STORAGE_KEY, '{not json');
  a.localStorage.setItem(a.PLAN_ARCHIVE_KEY, '[]');
  a.localStorage.setItem(a.CLOUD_SYNC_KEY, 'garbage');
  a.loadState();
  assert.equal(JSON.stringify(a.readPlanArchive()), '{}', 'a wrong-shaped archive reads as empty');
  assert.equal(a.readSyncMark(), null, 'and an unparseable mark as absent');
});

test('9. every API handler answers a wrong method without describing itself', async () => {
  /* The Strava routes are _-prefixed modules behind api/strava.js now, so
     the sweep names both the router and the modules it dispatches to --
     otherwise consolidating an endpoint would quietly drop it from this
     check rather than keep testing it. */
  const handlers = ['app.js', 'session.js', 'account.js', 'billing-webhook.js',
                    'admin-user.js', 'beta-signin.js', 'strava.js',
                    '_strava-enabled.js', '_strava-admin.js', '_strava-auth.js',
                    '_strava-sync.js', '_strava-callback.js', '_strava-webhook.js'];
  for (const h of handlers) {
    const mod = require('../api/' + h);
    const fn = typeof mod === 'function' ? mod : mod.handle;
    if (typeof fn !== 'function') continue;
    let status = null, payload = null;
    const res = { setHeader(){}, status(c){ status = c; return res; },
                  send(b){ payload = b; return res; }, end(){ return res; },
                  json(b){ payload = b; return res; } };
    await fn({ method: 'TRACE', headers: {}, url: '/api/x', query: {} }, res);
    const said = JSON.stringify(payload || '');
    assert.ok(!/stack|at \w+ \(|node_modules|supabase\.co|eyJ|sb_secret/i.test(said),
      h + ' leaked implementation detail: ' + said.slice(0, 200));
  }
});

// ---------------------------------------------------------------------------
// 10. NOTHING ATHLETE- OR THIRD-PARTY-CONTROLLED REACHES THE DOM AS MARKUP
// ---------------------------------------------------------------------------
test('10. a script payload in every writable field renders inert on every view', () => {
  const PAY = '"><img src=x onerror=alert(1)>';
  const a = plan(app());
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').slice(-4).forEach(d => {
    d.completed = true;
    d.actual = Object.assign(a.emptyActual(),
      { km: d.km, pace: '5:10', hr: 150, rpe: 6, notes: PAY, activityType: PAY });
    d.title = PAY; d.desc = PAY;
  });
  a.state.days.filter(d => d.date >= t).forEach(d => { d.title = PAY; });
  const today = a.state.days.filter(d => d.date === t)[0];
  if (today) today.readiness = { legs: PAY, sleep: PAY, health: PAY };
  a.stravaConn = { status: 'connected', athleteName: PAY, message: PAY };
  a.cloudSession = { access_token: 't', user_id: 'u', email: PAY, expires_at: Date.now() + 3600e3 };

  const views = ['renderTodayView', 'renderWeekView', 'renderFullPlanView', 'renderPlanHQView'];
  let rendered = 0;
  views.forEach(v => {
    assert.equal(typeof a[v], 'function', v + ' must exist for this sweep to mean anything');
    const html = a[v]();
    rendered++;
    assert.ok(html.indexOf('<img src=x onerror') === -1,
      v + ' rendered the payload as live markup');
  });
  assert.equal(rendered, views.length);
  assert.equal(a.escapeHtml(PAY), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
});

// ---------------------------------------------------------------------------
// 11. NO SECRET MATERIAL IS TRACKED
// ---------------------------------------------------------------------------
test('11. the repository carries no credential, and cannot start to', () => {
  const { execFileSync } = require('child_process');
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter(f => !/^node_modules\//.test(f));
  assert.ok(!files.some(f => /\.(keystore|jks|p12)$/.test(f)), 'no signing key');
  assert.ok(!files.some(f => /(^|\/)\.env/.test(f)), 'no environment file');

  const ignore = read('.gitignore');
  ['*.keystore', '*.jks', '*.p12', '.env'].forEach(p =>
    assert.ok(ignore.split('\n').some(l => l.trim() === p), '.gitignore must cover ' + p));

  /* Service-role keys and provider secrets, in VALUES rather than in prose --
     every one of these strings is discussed in comments and documentation, and
     rightly so. */
  const HITS = [/\bsb_secret_[A-Za-z0-9_-]{8,}/, /\bsk_(live|test)_[A-Za-z0-9]{8,}/,
                /\bwhsec_[A-Za-z0-9]{8,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
                /\bAKIA[0-9A-Z]{16}\b/, /\beyJhbGciOi[A-Za-z0-9_.\-]{40,}/];
  const offenders = [];
  files.filter(f => /\.(js|json|sql|html|md|css|txt|yml|yaml)$/.test(f)).forEach(f => {
    let body; try { body = read(f); } catch (e) { return; }
    HITS.forEach(rx => { if (rx.test(body)) offenders.push(f + ' :: ' + rx); });
  });
  assert.deepEqual(offenders, []);
});

test('11. the publishable key is the only key in the client, and is meant to be', () => {
  assert.match(SRC, /sb_publishable_/, 'the anon key is public by design');
  assert.ok(!/service_role_key|sb_secret_|SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"]/.test(SRC),
    'and no service-role key is anywhere near the browser');
});
