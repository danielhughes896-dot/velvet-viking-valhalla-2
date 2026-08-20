'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// GARMIN FOUNDATION.
//
// Everything provider-neutral that a device integration needs, and the boundary
// where the vendor-specific half will go. Three questions this file answers:
//
//   Can Valhalla say which workout belongs on which date, deterministically?
//   Can it reconcile a changed plan without duplicating an athlete's calendar?
//   Is the Garmin half genuinely inert until Garmin's contract exists?
//
// The last one matters most. "Not implemented yet" is easy to claim and easy to
// get wrong: a gate that defaults open, a Connect button drawn over an
// integration that cannot honour it, a token read at startup. Those are checked
// here rather than trusted.
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-05-20';

function app() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays(TODAY, -28), distanceKey: 'full',
                 volume: 60, benchSec: 3 * 3600 + 15 * 60 });
  a.state.setup.benchmark = { distanceKey: 'full', timeSec: 3 * 3600 + 15 * 60 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 } };
  a.state.setup.lthr = 172;
  a.state.setup.maxHR = 197;
  return a;
}
const counts = acts => acts.reduce((m, x) => { m[x.action] = (m[x.action] || 0) + 1; return m; }, {});

// ---- SCHEDULED TRAINING ----------------------------------------------------

test('TODAY: today\'s session is representable from the canonical prescription', () => {
  const a = app();
  const dd = a.state.days.find(d => d.date === a.todayStr());
  assert.ok(dd, 'the fixture has no session today');
  if (dd.type === 'rest') return;                     // a rest day is legitimately nothing to send
  const w = a.providerWorkout(dd);
  assert.ok(w, 'today cannot be converted');
  assert.equal(w.date, a.todayStr());
  assert.ok(w.workout.steps.length, 'today has no steps');
  assert.ok(w.fingerprint, 'today has no identity');
});

test('THIS WEEK: seven days project to deterministic dated workouts', () => {
  const a = app();
  const from = a.todayStr(), to = a.addDays(from, 6);
  const week = a.scheduledTraining({ from, to });
  assert.ok(week.length, 'no scheduled training this week');
  week.forEach(w => {
    assert.ok(w.date >= from && w.date <= to, 'a session outside the window: ' + w.date);
    assert.ok(w.sessionId, 'a session with no identity');
    assert.ok(w.fingerprint, 'a session with no fingerprint');
    assert.ok(w.workout.steps.length, w.date + ': no steps');
  });
  // deterministic: same plan, same projection
  assert.equal(JSON.stringify(a.scheduledTraining({ from, to })), JSON.stringify(week));
  // and dated in order
  const dates = week.map(w => w.date);
  assert.equal(JSON.stringify(dates), JSON.stringify(dates.slice().sort()));
});

test('MULTI-WEEK: the whole remaining block is representable', () => {
  const a = app();
  const from = a.todayStr();
  const all = a.scheduledTraining({ from });
  const future = a.state.days.filter(d =>
    d.date >= from && d.type !== 'rest' && !d.completed && d.prescription);
  assert.equal(all.length, future.length,
    'the projection dropped ' + (future.length - all.length) + ' future prescribed sessions');
  assert.ok(all.length > 30, 'a 14-week block should project far more than a month');
  const ids = new Set(all.map(w => w.sessionId));
  assert.equal(ids.size, all.length, 'two scheduled entries share an identity');
});

test('the past is never scheduled, and neither is a rest day or a logged session', () => {
  const a = app();
  const from = a.todayStr();
  const all = a.scheduledTraining({ from });
  all.forEach(w => assert.ok(w.date >= from, 'the past was scheduled: ' + w.date));
  const byId = {};
  all.forEach(w => { byId[w.sessionId] = true; });
  a.state.days.forEach(d => {
    if (d.type === 'rest') assert.ok(!byId[d.id], 'a rest day was scheduled');
    if (d.completed) assert.ok(!byId[d.id], 'a completed session was scheduled');
  });
});

