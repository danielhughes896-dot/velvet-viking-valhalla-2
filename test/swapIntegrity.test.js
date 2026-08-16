'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

// Phase 2B: historical-integrity remediation for the reschedule/swap
// interaction. SWAPPED_WORKOUT_FIELDS now also carries stravaActivityId and
// coachAdjust (they describe the WORKOUT/LOG being moved, same as
// manualEdit already did); readiness and coachReview deliberately do not
// move -- readiness belongs to the calendar date it was answered about, and
// coachReview is self-healing derived output read exclusively through
// coachReviewFor(). swapWouldPlaceCompletionInFuture() is a hard refusal,
// not a confirmation: the product has no notion of a completed future
// session, so this is a distinct gate ahead of confirmSwapIfLogged().

const TODAY = '2026-08-15';

function day(id, type, km, extra) {
  return Object.assign({ id, date: id, type, km, mpSegment: false }, extra || {});
}

function loggedDay(id, type, km, extra) {
  return day(id, type, km, Object.assign({
    completed: true,
    actual: { km, pace: '5:00', hr: 150, rpe: 5, notes: '' },
  }, extra || {}));
}

// ---------- 1-2: ordinary reschedule, no completed data at stake ----------

test('1. future unlogged <-> future unlogged: allowed, no confirmation asked', () => {
  const app = loadApp({ pinnedDate: TODAY });
  let asked = false;
  app.confirm = () => { asked = true; return true; };
  const a = day('2026-08-20', 'easy', 5);
  const b = day('2026-08-21', 'tempo', 8);
  app.state.days = [a, b];
  app.doSwapDays('2026-08-20', '2026-08-21');
  assert.equal(asked, false);
  assert.equal(a.type, 'tempo');
  assert.equal(b.type, 'easy');
});

test('2. past unlogged <-> future unlogged: allowed (existing intended behaviour)', () => {
  const app = loadApp({ pinnedDate: TODAY });
  let asked = false;
  app.confirm = () => { asked = true; return true; };
  const a = day('2026-08-10', 'easy', 5); // past, never logged (e.g. an edited/rest day)
  const b = day('2026-08-20', 'tempo', 8); // future
  app.state.days = [a, b];
  app.doSwapDays('2026-08-10', '2026-08-20');
  assert.equal(asked, false, 'neither side is logged, so no confirmation is needed');
  assert.equal(a.type, 'tempo');
  assert.equal(b.type, 'easy');
});

// ---------- 3-4: the future-date hard refusal ----------

test('3. completed past -> future: REFUSED, no mutation, no confirmation asked', () => {
  const app = loadApp({ pinnedDate: TODAY });
  let asked = false;
  app.confirm = () => { asked = true; return true; };
  const past = loggedDay('2026-08-10', 'easy', 5);
  const future = day('2026-08-20', 'tempo', 8);
  app.state.days = [past, future];
  app.doSwapDays('2026-08-10', '2026-08-20');
  assert.equal(asked, false, 'a refusal is not a question -- confirm must never even be asked');
  assert.equal(past.type, 'easy', 'refused swap must leave both days completely untouched');
  assert.equal(future.type, 'tempo');
  assert.equal(future.completed, undefined, 'the future day must not have gained a completed record');
});

test('4. future -> completed past, called in the opposite id order: still REFUSED', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => true;
  const past = loggedDay('2026-08-10', 'easy', 5);
  const future = day('2026-08-20', 'tempo', 8);
  app.state.days = [past, future];
  // Same pair, ids passed in the other order -- the guard must not be order-dependent.
  app.doSwapDays('2026-08-20', '2026-08-10');
  assert.equal(past.completed, true);
  assert.equal(past.type, 'easy');
  assert.equal(future.completed, undefined);
  assert.equal(future.type, 'tempo');
});

test('future-date guard is symmetric: two completed days, one future, one past -> REFUSED', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => true;
  // A future day should never legitimately be completed already, but the guard
  // must hold even if one somehow is (e.g. a corrupted import) -- swapping
  // would still leave a completed record on a future date either way.
  const past = loggedDay('2026-08-10', 'easy', 5);
  const future = loggedDay('2026-08-20', 'tempo', 8);
  app.state.days = [past, future];
  app.doSwapDays('2026-08-10', '2026-08-20');
  assert.equal(past.type, 'easy', 'still refused -- both sides keep their own completed record');
  assert.equal(future.type, 'tempo');
});

// ---------- 5-6: permitted logged swaps ----------

