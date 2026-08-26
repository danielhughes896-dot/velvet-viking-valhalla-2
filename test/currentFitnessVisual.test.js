'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* CURRENT FITNESS / THRESHOLD CALIBRATION -- THE VISUAL LAYER
 * ===========================================================================
 * The coaching logic (currentFitnessAnchor(), applyCalibrationFromDay(), the
 * evidence hierarchy) already existed and was already tested elsewhere
 * (test/earlyCalibration.test.js, test/thresholdPaceCalibration*.test.js).
 * This file covers what this pass ADDED: the athlete-facing surfaces that
 * read those same accessors --
 *   - the Pace Reference provenance line,
 *   - the Current Fitness vs Goal panel,
 *   - the calibration completion moment on the day card.
 * Every assertion below is that these surfaces say what the accessor they
 * read actually returns, never an independent guess at it. */

const TODAY = '2026-03-02';
const app = () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {};
  return a;
};
function planned(opts){
  const a = app();
  buildPlan(a, Object.assign({ distanceKey: '10k', startDate: TODAY }, opts || {}));
  return a;
}

// ---------------------------------------------------------------------------
// PACE REFERENCE PROVENANCE
// ---------------------------------------------------------------------------
test('the Pace Reference provenance line names the goal fallback truthfully', () => {
  const a = planned();
  delete a.state.setup.benchmark; // buildPlan()'s fixture sets one by default
  assert.equal(a.currentFitnessAnchor().source, 'goal', 'no measurement, benchmark or calibration yet');
  const line = a.paceReferenceProvenanceLine();
  assert.match(line, /^Estimated from/, 'a goal is an aspiration, not a calibration');
  assert.match(line, /your active goal/);
});

test('the Pace Reference provenance line follows the anchor to a calibration', () => {
  const a = planned();
  a.state.setup.thresholdPaceSecPerKm = 258; // 4:18/km
  a.state.setup.thresholdPaceSource = 'calibration';
  a.state.setup.thresholdPaceMeasuredOn = '2026-02-27';
  assert.equal(a.currentFitnessAnchor().source, 'calibration');

  const line = a.paceReferenceProvenanceLine();
  assert.match(line, /^Calibrated from/);
  assert.match(line, /Threshold Calibration/);
  assert.match(line, /Feb 27/, 'the date is the anchor\'s own date, not today');
});

test('renderCompactPaceReference() prints the same provenance line, not a second copy of it', () => {
  const a = planned();
  a.state.setup.thresholdPaceSecPerKm = 258;
  a.state.setup.thresholdPaceSource = 'calibration';
  a.state.setup.thresholdPaceMeasuredOn = '2026-02-27';
  const html = a.renderCompactPaceReference();
  assert.match(html, /pace-ref-prov/);
  assert.ok(html.indexOf(a.paceReferenceProvenanceLine()) !== -1,
    'the card renders exactly what the accessor returns');
});

// ---------------------------------------------------------------------------
// CURRENT FITNESS ESTIMATE -- SAME MATHEMATICS, ANY RUNG
// ---------------------------------------------------------------------------
test('currentFitnessEstimate() is null with nothing to anchor it to', () => {
  const a = app(); // no state.setup at all
  a.state = a.makeDefaultState();
  assert.equal(a.currentFitnessEstimate('10k'), null);
});

test('currentFitnessEstimate() converts through the same equivalence table as everything else', () => {
  const a = planned();
  const anchor = a.currentFitnessAnchor();
  assert.ok(anchor.vdot > 0);
  const est = a.currentFitnessEstimate('10k');
  assert.equal(est.withheld, false);
  const mid = a.equivalentTimeSec(anchor.vdot, a.DISTANCE_PROFILES['10k'].raceKm * 1000);
  const expectedFast = Math.round(mid * (1 - 0.025));
  const expectedSlow = Math.round(mid * (1 + 0.025));
  assert.equal(est.fastSec, expectedFast, 'no separate formula -- same equivalentTimeSec() call');
  assert.equal(est.slowSec, expectedSlow);
  assert.equal(est.fromSource, anchor.source);
});

test('currentFitnessEstimate() withholds the marathon exactly when measuredFitnessEstimate() would', () => {
  const a = planned({ distanceKey: 'full' });
  // No absorbed-volume model in this fixture, so absorbedWeeklyVolume().source is not 'measured'.
  const est = a.currentFitnessEstimate('full');
  assert.equal(est.withheld, true);
  assert.match(est.reason, /volume/);
});