test('a horizon is a parameter, not a hardcoded policy', () => {
  const a = app();
  const from = a.todayStr();
  const wk = a.scheduledTraining({ from, horizonDays: 7 }).length;
  const mo = a.scheduledTraining({ from, horizonDays: 28 }).length;
  const all = a.scheduledTraining({ from }).length;
  assert.ok(wk > 0 && wk < mo && mo <= all, 'the horizon does not bound the projection: ' +
    [wk, mo, all].join('/'));
});

// ---- RECONCILIATION --------------------------------------------------------

test('reconciling an unchanged plan twice does nothing at all', () => {
  /* The property that stops a periodic safety check from filling an athlete's
     calendar with duplicates. */
  const a = app();
  const desired = a.scheduledTraining({ from: a.todayStr(), horizonDays: 28 });
  const known = desired.map(w => ({ sessionId: w.sessionId, date: w.date,
                                    fingerprint: w.fingerprint, remoteId: 'r-' + w.sessionId }));
  const first = a.reconcileScheduledTraining(desired, known);
  assert.equal(counts(first).noop, desired.length, 'an unchanged plan produced work');
  assert.equal(a.reconciliationIsNoop(first), true);
  const second = a.reconcileScheduledTraining(desired, known);
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'reconciliation is not idempotent');
});

test('a first sync creates everything and duplicates nothing', () => {
  const a = app();
  const desired = a.scheduledTraining({ from: a.todayStr(), horizonDays: 28 });
  const acts = a.reconcileScheduledTraining(desired, []);
  assert.equal(counts(acts).create, desired.length);
  assert.equal(a.reconciliationIsNoop(acts), false);
  const ids = new Set(acts.map(x => x.sessionId));
  assert.equal(ids.size, acts.length, 'the same session was created twice');
  acts.forEach(x => assert.ok(x.workout, 'a create with no workout to send'));
});

test('a changed future workout is detected, and only that one', () => {
  const a = app();
  const desired = a.scheduledTraining({ from: a.todayStr(), horizonDays: 28 });
  const known = desired.map(w => ({ sessionId: w.sessionId, date: w.date,
                                    fingerprint: w.fingerprint, remoteId: 'r-' + w.sessionId }));
  known[3].fingerprint = 'something-else';
  const acts = a.reconcileScheduledTraining(desired, known);
  const c = counts(acts);
  assert.equal(c.update, 1, 'expected exactly one update');
  assert.equal(c.noop, desired.length - 1);
  const up = acts.find(x => x.action === 'update');
  assert.equal(up.sessionId, known[3].sessionId);
  assert.equal(up.remoteId, 'r-' + known[3].sessionId, 'the remote id was lost on update');
  assert.equal(up.was.fingerprint, 'something-else', 'the previous state was not reported');
});

test('the same session moved to another date is a change', () => {
  // Identical prescription, different day: a fingerprint over content alone
  // would call that unchanged and leave the athlete's calendar wrong.
  const a = app();
  const desired = a.scheduledTraining({ from: a.todayStr(), horizonDays: 28 });
  const known = desired.map(w => ({ sessionId: w.sessionId, date: w.date,
                                    fingerprint: w.fingerprint, remoteId: 'r' }));
  known[2].date = a.addDays(known[2].date, 1);
  const acts = a.reconcileScheduledTraining(desired, known);
  assert.equal(counts(acts).update, 1);
});

test('a new future workout is created without disturbing the rest', () => {
  const a = app();
  const desired = a.scheduledTraining({ from: a.todayStr(), horizonDays: 28 });
  const known = desired.slice(1).map(w => ({ sessionId: w.sessionId, date: w.date,
                                             fingerprint: w.fingerprint, remoteId: 'r' }));
  const c = counts(a.reconcileScheduledTraining(desired, known));
  assert.equal(c.create, 1);
  assert.equal(c.noop, desired.length - 1);
  assert.equal(c.update || 0, 0);
});

