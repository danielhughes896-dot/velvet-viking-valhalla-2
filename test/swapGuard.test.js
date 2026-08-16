'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// A reschedule/swap moves a session's full identity -- including its logged
// completed/actual record -- to a different date, because the log belongs to
// the WORKOUT, not the calendar cell (see SWAPPED_WORKOUT_FIELDS's own
// comment). That's correct when the athlete means it (fixing which day a run
// actually happened on), but historical training data is coaching evidence,
// so it must never move by accident. confirmSwapIfLogged() gates the swap
// behind one explicit window.confirm() whenever either side is already
// logged, and is a no-op between two not-yet-run days.

function day(id, type, km, extra) {
  return Object.assign({ id, date: id, type, km, mpSegment: false }, extra || {});
}

test('doSwapDays: two uncompleted days swap freely, no confirmation asked', () => {
  const app = loadApp();
  buildPlan(app, {});
  let asked = false;
  app.confirm = () => { asked = true; return true; };
  const a = day('2026-08-10', 'easy', 5);
  const b = day('2026-08-11', 'tempo', 8);
  app.state.days = [a, b];
  app.doSwapDays('2026-08-10', '2026-08-11');
  assert.equal(asked, false, 'no confirmation should be needed when neither day is logged');
  assert.equal(a.type, 'tempo', 'the swap itself must still work for the ordinary reschedule case');
  assert.equal(b.type, 'easy');
});

test('doSwapDays: a logged day asks for confirmation, and a decline blocks the swap entirely', () => {
  const app = loadApp();
  buildPlan(app, {});
  app.confirm = () => false;
  const a = day('2026-08-10', 'easy', 5, { completed: true, actual: { km: 5, pace: '5:30', hr: 150, rpe: 4, notes: '' } });
  const b = day('2026-08-11', 'tempo', 8);
  app.state.days = [a, b];
  app.doSwapDays('2026-08-10', '2026-08-11');
  assert.equal(a.type, 'easy', 'declining the confirmation must leave both days completely untouched');
  assert.equal(b.type, 'tempo');
  assert.equal(a.completed, true, 'the logged record itself must not be disturbed by a declined swap');
});

test('doSwapDays: a logged day swaps normally once the confirmation is accepted', () => {
  const app = loadApp();
  buildPlan(app, {});
  app.confirm = () => true;
  const a = day('2026-08-10', 'easy', 5, { completed: true, actual: { km: 5, pace: '5:30', hr: 150, rpe: 4, notes: '' } });
  const b = day('2026-08-11', 'tempo', 8);
  app.state.days = [a, b];
  app.doSwapDays('2026-08-10', '2026-08-11');
  assert.equal(a.type, 'tempo', 'accepting the confirmation must let the swap proceed exactly as before');
  assert.equal(b.type, 'easy');
  assert.equal(b.completed, true, 'the logged record travels with the swap, matching the existing SWAPPED_WORKOUT_FIELDS contract');
  assert.equal(a.completed, undefined);
});

test('confirmSwapIfLogged: both days logged still resolves to a single confirmation, not two', () => {
  const app = loadApp();
  buildPlan(app, {});
  let calls = 0;
  app.confirm = () => { calls++; return true; };
  const a = day('2026-08-10', 'easy', 5, { completed: true, actual: { km: 5, pace: '5:30', hr: null, rpe: null, notes: '' } });
  const b = day('2026-08-11', 'tempo', 8, { completed: true, actual: { km: 8, pace: '4:40', hr: null, rpe: null, notes: '' } });
  const ok = app.confirmSwapIfLogged(a, b);
  assert.equal(ok, true);
  assert.equal(calls, 1, 'one confirmation covers the whole swap, regardless of how many sides are logged');
});
