'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../api/_strava.js');
const HC = require('../api/_health-consent.js');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* WHAT THE WATCH RECORDED, KEPT AS WHAT THE WATCH RECORDED
   =========================================================================
   A real ladder -- 2km warm-up, 500/1000/1500/1000/500 at rep pace with
   recoveries, 2km cool-down -- was imported and then judged on the average of
   the whole ten kilometres, recoveries and warm-up included, because the only
   sub-session evidence Valhalla kept was Strava's per-KILOMETRE markers.

   Strava's detailed activity also carries the DEVICE's own laps, and for that
   session they are the reps: 500m and 1000m entries at 4:14-4:20 with 7:0x
   entries between them. Valhalla was discarding them entirely.

   WHAT THIS FILE HOLDS SHUT IS BOTH HALVES:

     the laps survive       ingestion, the health boundary, the app's state
                            and sync, with their provenance stored beside them

     nothing is invented    no lap is called a rep, a recovery, a warm-up or a
                            cool-down, because Strava says nothing about which
                            it was -- and the prescription is not evidence

   THE FIXTURE IS THE REAL SHAPE, NOT REAL ATHLETE DATA: the lap distances and
   times below are the recorded structure of that session, with no identity,
   location, date or device in them. */

/* One prescribed 1500m rep arrived as a 1000m lap AND a 500m lap with no
   recovery between them, and the first recovery was a standing pause inside
   lap 3 (elapsed 282s against 127s moving) rather than a lap of its own. Both
   are in the fixture deliberately: they are why lap index cannot be assumed
   to equal prescribed step index. */
const RECORDED_LAPS = [
  { distance: 1000,   moving_time: 356, elapsed_time: 357, average_heartrate: 129.9, average_cadence: 78.1 },
  { distance: 1000,   moving_time: 327, elapsed_time: 327, average_heartrate: 150.5, average_cadence: 79.0 },
  { distance:  500,   moving_time: 127, elapsed_time: 282, average_heartrate: 152.5, average_cadence: 81.0 },
  { distance: 1000,   moving_time: 260, elapsed_time: 345, average_heartrate: 165.8, average_cadence: 81.3 },
  { distance:  400,   moving_time: 171, elapsed_time: 171, average_heartrate: 155.2, average_cadence: 71.1 },
  { distance: 1000,   moving_time: 254, elapsed_time: 254, average_heartrate: 174.9, average_cadence: 81.9 },
  { distance:  500,   moving_time: 130, elapsed_time: 130, average_heartrate: 182.6, average_cadence: 81.8 },
  { distance:  400,   moving_time: 175, elapsed_time: 175, average_heartrate: 160.9, average_cadence: 71.7 },
  { distance: 1000,   moving_time: 255, elapsed_time: 255, average_heartrate: 183.5, average_cadence: 82.6 },
  { distance:  400,   moving_time: 182, elapsed_time: 198, average_heartrate: 161.0, average_cadence: 69.6 },
  { distance:  500,   moving_time: 128, elapsed_time: 128, average_heartrate: 179.2, average_cadence: 82.2 },
  { distance:  200,   moving_time:  94, elapsed_time:  94, average_heartrate: 167.7, average_cadence: 69.0 },
  { distance: 1000,   moving_time: 327, elapsed_time: 327, average_heartrate: 164.1, average_cadence: 80.7 },
  { distance: 1000,   moving_time: 332, elapsed_time: 332, average_heartrate: 165.1, average_cadence: 80.9 },
  { distance: 104.81, moving_time:  42, elapsed_time:  42, average_heartrate: 165.7, average_cadence: 72.4 }
];
function rawActivity(extra){
  return Object.assign({
    id: 100000001, type: 'Run', sport_type: 'Run',
    start_date_local: '2026-09-01T19:28:03Z',
    distance: 10007.3, moving_time: 3167, elapsed_time: 3425,
    has_heartrate: true, average_heartrate: 161.9, max_heartrate: 188,
    average_cadence: 78.6, total_elevation_gain: 2,
    // Strava's KILOMETRE markers, which are a different observation and stay.
    splits_metric: [{ distance: 1000, moving_time: 356, average_heartrate: 129.9 },
                    { distance: 1000, moving_time: 327, average_heartrate: 150.5 }],
    laps: RECORDED_LAPS
  }, extra || {});
}
// Rounding is recording precision, not a finding: a lap is "about" a distance.
function about(actual, expected, tol, what){
  assert.ok(Math.abs(actual - expected) <= tol,
    what + ': expected about ' + expected + ', got ' + actual);
}