test('5. completed past <-> completed past: permitted after confirmation', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => true;
  const a = loggedDay('2026-08-10', 'easy', 5, { coachReview: { version: 1, trainingSignal: 'neutral' } });
  const b = loggedDay('2026-08-12', 'tempo', 8);
  app.state.days = [a, b];
  app.doSwapDays('2026-08-10', '2026-08-12');
  assert.equal(a.type, 'tempo');
  assert.equal(a.actual.km, 8);
  assert.equal(b.type, 'easy');
  assert.equal(b.actual.km, 5);
  assert.equal(a.completed, true);
  assert.equal(b.completed, true);
});

test('6. completed past <-> unlogged past: permitted, data ownership stays coherent', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => true;
  const logged = loggedDay('2026-08-10', 'easy', 5);
  const unlogged = day('2026-08-11', 'tempo', 8);
  app.state.days = [logged, unlogged];
  app.doSwapDays('2026-08-10', '2026-08-11');
  assert.equal(logged.completed, undefined, 'the day that had no log must not gain one from nowhere');
  assert.equal(logged.type, 'tempo');
  assert.equal(unlogged.completed, true);
  assert.equal(unlogged.actual.km, 5);
  assert.equal(unlogged.type, 'easy');
});

// ---------- 7: cancelled confirmation ----------

test('7. cancelled confirmation: absolutely no mutation on either day', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => false;
  const a = loggedDay('2026-08-10', 'easy', 5, {
    coachReview: { version: 1, trainingSignal: 'neutral' },
    stravaActivityId: 'strava-1',
    coachAdjust: { at: 'x', from: { km: 6, type: 'easy' } },
  });
  const b = day('2026-08-11', 'tempo', 8);
  const snapshotA = JSON.stringify(a), snapshotB = JSON.stringify(b);
  app.state.days = [a, b];
  app.doSwapDays('2026-08-10', '2026-08-11');
  assert.equal(JSON.stringify(a), snapshotA, 'day a must be byte-identical to before the attempted swap');
  assert.equal(JSON.stringify(b), snapshotB, 'day b must be byte-identical to before the attempted swap');
});

// ---------- 8: coachReview after a permitted logged swap ----------

test('8. coachReview after a permitted swap: the day that lost its completion loses the review it no longer describes', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => true;
  const a = loggedDay('2026-08-10', 'easy', 5, {
    coachReview: { version: 999, inputHash: 'stale-hash-from-before-the-swap', trainingSignal: 'neutral' },
  });
  const b = day('2026-08-11', 'tempo', 8); // not completed -> no review of its own
  app.state.days = [a, b];
  app.doSwapDays('2026-08-10', '2026-08-11');
  // coachReview does not move (it is not in SWAPPED_WORKOUT_FIELDS -- it is
  // derived output, not workout identity). a now holds b's uncompleted
  // content, so its own stale review is explicitly cleared rather than left
  // sitting on a day that is no longer complete.
  assert.equal(a.coachReview, undefined, 'a day that lost its completion must not keep the review of the session it used to be');
  assert.equal(app.coachReviewFor(a), null);
  // b gained the real log but never had a review computed for it -- there is
  // nothing to be stale, coachReviewFor's own null-if-missing path covers it,
  // and the next real render computes one fresh via coachWorkoutReview().
  assert.equal(b.coachReview, undefined);
  assert.equal(app.coachReviewIsStale(b), false, 'nothing to invalidate -- there was never a review attached to fabricate a false positive from');
});

test('8b. coachReview does NOT move when the day it describes does not move with it', () => {
  // Sanity check on the field-ownership decision itself: coachReview only
  // ever travels because it is now in SWAPPED_WORKOUT_FIELDS alongside the
  // workout it was computed for -- confirm that inclusion directly.
  const app = loadApp({ pinnedDate: TODAY });
  assert.ok(app.SWAPPED_WORKOUT_FIELDS.indexOf('coachReview') === -1,
    'coachReview is derived output, read exclusively via coachReviewFor() -- it must not be a swapped field itself');
});

// ---------- 9: readiness ownership after swap ----------

test('9. readiness stays on its original calendar date after a swap', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => true;
  const a = loggedDay('2026-08-10', 'easy', 5, { readiness: { legs: 'heavy', sleep: 'poor', health: 'good' } });
  const b = loggedDay('2026-08-11', 'tempo', 8);
  app.state.days = [a, b];
  app.doSwapDays('2026-08-10', '2026-08-11');
  assert.deepEqual(a.readiness, { legs: 'heavy', sleep: 'poor', health: 'good' },
    'readiness describes how the athlete felt on Aug 10 -- it must stay on Aug 10 regardless of what workout is now there');
  assert.equal(b.readiness, undefined, 'the day that never had a readiness answer must not acquire one');
});

