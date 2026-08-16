'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Two symptoms observed in live use after restoring a parked plan:
//
//   * a Long Run that had been updated from Strava showed as MISSED;
//   * a Hill Repeats session still in the FUTURE showed as ticked/completed.
//
// Both are the same underlying disagreement: `completed` is a stored boolean,
// and the surfaces that read it did not apply the rules the evidence model
// already applies. Phase 2D taught athleteMemory to refuse a future-dated
// session; the plan view was still happy to draw a tick on one. And a day whose
// Strava activity is still attached is a day that demonstrably happened,
// whatever a drifted flag says.
//
// The fix is at the choke point (applyCompletion refuses to complete a day that
// has not happened) plus one read rule (sessionRan) shared by every surface
// that asks "did this run happen". Nothing repairs stored data behind the
// athlete's back.
const PINNED = '2026-03-11T09:00:00Z';

function app() { return loadApp({ pinnedDate: PINNED }); }
function block(a) {
  buildPlan(a, { weeks: 14, startDate: a.addDays(a.todayStr(), -42) });
  return a;
}
const past = a => a.state.days.filter(d => d.date < a.todayStr() && d.type !== 'rest')[0];
const future = a => a.state.days.filter(d => d.date > a.todayStr() && d.type !== 'rest')[0];
const label = (a, dd) => a.dayStatusLabel(dd).replace(/<[^>]+>/g, '');

// ---------------------------------------------------------------------------
// SYMPTOM 2 -- A FUTURE SESSION SHOWED AS COMPLETED
// ---------------------------------------------------------------------------
test('completion cannot be written to a session that has not happened', () => {
  const a = block(app());
  const f = future(a);
  assert.equal(a.applyCompletion(f, true), false,
    'the choke point must refuse, so no caller can tick a future day');
  assert.ok(!f.completed);
});

test('...including from the Strava sync, which bypasses the UI guard', () => {
  const a = block(app());
  const f = future(a);
  // exactly what stravaWriteActivity does: applyCompletion straight through
  a.applyCompletion(f, true);
  f.stravaActivityId = 'act-999';        // and the attachment it would leave
  assert.ok(!f.completed, 'the sync writes completion by this same door');
  assert.ok(!/checked/.test(a.renderDayCheck(f)),
    'and a future day must never render ticked, attachment or not');
});

test('a future day carrying stale completed metadata is still not shown as run', () => {
  const a = block(app());
  const f = future(a);
  f.completed = true;                    // forged directly, as a bad restore would leave it
  f.actual = { km: f.km, pace: '5:30', hr: 150, rpe: 5, notes: '' };
  assert.equal(a.sessionRan(f), false, 'it has not happened yet');
  assert.ok(!/checked/.test(a.renderDayCheck(f)), 'the box must not be ticked');
  assert.ok(!/Recovery/.test(label(a, f)), 'nor may it carry a run-derived status');
});

test('the plan view now agrees with the evidence model about future days', () => {
  const a = block(app());
  const f = future(a);
  f.completed = true;
  f.actual = { km: f.km, pace: '5:30', hr: 150, rpe: 5, notes: '' };
  const rec = a.athleteMemory(42).filter(r => r.date === f.date)[0];
  const memorySays = rec ? rec.completed : false;
  assert.equal(a.sessionRan(f), memorySays,
    'the coach refusing a day while the plan draws a tick on it is the whole defect');
});

// ---------------------------------------------------------------------------
// SYMPTOM 1 -- A STRAVA-BACKED LONG RUN SHOWED AS MISSED
// ---------------------------------------------------------------------------
test('a past session with a Strava activity attached is never Missed', () => {
  const a = block(app());
  const p = past(a);
  p.completed = false;                   // the flag has drifted
  p.stravaActivityId = 'act-123';        // but the run is still attached
  assert.equal(a.sessionRan(p), true, 'the attachment is the record of a real run');
  assert.ok(!/Missed/.test(label(a, p)),
    'a long run that came in from Strava must not be reported as skipped');
});

test('a past session with nothing attached and nothing logged is still Missed', () => {
  const a = block(app());
  const p = past(a);
  p.completed = false;
  delete p.stravaActivityId;
  assert.match(label(a, p), /Missed/,
    'the Missed label must keep working, or this fix has hidden a real signal');
});

test('the checkbox reflects the same evidence the label does', () => {
  const a = block(app());
  const p = past(a);
  p.completed = false;
  p.stravaActivityId = 'act-123';
  assert.match(a.renderDayCheck(p), /checked/,
    'a ticked-looking label beside an empty box is the inconsistency, not the fix');
});

test('an ordinary logged past session is unaffected', () => {
  const a = block(app());
  const p = past(a);
  p.completed = true;
  p.actual = { km: p.km, pace: '5:30', hr: 145, rpe: 4, notes: '' };
  assert.equal(a.sessionRan(p), true);
  assert.match(a.renderDayCheck(p), /checked/);
  assert.ok(!/Missed/.test(label(a, p)));
});

test('rest days are never sessions, whatever they carry', () => {
  const a = block(app());
  const r = a.state.days.filter(d => d.type === 'rest' && d.date < a.todayStr())[0];
  if (!r) return;
  r.completed = true;
  r.stravaActivityId = 'act-777';
  assert.equal(a.sessionRan(r), false);
});

// ---------------------------------------------------------------------------
// RESTORE PRESERVES PROVENANCE, NOT ONLY STRUCTURE
// ---------------------------------------------------------------------------
test('restoring a plan brings back the Strava attachment, not just the workout', () => {
  const a = block(app());
  const p = past(a);
  p.completed = true;
  p.actual = { km: p.km, pace: '5:30', hr: 145, rpe: 4, notes: '' };
  p.stravaActivityId = 'act-123';
  const date = p.date;

  a.stampPlanOwner('uid-a');
  a.persistStateLocalOnly();
  a.resolvePlanOwnership('uid-b');            // parks it
  a.resolvePlanOwnership('uid-a');            // and brings it back

  const back = a.state.days.filter(d => d.date === date)[0];
  assert.ok(back, 'the day survived');
  assert.equal(back.completed, true, 'completion survived');
  assert.equal(back.stravaActivityId, 'act-123',
    'provenance must survive too, or the day silently becomes Missed later');
  assert.ok(back.actual && back.actual.hr === 145, 'and the logged detail with it');
});

test('a displaced plan keeps its provenance through the conflict path', () => {
  const a = block(app());
  const p = past(a);
  p.completed = true;
  p.actual = { km: p.km, pace: '5:30', hr: 145, rpe: 4, notes: '' };
  p.stravaActivityId = 'act-123';
  const date = p.date;

  a.cloudSession = { access_token: 't', user_id: 'uid-a', email: 'a@b.c' };
  const remote = JSON.parse(JSON.stringify(a.state));
  remote.days.forEach(d => { d.completed = false; delete d.actual; delete d.stravaActivityId; });
  a.window.__cloudPendingRemote = remote;
  a.window.__cloudPendingRemoteUpdated = '2026-03-11T08:00:00Z';
  a.handleCloudKeepRemote();

  a.restoreRecoverablePlan('displaced');
  const back = a.state.days.filter(d => d.date === date)[0];
  assert.equal(back.stravaActivityId, 'act-123',
    'the exact sequence HQ performed live must return the Strava record intact');
  assert.equal(back.completed, true);
});