test('a workout the plan no longer prescribes is withdrawn', () => {
  const a = app();
  const desired = a.scheduledTraining({ from: a.todayStr(), horizonDays: 28 });
  const known = desired.map(w => ({ sessionId: w.sessionId, date: w.date,
                                    fingerprint: w.fingerprint, remoteId: 'r-' + w.sessionId }));
  known.push({ sessionId: 'ghost', date: a.addDays(a.todayStr(), 5),
               fingerprint: 'zzz', remoteId: 'r-ghost' });
  const acts = a.reconcileScheduledTraining(desired, known);
  const rm = acts.filter(x => x.action === 'remove');
  assert.equal(rm.length, 1);
  assert.equal(rm[0].sessionId, 'ghost');
  assert.equal(rm[0].remoteId, 'r-ghost', 'nothing to remove it BY');
});

test('a past workout held by a provider is left alone, never tidied away', () => {
  /* The athlete ran it, or did not. Either way a sync does not get to rewrite
     their history. */
  const a = app();
  const desired = a.scheduledTraining({ from: a.todayStr(), horizonDays: 28 });
  const known = [{ sessionId: 'old', date: a.addDays(a.todayStr(), -3),
                   fingerprint: 'x', remoteId: 'r-old' }];
  const acts = a.reconcileScheduledTraining(desired, known, { today: a.todayStr() });
  const past = acts.filter(x => x.sessionId === 'old');
  assert.equal(past.length, 1);
  assert.equal(past[0].action, 'skip_past', 'a past calendar entry was going to be deleted');
  assert.equal(a.reconciliationIsNoop([past[0]]), true, 'skipping the past counts as work');
});

test('plan evolution flows through as an update, with no Garmin-specific logic', () => {
  /* Tuesday holds workout A; the existing evidence rules change it to B; the
     provider is told. Nothing here decides that A became B. */
  const a = app();
  const from = a.todayStr();
  const before = a.scheduledTraining({ from, horizonDays: 21 });
  const known = before.map(w => ({ sessionId: w.sessionId, date: w.date,
                                   fingerprint: w.fingerprint, remoteId: 'r-' + w.sessionId }));
  // The plan legitimately changes: a future session is rewritten by the app's
  // own rescale path, not by anything in this feature.
  const target = a.state.days.find(d => d.id === before[2].sessionId);
  a.rescaleOrDropPrescription(target, target.km + 3);
  target.km = target.km + 3;
  const after = a.scheduledTraining({ from, horizonDays: 21 });
  const acts = a.reconcileScheduledTraining(after, known);
  const c = counts(acts);
  assert.ok((c.update || 0) + (c.create || 0) >= 1, 'the evolution was not detected');
  assert.equal(c.remove || 0, 0, 'an evolution should not withdraw other sessions');
});

test('external state can never write back into the plan', () => {
  const a = app();
  const desired = a.scheduledTraining({ from: a.todayStr(), horizonDays: 14 });
  const planBefore = JSON.stringify(a.state.days);
  a.reconcileScheduledTraining(desired, [
    { sessionId: 'ghost', date: a.addDays(a.todayStr(), 2), fingerprint: 'x', remoteId: 'r' },
    { sessionId: desired[0].sessionId, date: desired[0].date, fingerprint: 'wrong', remoteId: 'r' }
  ]);
  assert.equal(JSON.stringify(a.state.days), planBefore,
    'reconciliation mutated the training plan');
});

test('every action is one of the declared kinds', () => {
  const a = app();
  const desired = a.scheduledTraining({ from: a.todayStr(), horizonDays: 28 });
  const known = desired.slice(2).map(w => ({ sessionId: w.sessionId, date: w.date,
                                             fingerprint: 'x', remoteId: 'r' }));
  known.push({ sessionId: 'ghost', date: a.addDays(a.todayStr(), 4), fingerprint: 'y', remoteId: 'r' });
  known.push({ sessionId: 'old', date: a.addDays(a.todayStr(), -9), fingerprint: 'z', remoteId: 'r' });
  a.reconcileScheduledTraining(desired, known).forEach(x =>
    assert.ok(a.RECONCILE_ACTIONS.indexOf(x.action) > -1, 'undeclared action: ' + x.action));
});