// ---------------------------------------------------------------------------
// CURRENT FITNESS vs GOAL PANEL
// ---------------------------------------------------------------------------
test('renderCurrentFitnessPanel() is empty with no plan set up', () => {
  const a = app();
  a.state = a.makeDefaultState();
  assert.equal(a.renderCurrentFitnessPanel(), '');
});

test('renderCurrentFitnessPanel() shows Current Fitness and Goal at the same, comparable distance', () => {
  const a = planned({ distanceKey: '10k' });
  // buildPlan()'s fixture sets a benchmark by default, so this athlete's
  // real anchor is rung three, not the goal fallback -- assert the headline
  // names whichever rung actually is active.
  assert.equal(a.currentFitnessAnchor().source, 'benchmark');
  const html = a.renderCurrentFitnessPanel();
  assert.match(html, /Current Fitness/);
  assert.match(html, /Benchmark/, 'the headline names the real rung');
  assert.match(html, /Goal/);
  assert.match(html, /10K/, 'the goal distance label is present');
  assert.equal(html.indexOf('VDOT'), -1, 'no athlete-facing VDOT anywhere on this card');
});

test('renderCurrentFitnessPanel() names the goal fallback truthfully with no benchmark either', () => {
  const a = planned({ distanceKey: '10k' });
  delete a.state.setup.benchmark;
  assert.equal(a.currentFitnessAnchor().source, 'goal');
  const html = a.renderCurrentFitnessPanel();
  assert.match(html, /Active goal/);
});

test('renderCurrentFitnessPanel() follows the anchor off the goal once real evidence exists', () => {
  const a = planned();
  a.state.setup.thresholdPaceSecPerKm = 258;
  a.state.setup.thresholdPaceSource = 'calibration';
  a.state.setup.thresholdPaceMeasuredOn = '2026-02-27';
  const html = a.renderCurrentFitnessPanel();
  assert.match(html, /Threshold Calibration/);
  assert.match(html, /Feb 27/);
});

// ---------------------------------------------------------------------------
// THE CALIBRATION COMPLETION MOMENT
// ---------------------------------------------------------------------------
function calDayFixture(a){
  const blk = a.buildBlockWeeks('half', 45, 10, { calibrate: true });
  a.state.days = a.buildDaysFromWeeks(blk, a.state.setup.raceDate, a.state.setup.schedule, TODAY, false);
  return a.state.days.filter(d => d.type === 'calibration')[0];
}
function segIdFor(a, dd, role){
  const segs = a.orderedSegments(a.prescriptionOf(dd)) || [];
  return (segs.filter(s => s.role === role)[0] || {}).segId;
}
function logCalibration(a, dd, hr, opts){
  const o = opts || {};
  dd.completed = true;
  dd.actual = dd.actual || a.emptyActual();
  dd.actual.splits = dd.actual.splits || [];
  const push = (role, km, sec, rowHr) => {
    if (km === undefined) return;
    dd.actual.splits.push({ segId: segIdFor(a, dd, role), role: role, label: role, km: km, sec: sec, paceSec: null, hr: rowHr });
  };
  push('calibration_settle', o.settleKm === undefined ? 2.3 : o.settleKm, o.settleSec === undefined ? 10*60 : o.settleSec, null);
  push('calibration_measure', o.measuredKm === undefined ? 4.6 : o.measuredKm, o.measuredSec === undefined ? 20*60 : o.measuredSec, hr);
  return dd;
}

test('renderCalibrationResult() is empty until the day has a calibration result', () => {
  const a = planned({ distanceKey: 'half', weeks: 10 });
  const dd = calDayFixture(a);
  assert.equal(a.renderCalibrationResult(dd), '');
});