// ---------- 10: stravaActivityId ownership after swap ----------

test('10. stravaActivityId travels with the log it identifies, with no duplicate', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => true;
  const a = loggedDay('2026-08-10', 'easy', 5, { stravaActivityId: 'strava-123' });
  const b = loggedDay('2026-08-11', 'tempo', 8);
  app.state.days = [a, b];
  app.doSwapDays('2026-08-10', '2026-08-11');
  assert.equal(a.stravaActivityId, undefined, 'the day that lost the Strava-sourced log must lose its attribution too');
  assert.equal(b.stravaActivityId, 'strava-123', 'the day that gained the Strava-sourced log must gain its attribution');
  const owners = app.state.days.filter(d => d.stravaActivityId === 'strava-123');
  assert.equal(owners.length, 1, 'exactly one day may claim this Strava activity, never zero or two');
});

// ---------- 11: coachAdjust ownership after swap ----------

test('11. coachAdjust travels with the workout it describes, not left behind on the old date', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => true;
  const adjustRecord = { at: '2026-08-09T08:00:00.000Z', reason: 'Load running high',
    from: { km: 11, type: 'interval', title: 'Interval 8x400', desc: 'x' } };
  const a = day('2026-08-20', 'interval', 8, { coachAdjust: adjustRecord }); // future, adjusted, not yet run
  const b = day('2026-08-21', 'tempo', 6);
  app.state.days = [a, b];
  app.doSwapDays('2026-08-20', '2026-08-21');
  assert.equal(a.coachAdjust, undefined, 'the day that swapped its adjusted workout away must not keep the adjustment record');
  assert.deepEqual(b.coachAdjust, adjustRecord, 'the day that received the adjusted workout must carry its full history');
});

// ---------- 12: mobile Edit Session path obeys the same invariants ----------

function mockEditModalDom(app, dd, swapId) {
  const els = {
    'ef-title': { value: dd.title || 'Untitled Session' },
    'ef-type': { value: dd.type },
    'ef-km': { value: String(dd.km) },
    'ef-mp': { checked: !!dd.mpSegment },
    'ef-desc': { value: dd.desc || '' },
    'ef-swap': { value: swapId },
  };
  app.document.getElementById = (id) => els[id] || null;
}

test('12a. Edit Session swap: future-date guard refuses, same as drag-and-drop', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => true;
  const past = loggedDay('2026-08-10', 'easy', 5);
  const future = day('2026-08-20', 'tempo', 8);
  app.state.days = [past, future];
  mockEditModalDom(app, past, '2026-08-20');
  app.handleSaveEdit('2026-08-10');
  assert.equal(past.type, 'easy', 'refused -- the mobile path must not silently allow what desktop refuses');
  assert.equal(future.completed, undefined);
});

test('12b. Edit Session swap: a logged, non-future-risking swap goes through confirmSwapIfLogged and applies', () => {
  const app = loadApp({ pinnedDate: TODAY });
  let asked = false;
  app.confirm = () => { asked = true; return true; };
  const a = loggedDay('2026-08-10', 'easy', 5, { stravaActivityId: 'sid-1' });
  const b = day('2026-08-11', 'tempo', 8);
  app.state.days = [a, b];
  mockEditModalDom(app, a, '2026-08-11');
  app.handleSaveEdit('2026-08-10');
  assert.equal(asked, true, 'the mobile path must ask the same confirmation the desktop path does');
  assert.equal(a.completed, undefined);
  assert.equal(b.completed, true);
  assert.equal(b.stravaActivityId, 'sid-1', 'provenance must travel through the mobile path exactly as it does through drag-and-drop');
});

// ---------- 13: a refused/failed swap produces no partial writes ----------

test('13. a refused swap leaves no partial writes across any of the affected fields', () => {
  const app = loadApp({ pinnedDate: TODAY });
  app.confirm = () => true;
  const past = loggedDay('2026-08-10', 'easy', 5, {
    stravaActivityId: 'sid-9',
    coachAdjust: { at: 'x', from: { km: 6, type: 'easy' } },
    readiness: { legs: 'fresh' },
  });
  const future = day('2026-08-20', 'tempo', 8);
  const beforePast = JSON.stringify(past), beforeFuture = JSON.stringify(future);
  app.state.days = [past, future];
  app.doSwapDays('2026-08-10', '2026-08-20');
  assert.equal(JSON.stringify(past), beforePast, 'not one field may have partially moved off a refused swap');
  assert.equal(JSON.stringify(future), beforeFuture);
});