// =====================================================================
// 1. INGESTION -- THE LAPS SURVIVE, AND ARRIVE AS THEMSELVES
// =====================================================================

test('the device laps are preserved, not discarded', () => {
  const n = S.normaliseActivity(rawActivity());
  assert.ok(Array.isArray(n.deviceLaps), 'the watch laps were thrown away again');
  assert.equal(n.deviceLaps.length, RECORDED_LAPS.length, 'a lap went missing');
});

test('provenance is a stored field, never inferred from the shape of the rows', () => {
  const n = S.normaliseActivity(rawActivity());
  assert.equal(n.deviceLapSource, 'strava');
  const plain = S.normaliseActivity(rawActivity({ laps: null }));
  assert.equal(plain.deviceLaps, undefined, 'an activity with no laps invented some');
  assert.equal(plain.deviceLapSource, undefined, 'provenance without anything to be provenance of');
});

test('the kilometre splits are untouched -- two observations, two fields', () => {
  const n = S.normaliseActivity(rawActivity());
  assert.equal(n.splits.length, 2, 'splits_metric stopped being read');
  assert.equal(n.splits[0].km, 1, 'a kilometre split stopped being a kilometre');
  // The laps must NOT have been written over them, and vice versa.
  assert.notEqual(n.splits.length, n.deviceLaps.length);
});

test('each lap carries its own distance, time, pace and cadence', () => {
  const n = S.normaliseActivity(rawActivity());
  const l = n.deviceLaps[2];                       // the 500m at rep pace
  about(l.km, 0.5, 0.001, 'lap distance');
  assert.equal(l.sec, 127, 'lap time');
  about(l.paceSec, 254, 2, 'lap pace');
  assert.equal(l.cadence, 162, 'cadence is both legs, as the summary already is');
  assert.equal(l.elapsedSec, 282, 'a standing recovery inside the lap was not recorded');
});

test('a lap with no usable distance or time is dropped, never zeroed', () => {
  const n = S.normaliseActivity(rawActivity({
    laps: [{ distance: 0, moving_time: 0 }, { distance: 400, moving_time: 0, elapsed_time: 0 },
           { distance: 1000, moving_time: 300 }]
  }));
  assert.equal(n.deviceLaps.length, 1, 'an absent measurement was recorded as a real one');
  assert.equal(n.deviceLaps[0].sec, 300);
});

// =====================================================================
// 2. THE HEALTH BOUNDARY -- PER-LAP HEART RATE IS STILL HEART RATE
// =====================================================================

test('stripCovered removes heart rate from the laps as well as the splits', () => {
  const n = S.normaliseActivity(rawActivity());
  assert.ok(n.deviceLaps.some(l => l.hr != null), 'the fixture proves nothing without a lap HR');
  const stripped = HC.stripCovered(n);
  assert.equal(stripped.deviceLaps.every(l => l.hr == null), true,
    'fifteen copies of a covered measurement survived one level down');
  assert.equal(stripped.splits.every(s => s.hr == null), true);
  // Everything that is ordinary training data stays.
  assert.equal(stripped.deviceLaps.length, RECORDED_LAPS.length);
  about(stripped.deviceLaps[2].paceSec, 254, 2, 'pace was stripped with the heart rate');
  assert.equal(stripped.deviceLaps[2].cadence, 162);
});

