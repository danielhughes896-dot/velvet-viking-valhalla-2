'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// ERASURE OF COVERED HEALTH VALUES.
//
// Withdrawing consent is NOT a request for erasure, and the product treats them
// as the different things they are: withdrawal stops future collection and use,
// and the values already logged stay in the athlete's own record and become
// inert. An erasure REQUEST is a separate right, and a system that cannot
// honour one has to answer a lawyer with "we would have to write something".
//
// The whole safety of this rests on one property: it can only ever REMOVE, and
// only ever the named fields. A bug that ate a training history would destroy
// something that -- unlike a heart rate -- cannot be recovered by asking the
// athlete to log it again.

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'api', '_health-erasure.js'));
const HC = require(path.join(ROOT, 'api', '_health-consent.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const plan = () => ({
  version: 7,
  setup: { lthr: 172, maxHR: 190, volume: 40, units: 'km', paceOverrides: { E: 300 } },
  units: 'km',
  healthConsent: { version: 'health_data_consent_v1', decision: 'withdrawn', decidedAt: '2026-08-01T00:00:00Z' },
  days: [
    { date: '2026-01-01', type: 'easy', km: 10,
      readiness: { legs: 'heavy', sleep: 'poor', health: 'ok' },
      actual: { km: 10.2, pace: 305, hr: 148, rpe: 5, feel: 'good', notes: 'legs heavy early' },
      completed: true },
    { date: '2026-01-02', type: 'rest', actual: { km: null, rpe: null, notes: '' } },
    { date: '2026-01-03', type: 'long', km: 22,
      actual: { km: 22.4, pace: 330, hr: 152, rpe: 7, feel: 'poor', notes: '' }, completed: true }
  ]
});

// ===========================================================================
// WHAT IT REMOVES
// ===========================================================================
test('it removes every covered value and nothing else', () => {
  const before = plan();
  const { data, removed } = E.eraseFromPlan(before);

  assert.equal(data.setup.lthr, undefined);
  assert.equal(data.setup.maxHR, undefined);
  assert.equal(data.days[0].readiness, undefined);
  assert.equal(data.days[0].actual.hr, undefined);
  assert.equal(data.days[0].actual.feel, undefined);
  assert.equal(data.days[2].actual.hr, undefined);

  // And the training record is untouched, field by field.
  assert.equal(data.setup.volume, 40);
  assert.deepEqual(data.setup.paceOverrides, { E: 300 });
  assert.equal(data.days[0].km, 10);
  assert.equal(data.days[0].actual.km, 10.2);
  assert.equal(data.days[0].actual.pace, 305);
  assert.equal(data.days[0].actual.rpe, 5, 'RPE is ordinary training data and stays');
  assert.equal(data.days[0].actual.notes, 'legs heavy early',
    'the athlete wrote that; the covered part of a note is the reading, which is never stored');
  assert.equal(data.days[0].completed, true);
  assert.equal(data.days.length, 3);
  assert.deepEqual(removed, { profile: 2, readiness: 1, logged: 4 });
});

test('the consent record survives an erasure', () => {
  // It is the proof of what was agreed and when, it says nothing about the
  // athlete's body, and destroying it removes the evidence that the processing
  // which already happened was lawful at the time.
  const { data } = E.eraseFromPlan(plan());
  assert.deepEqual(data.healthConsent, plan().healthConsent);
  const sql = read('supabase-health-consent.sql');
  assert.equal(/delete from public\.health_data_consent/i.test(sql), false);
  const src = read('api/_health-erasure.js');
  assert.equal(/health_data_consent/.test(src), false,
    'the erasure path must not touch the consent audit at all');
});

test('it never mutates the document it was given', () => {
  // The caller is holding the athlete's plan as it exists in the database. A
  // failure half way through must not leave a partially erased object that
  // some other path could still write back.
  const before = plan();
  const snapshot = JSON.stringify(before);
  E.eraseFromPlan(before);
  assert.equal(JSON.stringify(before), snapshot);
});

test('a provider activity loses its heart rate and keeps everything else', () => {
  const payload = { activityId: 42, date: '2026-01-01', km: 12.1, movingSec: 3600,
                    pace: 297, hr: 149, maxHR: 171, cadence: 178, elevation: 120, isRun: true };
  const { data, removed } = E.eraseFromActivityPayload(payload);
  assert.equal(data.hr, undefined);
  assert.equal(data.maxHR, undefined);
  assert.equal(data.km, 12.1);
  assert.equal(data.cadence, 178);
  assert.equal(data.elevation, 120);
  assert.deepEqual(removed, { activity: 2 });
  assert.equal(HC.carriesCovered(data), false, 'and the consent module agrees nothing covered is left');
});

