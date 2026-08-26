'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const S = require('../api/_strava.js');
const HC = require('../api/_health-consent.js');

/* PER-KILOMETRE SPLITS FROM STRAVA
 * ===========================================================================
 * coachSplitMetrics() has always been able to say how evenly a session was run
 * -- consistency, fade, positive or negative split -- from four or more paced
 * entries. Until now no Strava import ever produced any, so every imported run
 * reached it with nothing and it returned null. `splits` was declared in
 * ACTUAL_IMPORTED_FIELDS and no provider filled it.
 *
 * THE COST IS NOTHING ON THE PATH THAT MATTERS. The webhook already reads
 * /activities/{id}, which carries splits_metric, so the real-time route every
 * imported run normally arrives by gains this for no extra request.
 *
 * AND IT MOVED THE HEALTH BOUNDARY. Each split carries its own average heart
 * rate, so a shallow strip would have removed the summary hr and left twelve
 * copies of the same covered measurement one level down.
 */

const TODAY = '2026-08-24';
const raw = over => Object.assign({
  id: 991, type: 'Run', start_date_local: TODAY + 'T07:00:00Z',
  distance: 10000, moving_time: 2700, elapsed_time: 2760,
  has_heartrate: true, average_heartrate: 158, max_heartrate: 175,
  splits_metric: [
    { distance: 1000, moving_time: 268, average_heartrate: 150 },
    { distance: 1000, moving_time: 271, average_heartrate: 155 },
    { distance: 1000, moving_time: 265, average_heartrate: 159 },
    { distance: 1000, moving_time: 262, average_heartrate: 163 }
  ]
}, over || {});

// ---------------------------------------------------------------------------
// THE NORMALISER
// ---------------------------------------------------------------------------
test('kilometre splits become the shape the log already stores', () => {
  const a = S.normaliseActivity(raw());
  assert.equal(a.splits.length, 4);
  assert.deepEqual(Object.keys(a.splits[0]).sort(), ['hr', 'km', 'paceSec', 'sec']);
  assert.equal(a.splits[0].km, 1);
  assert.equal(a.splits[0].sec, 268);
  assert.equal(a.splits[0].paceSec, 268, 'pace derived from the two primitives, not a rounded average');
  assert.equal(a.splits[0].hr, 150);
});

test('a malformed split is dropped rather than recorded as zero', () => {
  /* Strava creates the activity before the upload is processed, so a partial
     read is routine. A 0km split at 0:00 is not a measurement. */
  const a = S.normaliseActivity(raw({ splits_metric: [
    { distance: 1000, moving_time: 268 }, { distance: 0, moving_time: 0 },
    { distance: 1000, moving_time: 265 }, null
  ] }));
  assert.equal(a.splits.length, 2);
  a.splits.forEach(sp => { assert.ok(sp.km > 0); assert.ok(sp.sec > 0); });
});

test('no splits at all is absent, never an empty array', () => {
  /* The list endpoint the manual backfill uses does not return them, so a
     backfilled run simply has none -- which is what every Strava run had
     before this existed. */
  const a = S.normaliseActivity(raw({ splits_metric: undefined }));
  assert.equal(a.splits, undefined);
  const b = S.normaliseActivity(raw({ splits_metric: [] }));
  assert.equal(b.splits, undefined);
});

test('an unpaced split cannot reach the metric that needs pace', () => {
  const a = S.normaliseActivity(raw({ splits_metric: [{ distance: 1000 }] }));
  assert.equal(a.splits, undefined, 'a split with no time is not a split');
});

// ---------------------------------------------------------------------------
// THE HEALTH BOUNDARY
// ---------------------------------------------------------------------------
test('per-split heart rate is covered data, and the boundary sees it', () => {
  const nested = { km: 5, splits: [{ km: 1, sec: 280, paceSec: 280, hr: 140 }] };
  assert.equal(HC.carriesCovered(nested), true,
    'a provider asserting against its own output must be told the truth');
});

test('stripping removes the heart rate from every split, and nothing else', () => {
  const a = S.normaliseActivity(raw());
  const stripped = HC.stripCovered(a);

  assert.equal(stripped.hr, undefined);
  assert.equal(stripped.maxHR, undefined);
  assert.equal(stripped.splits.length, 4, 'the splits themselves are training data and stay');
  stripped.splits.forEach(sp => {
    assert.equal(sp.hr, undefined, 'a covered measurement survived one level down');
    assert.ok(sp.km > 0 && sp.sec > 0 && sp.paceSec > 0, 'distance, time and pace are ordinary');
  });
  assert.equal(HC.carriesCovered(stripped), false);
});