// ---- FAIL CLOSED -----------------------------------------------------------

test('the sync gate is shut, and shut is the default', () => {
  const a = app();
  assert.equal(a.providerSyncAvailable(), false);
  assert.equal(a.providerSyncCapability.available, false);
  assert.equal(a.providerSyncCapability.connected, false);
  const r = a.providerSyncRequest('plan_evolved', { from: a.todayStr(), horizonDays: 28 });
  assert.equal(r.ran, false);
  assert.equal(r.actions.length, 0, 'work was computed for an unavailable provider');
  assert.equal(r.reason, 'unconfigured');
});

test('every declared trigger refuses while the gate is shut', () => {
  const a = app();
  a.PROVIDER_SYNC_TRIGGERS.forEach(t => {
    const r = a.providerSyncRequest(t, { from: a.todayStr() });
    assert.equal(r.ran, false, t + ' ran');
    assert.equal(r.actions.length, 0, t + ' computed actions');
  });
  const bogus = a.providerSyncRequest('definitely_not_a_trigger', {});
  assert.equal(bogus.reason, 'unknown_trigger');
});

test('the client cannot make itself available', () => {
  // Only the SERVER can flip availability. Setting connected alone must not do
  // it, or a compromised client talks itself into a sync.
  const a = app();
  a.providerSyncCapability = { available: false, connected: true, reason: 'unconfigured' };
  assert.equal(a.providerSyncAvailable(), false);
  a.providerSyncCapability = { available: true, connected: false, reason: 'ready' };
  assert.equal(a.providerSyncAvailable(), false, 'available without a connection is not usable');
});

test('with a provider connected, the same engine produces real work', () => {
  // Proves the gate is the ONLY thing stopping it -- the machinery behind it
  // is wired, not a stub.
  const a = app();
  a.providerSyncCapability = { available: true, connected: true, provider: 'test', reason: 'ready' };
  const r = a.providerSyncRequest('provider_connected', { from: a.todayStr(), horizonDays: 14, known: [] });
  assert.equal(r.ran, true);
  assert.ok(r.actions.length > 0);
  assert.ok(r.actions.every(x => x.action === 'create'));
  // and a second run against what the first would have written is a noop
  const known = r.actions.map(x => ({ sessionId: x.sessionId, date: x.date,
                                      fingerprint: x.fingerprint, remoteId: 'r' }));
  const again = a.providerSyncRequest('periodic_safety',
    { from: a.todayStr(), horizonDays: 14, known: known });
  assert.equal(again.ran, false);
  assert.equal(again.reason, 'nothing_to_do');
});

test('no timer, interval or poll was introduced for syncing', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const start = code.indexOf('var PROVIDER_SYNC_TRIGGERS');
  const end = code.indexOf('function rescaleOrDropPrescription');
  assert.ok(start > -1 && end > start, 'could not locate the sync seam');
  const region = code.slice(start, end);
  ['setInterval', 'setTimeout', 'requestIdleCallback'].forEach(t =>
    assert.equal(region.indexOf(t), -1, 'the sync seam polls: ' + t));
});

// ---- THE GARMIN BOUNDARY ---------------------------------------------------

const G = require(path.join(ROOT, 'api', '_garmin.js'));

test('Garmin is unconfigured, and unconfigured means nothing is attempted', () => {
  assert.equal(G.configured(), false);
  const av = G.availability();
  assert.equal(av.available, false);
  assert.equal(av.connected, false);
  assert.equal(av.reason, 'awaiting_approval');
});

test('every adapter entry point refuses before doing anything', async () => {
  for (const fn of ['beginAuthorization', 'completeAuthorization', 'disconnect',
                    'applyScheduledTraining', 'ingestActivity']) {
    let err = null;
    try { await G[fn]({ headers: {} }, []); } catch (e) { err = e; }
    assert.ok(err, fn + ' did not refuse');
    assert.equal(err.code, 'GARMIN_UNAVAILABLE', fn + ' refused for the wrong reason');
  }
});