test('carriesCovered looks inside the laps, so a seam cannot pass itself', () => {
  const n = S.normaliseActivity(rawActivity());
  assert.equal(HC.carriesCovered(n), true, 'a payload full of lap heart rates read as clean');
  assert.equal(HC.carriesCovered(HC.stripCovered(n)), false);
  // Named once, so a strip and its assertion cannot disagree about where to look.
  assert.ok(HC.NESTED_ACTIVITY_ROW_KEYS.indexOf('deviceLaps') !== -1);
  assert.ok(HC.NESTED_ACTIVITY_ROW_KEYS.indexOf('splits') !== -1);
});

// =====================================================================
// 3. THE APP -- STORED, SYNCED, AND NEVER DISPLACING THE ATHLETE
// =====================================================================

const TODAY = '2026-09-02';
function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: '10k', volume: 50, weeks: 12, lthr: 172, maxHR: 188, startDate: TODAY });
  const dd = a.state.days.filter(d => d.type === 'interval')[0];
  assert.ok(dd, 'no interval session to test against');
  return { a, dd };
}
/* The app's own ingest path, given the server's OWN normalised output -- the
   two halves are joined here rather than hand-writing an app-shaped activity,
   so a change to normaliseActivity() that the app cannot read fails here.

   The total is set to the day's own distance because the matcher, correctly,
   will not adopt an activity that is nothing like the session it is offered
   for; the fixture is about the LAP STRUCTURE, and the real session's total
   is not what it is testing. The laps themselves are untouched. */
function importInto(a, dd, activity){
  const n = S.normaliseActivity(activity || rawActivity());
  n.date = dd.date;
  n.km = dd.km;
  const r = a.stravaIngestActivities([n]);
  assert.equal(r.applied, 1, 'the fixture activity was not adopted: ' + JSON.stringify(r));
  return n;
}

test('an imported activity puts the laps and their provenance into state', () => {
  const { a, dd } = athlete();
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted',
                            at: '2026-01-01T00:00:00Z' };
  importInto(a, dd);
  const A = a.findDay(dd.id).actual;
  assert.equal(A.deviceLapSource, 'strava');
  assert.equal(A.deviceLaps.length, RECORDED_LAPS.length);
  about(A.deviceLaps[2].paceSec, 254, 2, 'the 500m rep pace did not survive the import');
});

test('the laps are covered by the sync field list, not left behind on one device', () => {
  const { a } = athlete();
  assert.ok(a.ACTUAL_IMPORTED_FIELDS.indexOf('deviceLaps') !== -1,
    'laps would not sync, and would silently differ between devices');
  assert.ok(a.ACTUAL_IMPORTED_FIELDS.indexOf('deviceLapSource') !== -1,
    'laps would arrive on another device with no way to tell whose they were');
  assert.ok(a.ACTUAL_SYNCED_FIELDS.indexOf('deviceLaps') !== -1);
});

test("the athlete's own structured log is never replaced by the device's laps", () => {
  const { a, dd } = athlete();
  const plan = a.structuredLoggingPlan(dd);
  const first = a.upsertStructuredSplit(dd, plan, plan.rows[0]);
  first.km = 2; first.sec = 700; first.paceSec = 350;
  const mine = JSON.stringify(dd.actual.splits);
  dd.completed = true;
  importInto(a, dd);
  const A = a.findDay(dd.id).actual;
  assert.equal(JSON.stringify(A.splits), mine, "the athlete's own account was overwritten");
  assert.ok(A.deviceLaps.length, 'and the laps were dropped to protect it');
});

// =====================================================================
// 4. NOTHING IS INVENTED -- THE RULE THIS FEATURE LIVES OR DIES BY
// =====================================================================

test('no lap is classified as work, recovery, warm-up or cool-down', () => {
  const n = S.normaliseActivity(rawActivity());
  n.deviceLaps.forEach((l, i) => {
    ['role', 'kind', 'segId', 'repIndex', 'stepType', 'intensity'].forEach(k => {
      assert.equal(l[k], undefined,
        'lap ' + (i + 1) + ' was given a "' + k + '" Strava never supplied');
    });
  });
});

