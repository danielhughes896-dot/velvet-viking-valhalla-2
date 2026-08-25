'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// AUDIT REPRO (Final Full Product Audit, Part 1/16, finding A). applyBackupJson()
// validated only that parsed.days was an Array, then immediately overwrote
// `state`. initExpanded() -> totalWeeksInPlan() reads
// state.days[state.days.length-1].week unconditionally, which threw on a
// malformed last entry -- AFTER state had already been replaced with the bad
// data, and BEFORE renderApp()/flushSave() ever ran. The live session was left
// crashed with corrupted in-memory state (localStorage untouched, since the
// crash preceded the save, but the running app was dead until reload). No
// test in this repo ever called applyBackupJson() at all.
//
// THE FIX. looksLikeBackupDay() validates the handful of fields the app
// actually crashes without (string id, YYYY-MM-DD date, numeric week) for
// EVERY entry in parsed.days before `state` is ever touched. A backup that
// fails this check is rejected the same way a backup that isn't even valid
// JSON already was -- same toast, same "nothing changed" contract -- and
// `state` is provably still the object that was there before the call.

const TODAY = '2026-06-09';

function freshApp() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  return a;
}

function plannedApp() {
  const a = freshApp();
  buildPlan(a, { weeks: 8, startDate: a.addDays(TODAY, 7) });
  return a;
}

test('the exact audit repro is rejected cleanly, before state is touched', () => {
  const a = plannedApp();
  const before = a.state;
  const ok = a.applyBackupJson('{"setup":{"blockId":"x"},"days":[{"id":null},"garbage",42,null]}');
  assert.equal(ok, false);
  assert.equal(a.state, before, 'state must still be the exact same object -- never overwritten');
  // The app must still be alive and renderable -- the original crash reached
  // exactly this call, one render later, with state already corrupted.
  assert.doesNotThrow(() => a.renderApp());
  assert.doesNotThrow(() => a.totalWeeksInPlan());
});

test('a well-formed real backup still imports successfully (no over-rejection)', () => {
  const a = plannedApp();
  const dd = a.state.days[3];
  dd.completed = true;
  dd.actual = { km: dd.km, pace: '5:00', hr: 150, rpe: 5, feel: 'good', notes: '' };
  const backupText = JSON.stringify(a.state);

  const b = freshApp();
  const ok = b.applyBackupJson(backupText);
  assert.equal(ok, true);
  assert.equal(b.state.days.length, a.state.days.length);
  assert.equal(b.findDay(dd.id).completed, true);
});

test('an empty-days backup (no plan yet) still imports -- an empty array is not malformed', () => {
  const a = freshApp();
  const ok = a.applyBackupJson(JSON.stringify({ days: [], setup: null }));
  assert.equal(ok, true);
  assert.equal(a.state.days.length, 0);
});

const ADVERSARIAL_DAYS = [
  ['null entry', [null]],
  ['a bare string entry', ['garbage']],
  ['a bare number entry', [42]],
  ['a boolean entry', [true]],
  ['an array-typed entry', [[1, 2, 3]]],
  ['missing id', [{ date: '2026-06-09', week: 1 }]],
  ['null id', [{ id: null, date: '2026-06-09', week: 1 }]],
  ['non-string id', [{ id: 7, date: '2026-06-09', week: 1 }]],
  ['missing date', [{ id: 'd1', week: 1 }]],
  ['malformed date string', [{ id: 'd1', date: 'not-a-date', week: 1 }]],
  ['missing week', [{ id: 'd1', date: '2026-06-09' }]],
  ['non-numeric week', [{ id: 'd1', date: '2026-06-09', week: 'one' }]],
  ['NaN week', [{ id: 'd1', date: '2026-06-09', week: NaN }]],
  ['one good day followed by one bad day', [
    { id: 'd1', date: '2026-06-09', week: 1, type: 'easy', title: 'Easy', km: 5, desc: 'Easy run' },
    { id: null },
  ]],
];

ADVERSARIAL_DAYS.forEach(([label, days]) => {
  test('adversarial backup day shape rejected cleanly: ' + label, () => {
    const a = plannedApp();
    const before = a.state;
    const ok = a.applyBackupJson(JSON.stringify({ days: days, setup: null }));
    assert.equal(ok, false, label + ' must be refused, not imported');
    assert.equal(a.state, before, label + ' must leave state untouched');
    assert.doesNotThrow(() => a.renderApp(), label + ' must not leave the app unrenderable');
  });
});

test('malformed JSON (not even parseable) is still rejected exactly as before', () => {
  const a = plannedApp();
  const before = a.state;
  const ok = a.applyBackupJson('{not json at all');
  assert.equal(ok, false);
  assert.equal(a.state, before);
});

test('null/empty text is rejected without throwing', () => {
  const a = plannedApp();
  assert.equal(a.applyBackupJson(''), false);
  assert.equal(a.applyBackupJson(null), false);
});