test('credentials require BOTH secrets and an explicit switch', () => {
  const keys = ['VVV_GARMIN_CLIENT_ID', 'VVV_GARMIN_CLIENT_SECRET', 'VVV_GARMIN_ENABLED'];
  const saved = keys.map(k => process.env[k]);
  try {
    process.env.VVV_GARMIN_CLIENT_ID = 'id';
    process.env.VVV_GARMIN_CLIENT_SECRET = 'secret';
    delete process.env.VVV_GARMIN_ENABLED;
    assert.equal(G.configured(), false, 'credentials alone switched the integration on');
    process.env.VVV_GARMIN_ENABLED = '1';
    assert.equal(G.configured(), true);
    // ...and with the switch on but a secret missing, still off
    delete process.env.VVV_GARMIN_CLIENT_SECRET;
    assert.equal(G.configured(), false, 'the switch alone switched the integration on');
  } finally {
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  }
});

test('no Garmin endpoint, scope or schema has been invented', () => {
  const g = fs.readFileSync(path.join(ROOT, 'api', '_garmin.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.doesNotMatch(g, /garmin\.com|garmin\.cn|apis\.garmin|connectapi/i,
    'a Garmin host was guessed');
  assert.doesNotMatch(g, /https?:\/\//, 'an endpoint URL was guessed');
  assert.doesNotMatch(g, /scope\s*[:=]\s*['"]/, 'an OAuth scope was guessed');
  // the one URL that IS ours, and is ours to choose
  assert.match(g, /'\/api\/garmin-callback'/);
});

test('the unimplemented half says which half it is', () => {
  const G2 = require(path.join(ROOT, 'api', '_garmin.js'));
  const e = G2.contractMissing('x');
  assert.equal(e.code, 'GARMIN_CONTRACT_MISSING');
  const src = fs.readFileSync(path.join(ROOT, 'api', '_garmin.js'), 'utf8');
  ['workout schema', 'token endpoint', 'authorize endpoint', 'activity payload schema']
    .forEach(s => assert.ok(src.indexOf(s) > -1, 'the missing piece is not named: ' + s));
});

test('the status route answers without contacting anyone', async () => {
  const mod = require(path.join(ROOT, 'api', '_garmin-status.js'));
  let code = null, body = null;
  const res = { setHeader(){}, status(s){ code = s; return this; }, send(b){ body = b; } };
  await mod.handle({ method: 'GET', query: {}, url: '/api/garmin-status' }, res);
  assert.equal(code, 200);
  const j = JSON.parse(body);
  assert.equal(j.available, false);
  assert.equal(j.connected, false);
  assert.equal(j.reason, 'awaiting_approval');
});

test('the Garmin router refuses anything it does not serve', () => {
  const r = require(path.join(ROOT, 'api', 'garmin.js'));
  assert.equal(JSON.stringify(r.ROUTES), JSON.stringify(['garmin-status']));
  assert.equal(r.resolveRoute({ url: '/api/garmin-status', query: {} }), 'garmin-status');
  assert.equal(r.resolveRoute({ url: '/api/garmin?route=garmin-status', query: {} }), 'garmin-status');
  ['/api/garmin', '/api/garmin?route=garmin-push', '/api/garmin?route=__proto__']
    .forEach(u => assert.equal(r.resolveRoute({ url: u, query: {} }), null, u));
});

// ---- SETTINGS AND THE TRAINING SURFACES ------------------------------------

test('Settings shows Garmin as not yet available, with nothing to press', () => {
  const a = app();
  const html = a.renderGarminSection();
  assert.match(html, /Garmin Connect/);
  assert.match(html, /Not yet available/);
  assert.ok(html.indexOf('<button') === -1, 'a dead control was drawn');
  assert.ok(html.indexOf('data-action') === -1, 'an unavailable card is actionable');
  // not a failure, and not the athlete's problem to solve
  assert.doesNotMatch(html, /error|failed|problem|try again|sorry/i);
});

test('the card carries its future states without drawing them yet', () => {
  const a = app();
  a.garminCapability = { provider: 'garmin', available: true, connected: false, reason: 'ready' };
  const connect = a.renderGarminSection();
  assert.match(connect, /data-action="garmin-connect"/);
  a.garminCapability = { provider: 'garmin', available: true, connected: true, reason: 'ready' };
  const connected = a.renderGarminSection();
  assert.match(connected, /Connected/);
  assert.match(connected, /data-action="garmin-disconnect"/);
});

test('the Settings view mounts the Garmin card', () => {
  const a = app();
  a.state.view = 'settings';
  const html = a.renderSettingsHubView();
  assert.ok(html.indexOf('id="garmin-section"') > -1, 'Garmin is not in Settings');
  assert.ok(html.indexOf('Not yet available') > -1);
});

test('no Garmin control exists on any training surface', () => {
  /* The product decision: integrations are managed in Settings, and the sync
     that follows is automatic. An athlete reading their training should never
     be asked to push a workout anywhere. */
  const a = app();
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').slice(-3).forEach(d => {
    d.completed = true;
    d.actual = Object.assign(a.emptyActual(), { km: d.km, pace: '5:10', hr: 150, rpe: 6 });
  });
  ['renderTodayView', 'renderWeekView', 'renderFullPlanView', 'renderPlanHQView'].forEach(v => {
    assert.equal(typeof a[v], 'function', v + ' must exist for this sweep to mean anything');
    const html = a[v]();
    assert.ok(html.length > 200, v + ' rendered nothing, so this proves nothing');
    assert.equal(html.indexOf('garmin-section'), -1, v + ' mounts the Garmin card');
    [/data-action="garmin-/i, /send to garmin/i, /push to (watch|garmin)/i,
     /sync workout/i, /export to garmin/i].forEach(re =>
      assert.doesNotMatch(html, re, v + ' offers a per-workout Garmin control'));
  });
});

test('the day card itself offers nothing Garmin', () => {
  const a = app();
  const dd = a.state.days.find(d => d.prescription && d.prescription.archetype === 'track_reps');
  const html = a.renderDayCard(dd);
  assert.doesNotMatch(html, /garmin/i, 'a workout card mentions Garmin');
});

// ---- THE EXISTING APP IS UNTOUCHED -----------------------------------------

test('nothing in this work reads or writes training decisions', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const start = code.indexOf('var PROVIDER_WORKOUT_VERSION');
  const end = code.indexOf('function rescaleOrDropPrescription');
  const region = code.slice(start, end);
  // The canonical/scheduling/reconciliation layer may READ the plan and may
  // not change it, or anything that decides it.
  ['coachDecision(', 'coachAnalyse(', 'coachPersistReview(', 'buildPlan(',
   'generatePlan(', 'computeExecutionScore(', 'scheduleSave(', 'renderApp('].forEach(f =>
    assert.equal(region.indexOf(f), -1, 'the provider layer calls into coaching: ' + f));
  assert.equal(region.indexOf('state.days ='), -1, 'the provider layer assigns the plan');
});

test('activity ingestion is a documented seam, not a second coaching engine', () => {
  const g = fs.readFileSync(path.join(ROOT, 'api', '_garmin.js'), 'utf8');
  assert.match(g, /ingestActivity/);
  assert.match(g, /normalises into the SAME activity shape/i,
    'the return path does not say it rejoins the existing pipeline');
  /* Comments describe the seam and legitimately use words like "adapter" and
     "evidence", so the check is on CODE with both comment styles removed, and
     on real coaching identifiers rather than on substrings. */
  const code = g.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  ['computeExecutionScore', 'coachDecision', 'coachAnalyse', 'coachPersistReview',
   'prescriptionOf', 'segmentsFor', 'buildPlan'].forEach(f =>
    assert.equal(code.indexOf(f), -1,
      'the adapter reimplements coaching: ' + f));
});