// ===========================================================================
// THE PROPERTY THE WHOLE THING RESTS ON
// ===========================================================================
test('the subtractive check catches every way this could go wrong', () => {
  const before = plan();
  const after = E.eraseFromPlan(before).data;
  assert.deepEqual(E.verifySubtractive(before, after), []);

  const broke = (mutate) => {
    const a = JSON.parse(JSON.stringify(after));
    mutate(a);
    return E.verifySubtractive(before, a);
  };
  assert.ok(broke(a => { delete a.days[0].actual.rpe; }).length,
    'removing a non-covered field must be caught');
  assert.ok(broke(a => { a.days.pop(); }).length, 'losing a day must be caught');
  assert.ok(broke(a => { a.setup.volume = 50; }).length, 'changing a value must be caught');
  assert.ok(broke(a => { a.setup.newThing = 1; }).length, 'adding a field must be caught');
  assert.ok(broke(a => { a.days[0].actual.notes = 'rewritten'; }).length,
    'rewriting the athlete"s own note must be caught');
  assert.ok(broke(a => { a.days = {}; }).length, 'changing shape must be caught');
});

test('the covered list matches the runtime"s, so the two cannot drift apart', () => {
  // The runtime decides what is covered for the athlete; this decides what an
  // erasure removes. If they disagree, an erasure leaves behind something the
  // product itself calls health data.
  const runtime = read('protected/velvet-viking-valhalla.html');
  // The profile values the builder collects, cleared on withdrawal.
  assert.match(runtime, /state\.setup\.lthr = null; state\.setup\.maxHR = null;/);
  for (const f of E.PLAN_SETUP_FIELDS) assert.ok(/lthr|maxHR/.test(f));
  // readiness: legs, sleep, health -- the three morning answers.
  assert.match(runtime, /dd\.readiness\.legs \|\| dd\.readiness\.sleep \|\| dd\.readiness\.health/);
  assert.deepEqual(E.PLAN_DAY_FIELDS, ['readiness']);
  // The two logged values the runtime withholds without consent.
  assert.deepEqual(E.PLAN_ACTUAL_FIELDS.slice().sort(), ['feel', 'hr']);
  // And the provider fields are the consent module's own list, not a copy.
  assert.deepEqual(E.ACTIVITY_FIELDS, HC.COVERED_ACTIVITY_FIELDS);
});

test('RPE is outside the boundary here too, because it is outside everywhere', () => {
  assert.equal(E.PLAN_ACTUAL_FIELDS.indexOf('rpe'), -1);
  const runtime = read('protected/velvet-viking-valhalla.html');
  const notCovered = /HEALTH_CONSENT_NOT_COVERED = \[([\s\S]*?)\];/.exec(runtime);
  assert.ok(notCovered, 'the runtime no longer states what is outside the boundary');
  assert.match(notCovered[1], /'rpe'/);
});