test('the original activity is not mutated by stripping it', () => {
  const a = S.normaliseActivity(raw());
  HC.stripCovered(a);
  assert.equal(a.hr, 158, 'stripCovered returned a copy, as its callers assume');
  assert.equal(a.splits[0].hr, 150);
});

// ---------------------------------------------------------------------------
// WHAT REACHES THE ATHLETE'S LOG
// ---------------------------------------------------------------------------
function athlete(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, Object.assign({ weeks: 10, startDate: a.addDays(TODAY, -14),
    distanceKey: 'half', volume: 45, benchSec: 45 * 60,
    schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } }, o.plan || {}));
  return a;
}
function targetDay(a){
  return a.state.days.filter(d => d.date === TODAY && d.type !== 'rest')[0]
      || a.state.days.filter(d => d.type === 'easy' && d.date <= TODAY).slice(-1)[0];
}

test('imported splits fill an empty log and feed the metric that wanted them', () => {
  const a = athlete();
  const dd = targetDay(a);
  const act = S.normaliseActivity(raw({ start_date_local: dd.date + 'T07:00:00Z',
    distance: dd.km * 1000, moving_time: Math.round(dd.km * 270) }));

  a.stravaWriteActivity(dd, act);
  assert.equal(dd.actual.splits.length, 4);
  assert.equal(dd.stravaActivityId, '991');

  const m = a.coachSplitMetrics(dd);
  assert.ok(m, 'the metric that had nothing to read now reads something');
  assert.equal(m.splits, 4);
  assert.equal(typeof m.consistencyPct, 'number');
  assert.equal(m.splitType, 'negative', 'the fixture speeds up, and it says so');
});

test('the athlete\'s own structured log is never replaced by Strava kilometres', () => {
  /* "Rep 3" and "the third kilometre" are not the same thing, and one of them
     is the athlete's own account of the session. */
  const a = athlete();
  const dd = targetDay(a);
  dd.actual = a.emptyActual();
  dd.actual.splits = [{ segId: 'w.1', role: 'work', label: 'Rep 1', km: 0.4, sec: 88, paceSec: 220, hr: null }];
  const mine = JSON.stringify(dd.actual.splits);

  const act = S.normaliseActivity(raw({ start_date_local: dd.date + 'T07:00:00Z',
    distance: dd.km * 1000, moving_time: Math.round(dd.km * 270) }));
  a.stravaWriteActivity(dd, act);

  assert.equal(JSON.stringify(dd.actual.splits), mine, 'the athlete\'s own rows were overwritten');
});

test('without health consent no split carries a heart rate', () => {
  const a = athlete({ plan: { healthConsent: false } });
  assert.equal(a.healthConsentGranted(), false);
  const dd = targetDay(a);

  /* Server-side the rows arrive already stripped; this asserts the client's
     own second line, for a payload that somehow still carried one. */
  const act = S.normaliseActivity(raw({ start_date_local: dd.date + 'T07:00:00Z',
    distance: dd.km * 1000, moving_time: Math.round(dd.km * 270) }));
  a.stravaWriteActivity(dd, act);

  assert.equal(dd.actual.splits.length, 4, 'the splits themselves are training data');
  dd.actual.splits.forEach(sp => assert.equal(sp.hr, null, 'a heart rate was written without consent'));
  /* emptyActual() seeds hr:null, so absent is null here rather than missing --
     what matters is that nothing was written into it. */
  assert.equal(dd.actual.hr, null, 'and the summary heart rate is still absent');
});

test('imported splits stay flat, so the structured editor is not faked', () => {
  /* splitsAreLegacyFlat() keeps a log with no segIds on the flat editor rather
     than rebuilding it as segments, which would be guessing which kilometre
     was which rep. */
  const a = athlete();
  const dd = targetDay(a);
  const act = S.normaliseActivity(raw({ start_date_local: dd.date + 'T07:00:00Z',
    distance: dd.km * 1000, moving_time: Math.round(dd.km * 270) }));
  a.stravaWriteActivity(dd, act);

  dd.actual.splits.forEach(sp => assert.equal(sp.segId, undefined));
  assert.equal(a.splitsAreLegacyFlat(dd), true);
});