test('the prescription is not written onto the recording', () => {
  const { a, dd } = athlete();
  dd.completed = true;
  importInto(a, dd);
  const A = a.findDay(dd.id).actual;
  // The prescribed session has segIds; not one of them may appear on a lap.
  const segIds = a.orderedSegments(a.prescriptionOf(dd)).map(s => s.segId);
  const lapJson = JSON.stringify(A.deviceLaps);
  segIds.forEach(id => assert.equal(lapJson.indexOf('"' + id + '"'), -1,
    'a prescribed segment id was stamped onto recorded evidence'));
  // And the recorded laps are the recorded ones, not the prescribed count.
  assert.equal(A.deviceLaps.length, RECORDED_LAPS.length);
});

test('the recorded ladder is readable from the evidence without being labelled', () => {
  const n = S.normaliseActivity(rawActivity());
  const laps = n.deviceLaps;
  // Every rep the athlete actually ran is present at its own pace. These are
  // read from the RECORDING; nothing here asserts which prescribed rep it was.
  const quick = laps.filter(l => l.paceSec < 300);
  assert.equal(quick.length, 6,
    'the reps are no longer distinguishable from the recoveries');
  quick.forEach((l, i) => about(l.paceSec, 258, 8, 'rep-pace lap ' + (i + 1)));
  // The recoveries are separately present and are nowhere near rep pace.
  const easy = laps.filter(l => l.paceSec > 400);
  assert.ok(easy.length >= 4, 'the recoveries were folded away');
  easy.forEach(l => assert.ok(l.paceSec > 400));
  /* AND THE REASON A MATCHER CANNOT SIMPLY COUNT: the prescribed ladder has
     five reps and the recording has six rep-paced laps, because one 1500m rep
     was recorded as 1000m + 500m. Any reconciliation has to survive this. */
  const prescribedReps = 5;
  assert.notEqual(quick.length, prescribedReps,
    'the fixture stopped covering the split-rep case it exists for');
});

// =====================================================================
// 5. EXECUTION REVIEW -- IT STOPS SAYING SOMETHING UNTRUE
// =====================================================================

test('with nothing logged below the total, the original sentence is unchanged', () => {
  const { a, dd } = athlete();
  dd.completed = true;
  dd.actual = { km: dd.km, pace: '5:00', paceUnit: 'km', hr: 160, rpe: 6, feel: null, notes: '' };
  const b = a.computeExecutionBreakdown(dd);
  assert.equal(b.paceResolution, 'whole-session');
  assert.match(a.executionResolutionClause(b), /the sections were not logged separately/);
});

test('once the athlete logs the sections, it stops claiming they did not', () => {
  const { a, dd } = athlete();
  dd.completed = true;
  dd.actual = { km: dd.km, pace: '5:00', paceUnit: 'km', hr: 160, rpe: 6, feel: null, notes: '' };
  const before = a.computeExecutionBreakdown(dd);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.forEach(r => {
    const row = a.upsertStructuredSplit(dd, plan, r);
    row.km = r.role === 'work' ? 0.2 : 0.3; row.sec = r.role === 'work' ? 35 : 90;
    row.paceSec = Math.round(row.sec / row.km);
  });
  const after = a.computeExecutionBreakdown(dd);
  assert.equal(after.paceResolution, 'sections-logged');
  assert.doesNotMatch(a.executionResolutionClause(after), /not logged separately/,
    'the app told the athlete it had no evidence it was holding at the time');
  // THE SCORE IS NOT TOUCHED. Naming the evidence is not re-weighting it.
  assert.equal(after.score, before.score, 'the verdict moved -- that is a coaching change');
});

test('imported laps are credited as recorded, and not as proof of which was a rep', () => {
  /* Two identical athletes, both given the SAME imported whole-session
     numbers; only one is given the laps. Anything that differs between them is
     caused by the laps and by nothing else -- which is the only way to say
     honestly that the score did not move. */
  const bare = athlete();
  importInto(bare.a, bare.dd, rawActivity({ laps: null }));
  const before = bare.a.computeExecutionBreakdown(bare.a.findDay(bare.dd.id));

  const { a, dd } = athlete();
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted',
                            at: '2026-01-01T00:00:00Z' };
  importInto(a, dd);
  const after = a.computeExecutionBreakdown(a.findDay(dd.id));
  assert.equal(after.paceResolution, 'laps-recorded');
  const clause = a.executionResolutionClause(after);
  assert.doesNotMatch(clause, /not logged separately/);
  assert.match(clause, /laps are recorded/);
  assert.match(clause, /nothing in them says which lap was a rep/,
    'the clause claimed more than the evidence supports');
  assert.equal(after.score, before.score, 'recorded laps silently re-scored the session');
});