// ===========================================================================
// THE RUN
// ===========================================================================
function fakeStore(seed){
  const db = JSON.parse(JSON.stringify(seed));
  const calls = [];
  return {
    db: db, calls: calls,
    S: { sb: async (cfg, p, opts) => {
      opts = opts || {};
      calls.push((opts.method || 'GET') + ' ' + p);
      const table = p.replace(/^\//, '').split('?')[0];
      if ((opts.method || 'GET') === 'GET'){
        return { ok: true, status: 200, json: async () => db[table] || [] };
      }
      if (opts.method === 'PATCH'){
        const patch = JSON.parse(opts.body);
        if (table === 'plans') db.plans[0].data = patch.data;
        else {
          const id = /activity_id=eq\.(\d+)/.exec(p)[1];
          db.strava_activities.find(a => String(a.activity_id) === id).payload = patch.payload;
        }
        return { ok: true, status: 200, json: async () => [] };
      }
      throw new Error('unexpected ' + opts.method);
    } },
    cfg: { supabaseUrl: 'https://fake.test', serviceKey: 'service-role-fake' }
  };
}

const seed = () => ({
  plans: [{ user_id: 'u1', data: plan() }],
  strava_activities: [
    { user_id: 'u1', activity_id: 1, payload: { activityId: 1, km: 10, hr: 150 } },
    { user_id: 'u1', activity_id: 2, payload: { activityId: 2, km: 5 } }
  ]
});

test('a dry run changes nothing and says exactly what would go', async () => {
  // "How many heart rates am I about to delete" is a question worth being able
  // to answer before rather than after.
  const f = fakeStore(seed());
  const r = await E.eraseCoveredForAccount(f.S, f.cfg, 'u1');
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.deepEqual(r.plan.removed, { profile: 2, readiness: 1, logged: 4 });
  assert.deepEqual(r.activities, { examined: 2, changed: 1 });
  assert.equal(f.db.plans[0].data.setup.lthr, 172, 'a dry run must not write');
  assert.equal(f.db.strava_activities[0].payload.hr, 150);
  assert.equal(f.calls.filter(c => /^PATCH/.test(c)).length, 0);
});

test('a real run erases, and is idempotent', async () => {
  const f = fakeStore(seed());
  const r = await E.eraseCoveredForAccount(f.S, f.cfg, 'u1', { dryRun: false });
  assert.equal(r.ok, true);
  assert.equal(f.db.plans[0].data.setup.lthr, undefined);
  assert.equal(f.db.plans[0].data.days[0].actual.hr, undefined);
  assert.equal(f.db.plans[0].data.days[0].actual.rpe, 5, 'and the training record survives');
  assert.equal(f.db.strava_activities[0].payload.hr, undefined);
  assert.equal(f.db.strava_activities[0].payload.km, 10);

  const again = await E.eraseCoveredForAccount(f.S, f.cfg, 'u1', { dryRun: false });
  assert.equal(again.ok, true);
  assert.deepEqual(again.plan.removed, {}, 'nothing left to remove');
  assert.equal(again.plan.changed, false);
  assert.equal(again.activities.changed, 0);
});

test('an unreadable database erases nothing rather than half a record', async () => {
  const broken = { sb: async () => ({ ok: false, status: 503, json: async () => null }) };
  const r = await E.eraseCoveredForAccount(broken, { serviceKey: 'x' }, 'u1', { dryRun: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'plan_read_failed');
});

test('no browser can reach it, and nothing routes to it', () => {
  // An irreversible deletion one mis-click away from an athlete who meant to
  // withdraw consent is exactly the confusion the split exists to prevent.
  const router = read('api/account.js');
  assert.equal(/health-erasure|erasure/.test(router), false,
    'the erasure path must not be mounted on the account router');
  const rewrites = read('vercel.json');
  assert.equal(/erasure/i.test(rewrites), false);
  const api = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'));
  const importers = api.filter(f => f !== '_health-erasure.js' &&
    /_health-erasure/.test(read(path.join('api', f))));
  assert.deepEqual(importers, [], 'nothing may call this except an operator');
});

test('the runbook exists and says it is an operator action', () => {
  const facts = read('LEGAL-FACTS.md');
  assert.match(facts, /erasure request/i);
  assert.match(facts, /withdrawal of consent is not by itself a request for erasure/i);
});

test('the run REFUSES and writes nothing when the transform is not subtractive', async () => {
  /* THE GAP THIS CLOSES, found by the mutation pass and not by review.
     Deleting the `not_subtractive` check from eraseCoveredForAccount() changed
     no test result at all: every test exercised verifySubtractive() directly,
     and nothing ever reached the refusal through the run. A guard nobody can
     trigger is a guard nobody can trust -- and this one is the only thing
     standing between a future edit and somebody's deleted training history. */
  const f = fakeStore(seed());
  const before = JSON.stringify(f.db.plans[0].data);

  // A transform that removes a day's RPE -- ordinary training data, and exactly
  // the kind of thing a careless edit to the covered list would take with it.
  const careless = (data) => {
    const out = JSON.parse(JSON.stringify(data));
    out.days.forEach(d => { if (d.actual) delete d.actual.rpe; });
    return { data: out, removed: { logged: 2 } };
  };

  const r = await E.eraseCoveredForAccount(f.S, f.cfg, 'u1',
    { dryRun: false, transformPlan: careless });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_subtractive');
  assert.ok(r.problems.some(p => /rpe/.test(p)), 'and it names what it refused over');
  assert.equal(JSON.stringify(f.db.plans[0].data), before, 'nothing was written');
  assert.equal(f.calls.filter(c => /^PATCH/.test(c)).length, 0);
});

test('the refusal happens before the activities are touched as well', async () => {
  const f = fakeStore(seed());
  const wipe = () => ({ data: {}, removed: {} });
  const r = await E.eraseCoveredForAccount(f.S, f.cfg, 'u1',
    { dryRun: false, transformPlan: wipe });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_subtractive');
  assert.equal(f.db.strava_activities[0].payload.hr, 150,
    'a plan that failed its check must not leave the activities half erased');
});

test('production has exactly one transform, and it is the real one', () => {
  // The seam exists to prove the guard fires, not to make the behaviour
  // configurable. Nothing may call this with a transform in earnest.
  const src = read('api/_health-erasure.js');
  assert.match(src, /const transformPlan = o\.transformPlan \|\| eraseFromPlan;/);
  const api = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'));
  for (const f of api){
    if (f === '_health-erasure.js') continue;
    assert.equal(/transformPlan/.test(read(path.join('api', f))), false,
      'api/' + f + ' passes its own transform');
  }
});