test('both accepted: the result says so, with real numbers, and the goal-unchanged reassurance', () => {
  const a = planned({ distanceKey: 'half', weeks: 10 });
  const dd = calDayFixture(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  const html = a.renderCalibrationResult(dd);
  assert.match(html, /Training zones calibrated/);
  assert.match(html, /171 BPM/);
  assert.match(html, /goal hasn.t changed/);
  assert.equal(html.indexOf('Measured Fitness'), -1,
    'that term is reserved for races and Fitness Checkpoints');
  // fmtPaceFromSecPerKm() already appends the unit -- assert the exact
  // string once so a re-appended "/km" regresses loudly, not silently.
  assert.ok(html.indexOf(a.fmtPaceFromSecPerKm(dd.calibration.thresholdPaceSecPerKm)) !== -1);
  assert.equal(html.indexOf('/km/km'), -1, 'the unit must not be appended twice');
});

test('HR rejected, pace valid: the pace half is reported and the refusal is named', () => {
  const a = planned({ distanceKey: 'half', weeks: 10 });
  const dd = calDayFixture(a);
  logCalibration(a, dd, 42); // implausible_hr
  a.applyCalibrationFromDay(dd);
  assert.equal(dd.calibration.outcome, 'refused');
  assert.ok(dd.calibration.thresholdPaceSecPerKm, 'pace fails independently of HR');

  const html = a.renderCalibrationResult(dd);
  assert.match(html, /Training zones calibrated/, 'the pace half still succeeded');
  assert.equal(html.indexOf('Threshold HR'), -1, 'no HR row when HR was not accepted');
  assert.match(html, /Threshold pace/);
  assert.match(html, /outside a plausible range/);
});

test('pace rejected, HR valid: the HR half is reported and the pace refusal is named', () => {
  const a = planned({ distanceKey: 'half', weeks: 10 });
  const dd = calDayFixture(a);
  // 12km in 30:00 -- an implausible VDOT (> CALIBRATION_VDOT_MAX), HR stays 171.
  logCalibration(a, dd, 171, { settleKm: 4, measuredKm: 8 });
  a.applyCalibrationFromDay(dd);
  assert.equal(dd.calibration.outcome, 'applied', 'HR succeeds independently of pace');
  assert.equal(dd.calibration.thresholdPaceSecPerKm, undefined);
  assert.equal(dd.calibration.paceRefused, 'implausible_vdot');

  const html = a.renderCalibrationResult(dd);
  assert.match(html, /Training zones calibrated/, 'the HR half still succeeded');
  assert.match(html, /Threshold HR/);
  assert.equal(html.indexOf('Threshold pace'), -1, 'no pace row when pace was not accepted');
  assert.match(html, /outside a plausible range/);
});

test('effort too short: neither number is used, and the card says so without inventing one', () => {
  const a = planned({ distanceKey: 'half', weeks: 10 });
  const dd = calDayFixture(a);
  logCalibration(a, dd, 171, { measuredSec: 5 * 60 }); // effort_too_short
  a.applyCalibrationFromDay(dd);
  assert.equal(dd.calibration.thresholdPaceSecPerKm, undefined);
  assert.equal(dd.calibration.outcome, 'refused');

  const html = a.renderCalibrationResult(dd);
  assert.match(html, /Calibration not used/);
  assert.equal(html.indexOf('Threshold pace'), -1);
  assert.equal(html.indexOf('Threshold HR'), -1);
  assert.match(html, /existing training paces and threshold heart rate stand/);
});

test('a session whose instructions were rewritten is named as such, distinctly', () => {
  const a = planned({ distanceKey: 'half', weeks: 10 });
  const dd = calDayFixture(a);
  logCalibration(a, dd, 171);
  // Instructions rewritten without re-picking the type -- exactly the
  // pairing sessionIdentityTrusted() refuses to trust (see its own comment).
  dd.manualEdit = { fields: ['desc'] };
  a.applyCalibrationFromDay(dd);
  assert.equal(dd.calibration.reason, 'session_edited');

  const html = a.renderCalibrationResult(dd);
  assert.match(html, /Calibration not used/);
  assert.match(html, /instructions were edited/);
  assert.match(html, /still counts as training/);
});

test('renderDayCard() only ever shows the calibration result on a calibration day', () => {
  const a = planned({ distanceKey: 'half', weeks: 10 });
  const dd = calDayFixture(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);
  const calHtml = a.renderDayCard(dd);
  assert.match(calHtml, /Training zones calibrated/);

  const other = a.state.days.filter(d => d.type === 'easy' && !d.completed)[0];
  other.completed = true;
  other.actual = a.emptyActual();
  other.actual.km = other.km; other.actual.pace = '5:30';
  const easyHtml = a.renderDayCard(other);
  assert.equal(easyHtml.indexOf('Training zones calibrated'), -1);
  assert.equal(easyHtml.indexOf('cal-result'), -1);
});