test("the athlete's own log outranks the device's when both exist", () => {
  const { a, dd } = athlete();
  dd.completed = true;
  dd.actual = { km: 10, pace: '5:16', paceUnit: 'km', hr: 161, rpe: 7, feel: null, notes: '' };
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.forEach(r => {
    const row = a.upsertStructuredSplit(dd, plan, r);
    row.km = 0.4; row.sec = 120; row.paceSec = 300;
  });
  dd.actual.deviceLaps = [{ km: 1, sec: 300, paceSec: 300 }];
  dd.actual.deviceLapSource = 'strava';
  const b = a.computeExecutionBreakdown(dd);
  assert.equal(b.paceResolution, 'sections-logged',
    'a watch lap was preferred to the athlete naming the section themselves');
});

test('a single-intensity session is still judged directly, with no clause at all', () => {
  const { a } = athlete();
  const easy = a.state.days.filter(d => d.type === 'easy')[0];
  easy.completed = true;
  easy.actual = { km: easy.km, pace: '6:00', paceUnit: 'km', hr: 140, rpe: 3, feel: null, notes: '' };
  const b = a.computeExecutionBreakdown(easy);
  assert.equal(b.paceResolution, 'direct');
  assert.equal(a.executionResolutionClause(b), '');
});

// =====================================================================
// 6. DISPLAY -- SHOWN AS A RECORDING, NOT AS A VERDICT
// =====================================================================

test('the recorded laps are shown, with their real paces', () => {
  const { a, dd } = athlete();
  importInto(a, dd);
  const html = a.renderSplitsBlock(a.findDay(dd.id));
  assert.match(html, /dlap-card/, 'the laps were imported and then not shown');
  assert.match(html, /Recorded laps/);
  assert.match(html, /15 from your watch/);
  assert.match(html, /4:14/, 'a rep pace is missing from a list of the reps');
  assert.match(html, /7:0\d|7:1\d/, 'the recoveries are missing');
});

test('the display names no lap a rep or a recovery', () => {
  const { a, dd } = athlete();
  importInto(a, dd);
  const html = a.renderSplitsBlock(a.findDay(dd.id));
  const shown = html.slice(html.indexOf('dlap-card'));
  assert.doesNotMatch(shown, /Rep \d|Recovery \d|Warm-up<|Cool-down</,
    'a recorded lap was given a name only the prescription knows');
  assert.match(shown, /not told which lap/, 'the limit of the evidence is not stated');
});

test('a run with no imported laps shows no lap block, and its editor is untouched', () => {
  const { a, dd } = athlete();
  dd.completed = true;
  dd.actual = { km: dd.km, pace: '5:00', paceUnit: 'km', hr: 160, rpe: 6, feel: null, notes: '' };
  const html = a.renderSplitsBlock(dd);
  assert.doesNotMatch(html, /dlap-card/, 'an empty recorded-laps card appeared');
  assert.match(html, /data-action="toggle-splits"|splits-summary/,
    'the ordinary logging control was disturbed');
});

test('manual logging is entirely unaffected by any of this', () => {
  const { a, dd } = athlete();
  dd.completed = true;
  dd.actual = { km: 8.2, pace: '4:44', paceUnit: 'km', hr: 168, rpe: 7, feel: 'strong', notes: 'ok' };
  const b = a.computeExecutionBreakdown(dd);
  assert.ok(b && b.score != null, 'a hand-logged session stopped being scored');
  assert.equal(a.actualPaceSecPerKm(dd), 284);
  assert.equal(dd.actual.deviceLaps, undefined, 'laps were invented for a manual log');
});
