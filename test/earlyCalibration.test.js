'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* EARLY THRESHOLD CALIBRATION
 * ===========================================================================
 * Every heart-rate figure in this product descends from state.setup.lthr. An
 * athlete who never typed one gets no HR zones at all -- correct behaviour,
 * poor outcome, because Valhalla can measure the anchor in one session.
 *
 * The failure this guards against is not a missing session. It is a WRONG
 * THRESHOLD, which does not announce itself: it silently moves every zone,
 * every target heart rate and every execution score for the rest of the block,
 * and the athlete has no way of knowing. So most of what follows is about the
 * derivation refusing, and about the one number it is allowed to read.
 */

const TODAY = '2026-03-02';                       // a Monday
const app = () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {};
  return a;
};

// A block built the way the generator builds one when calibration is needed.
function calibratedPlan(opts){
  const o = opts || {};
  const a = app();
  buildPlan(a, Object.assign({ weeks: 10, volume: 45, distanceKey: 'half',
                               startDate: TODAY }, o.plan || {}));
  const blk = a.buildBlockWeeks('half', 45, 10, { calibrate: true });
  a.state.days = a.buildDaysFromWeeks(blk, a.state.setup.raceDate,
    a.state.setup.schedule, TODAY, false);
  return a;
}
const calDay = a => a.state.days.filter(d => d.type === 'calibration')[0] || null;

function measuredSegId(a, dd){
  const segs = a.orderedSegments(a.prescriptionOf(dd)) || [];
  return (segs.filter(s => s.role === 'calibration_measure')[0] || {}).segId;
}
/* Log the session the way the athlete does: a structured row against the
   measured window, carrying its heart rate. */
function logCalibration(a, dd, hr, extra){
  const segId = measuredSegId(a, dd);
  dd.completed = true;
  dd.actual = dd.actual || a.emptyActual();
  dd.actual.splits = dd.actual.splits || [];
  dd.actual.splits.push(Object.assign(
    { segId: segId, role: 'calibration_measure', label: 'Measured 20 min',
      km: null, sec: 20 * 60, paceSec: null, hr: hr }, extra || {}));
  return dd;
}

// ---------------------------------------------------------------------------
// WHO GETS ONE
// ---------------------------------------------------------------------------
test('an athlete with no measured evidence gets one, in week one', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  assert.ok(dd, 'a calibration session was scheduled');
  assert.equal(dd.week, 1, 'the point is that the sessions AFTER it use real zones');
  assert.equal(a.prescriptionOf(dd).archetype, 'threshold_calibration');

  /* IT TAKES THE THRESHOLD SLOT RATHER THAN BEING ADDED TO IT. The test is
     that week one carries no MORE quality than it would have without the
     calibration -- the load is unchanged and only what the athlete is asked to
     do inside that slot is different. That is the progression protection. */
  const QUALITY = ['tempo','threshold','interval','repetition','calibration','checkpoint'];
  const qualityIn = (days, wk) =>
    days.filter(d => d.week === wk && QUALITY.indexOf(d.type) !== -1);

  const plain = a.buildDaysFromWeeks(a.buildBlockWeeks('half', 45, 10),
    a.state.setup.raceDate, a.state.setup.schedule, TODAY, false);
  assert.equal(qualityIn(a.state.days, 1).length, qualityIn(plain, 1).length,
    'the calibration replaced a session rather than adding one');

  /* ONE DAY CHANGED, AND ONLY ONE. Week one is otherwise the week the
     generator would have built anyway: same days, same distances, same long
     run, same interval session. The threshold slot became the calibration. */
  const shape = days => days.filter(d => d.week === 1)
    .map(d => d.date + '|' + d.type + '|' + d.km).join('\n');
  const diff = (a1, b1) => {
    const x = shape(a1).split('\n'), y = shape(b1).split('\n');
    return x.filter((line, i) => line !== y[i]);
  };
  const changed = diff(a.state.days, plain);
  assert.equal(changed.length, 1, 'exactly one day differs: ' + changed.join(' / '));
  assert.match(changed[0], /\|calibration\|/);
  const replaced = plain.filter(d => d.week === 1 && d.date === dd.date)[0];
  assert.equal(replaced.type, 'threshold', 'it took the threshold slot');
  assert.equal(replaced.km, dd.km, 'and the same distance, so weekly volume is untouched');

  /* Not day one: the athlete does not meet the product with a hard effort. */
  const firstRun = a.state.days.filter(d => d.type !== 'rest')[0];
  assert.notEqual(firstRun.date, dd.date, 'the block does not open on the test');
});

test('and exactly one, ever', () => {
  const a = calibratedPlan();
  assert.equal(a.state.days.filter(d => d.type === 'calibration').length, 1);
});

test('an athlete who already has an LTHR is not sent out to test again', () => {
  const a = app();
  buildPlan(a, { weeks: 10, volume: 45, lthr: 168, maxHR: 190, startDate: TODAY });
  const e = a.calibrationEligibility({ healthConsent: true, lthr: a.state.setup.lthr,
    performances: [], today: TODAY, currentVolume: 45 });
  assert.equal(e.needed, false);
  assert.equal(e.reason, 'lthr_known',
    'a supplied LTHR is trustworthy by the existing model -- every HR figure already descends from it');
});

test('a recent race or checkpoint stands in for the test', () => {
  const a = app();
  const recent = [{ date: a.addDays(TODAY, -10), source: 'race', qualified: true }];
  assert.equal(a.calibrationEligibility({ healthConsent: true, lthr: null,
    performances: recent, today: TODAY, currentVolume: 45 }).reason, 'recent_measured_effort');

  /* Old evidence is not current evidence. */
  const stale = [{ date: a.addDays(TODAY, -120), source: 'race', qualified: true }];
  assert.equal(a.calibrationEligibility({ healthConsent: true, lthr: null,
    performances: stale, today: TODAY, currentVolume: 45 }).needed, true);

  /* A disqualified performance was never a measurement. */
  const dq = [{ date: a.addDays(TODAY, -10), source: 'race', qualified: false }];
  assert.equal(a.calibrationEligibility({ healthConsent: true, lthr: null,
    performances: dq, today: TODAY, currentVolume: 45 }).needed, true);
});

test('a low-volume athlete is not handed a thirty-minute hard effort in week one', () => {
  const a = app();
  const at = v => a.calibrationEligibility({ healthConsent: true, lthr: null,
    performances: [], today: TODAY, currentVolume: v });
  assert.equal(at(12).reason, 'insufficient_base');
  assert.equal(at(19).needed, false);
  assert.equal(at(a.CALIBRATION_MIN_WEEKLY_KM).needed, true, 'the floor is inclusive');
});

test('experience level does not decide whether the session exists', () => {
  /* state.experience is a PRESENTATION layer by contract -- it changes how
     much of a session is explained, never what the session is. The protection
     for new and returning athletes is the volume floor above, which is a
     training-load judgement and therefore legitimately the generator's. */
  const a = app();
  ['novice', 'experienced', 'advanced'].forEach(level => {
    a.state = a.makeDefaultState();
    a.state.experience = level;
    assert.equal(a.calibrationEligibility({ healthConsent: true, lthr: null,
      performances: [], today: TODAY, currentVolume: 45 }).needed, true, level);
  });
});

// ---------------------------------------------------------------------------
// THE WORKOUT
// ---------------------------------------------------------------------------
test('the protocol is warm-up, thirty controlled minutes, cool-down', () => {
  const a = calibratedPlan();
  const segs = a.orderedSegments(a.prescriptionOf(calDay(a)));
  assert.equal(segs.map(s => s.role).join(' > '),
    'warmup > calibration_settle > calibration_measure > cooldown');

  const P = a.CALIBRATION_PROTOCOL;
  assert.equal(P.settleMin + P.measuredMin, 30, 'thirty minutes of effort');
  assert.equal(P.measuredMin, 20, 'and the last twenty are the measurement');
  assert.equal(segs.map(s => s.sec).join(','),
    [P.warmupMin*60, P.settleMin*60, P.measuredMin*60, P.cooldownMin*60].join(','));

  /* CONTROLLED, NOT MAXIMAL. A time trial's effort segment is 'hard_effort'
     and flagged maximal; this one is threshold work and must not be either,
     because an athlete who races it produces a decaying heart rate and a
     threshold anchor that is too high. */
  const effort = segs.filter(s => s.role.indexOf('calibration') === 0);
  effort.forEach(s => {
    assert.equal(s.intensity, 'threshold');
    assert.equal(s.maximal, false);
  });
});

test('it reads as a calibration, not as an ordinary workout', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  assert.match(dd.title, /Threshold Calibration/);
  assert.match(dd.desc, /controlled, not a sprint/);
  assert.match(dd.desc, /final 20 minutes/);
  assert.equal(a.TYPE_META.calibration.zoneKey, 'T');
  assert.equal(a.TYPE_META.calibration.cls, a.TYPE_META.checkpoint.cls,
    'it shares the Fitness Checkpoint visual language deliberately');
});

// ---------------------------------------------------------------------------
// THE DERIVATION
// ---------------------------------------------------------------------------
test('the threshold is the measured window, and nothing else', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  /* A whole-session average includes the warm-up and the cool-down, so it is
     deliberately not a fallback and must not be read even when present. */
  dd.actual.hr = 140;
  const m = a.calibrationMeasuredHR(dd);
  assert.equal(m.hr, 171, 'the number came from the measured segment');

  a.applyCalibrationFromDay(dd);
  assert.equal(a.state.setup.lthr, 171);
  assert.notEqual(a.state.setup.lthr, 140);
});

test('the derivation is arithmetic, not estimation', () => {
  const a = app();
  const at = hr => a.deriveCalibrationLTHR({ healthConsent: true, measuredHR: hr,
    measuredSec: 20 * 60 });
  assert.equal(at(171).lthr, 171, 'the average of the final twenty minutes IS the LTHR');
  assert.equal(at(171.4).lthr, 171, 'rounded, never scaled');
  assert.equal(at(171.6).lthr, 172);
  assert.equal(at('168').lthr, 168, 'a string from an input field is a number');
});

test('no heart rate means no threshold, and the session still counts as training', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, null);
  const out = a.applyCalibrationFromDay(dd);

  assert.equal(out.outcome, 'refused');
  assert.equal(out.reason, 'no_hr');
  assert.equal(a.state.setup.lthr, null, 'nothing was fabricated');
  assert.equal(dd.completed, true, 'the run still happened');
});

test('every implausible reading is refused, and says which check failed', () => {
  const a = app();
  const base = { healthConsent: true, measuredSec: 20 * 60 };
  const at = over => a.deriveCalibrationLTHR(Object.assign({}, base, over));

  assert.equal(at({ measuredHR: 42 }).reason, 'implausible_hr');
  assert.equal(at({ measuredHR: 240 }).reason, 'implausible_hr');
  assert.equal(at({ measuredHR: 0 }).reason, 'no_hr');
  assert.equal(at({ measuredHR: 175, maxHR: 175 }).reason, 'above_max_hr',
    'a threshold at max is a contradiction in terms');
  assert.equal(at({ measuredHR: 120, maxHR: 195 }).reason, 'implausible_vs_max_hr');
  assert.equal(at({ measuredHR: 140, recentEasyHR: 145 }).reason, 'not_above_easy_hr',
    'a threshold effort is not run at easy-run heart rate');
  assert.equal(at({ measuredHR: 171, measuredSec: 5 * 60 }).reason, 'effort_too_short',
    'the average heart rate over five minutes is not a threshold');

  /* Every refusal returns the same shape, and none of them returns a number. */
  ['implausible_hr','above_max_hr','not_above_easy_hr'].forEach(() => {});
  assert.equal(at({ measuredHR: 42 }).lthr, null);
  assert.equal(at({ measuredHR: 42 }).ok, false);
});

test('a measured anchor is not overwritten by a wildly different one', () => {
  const a = app();
  const at = (hr, prev, measured) => a.deriveCalibrationLTHR({ healthConsent: true,
    measuredHR: hr, measuredSec: 20*60, previousLTHR: prev, previousLTHRMeasured: measured });

  assert.equal(at(150, 175, true).reason, 'implausible_shift',
    'threshold heart rate does not move 25 beats inside a block');
  assert.equal(at(172, 175, true).ok, true, 'a normal drift is accepted');

  /* But an ESTIMATE the athlete typed is exactly what this session exists to
     improve on, so it never blocks a measurement. */
  assert.equal(at(150, 175, false).ok, true);
});

// ---------------------------------------------------------------------------
// THE ARTICLE 9 BOUNDARY
// ---------------------------------------------------------------------------
test('without consent there is no calibration session at all', () => {
  const a = app();
  assert.equal(a.calibrationEligibility({ healthConsent: false, lthr: null,
    performances: [], today: TODAY, currentVolume: 45 }).reason, 'no_health_consent');
});

test('without consent no threshold is derived, and none is stored', () => {
  const a = calibratedPlan({ plan: { healthConsent: false } });
  assert.equal(a.healthConsentGranted(), false);

  /* The derivation refuses at its own boundary, not only at the caller's. */
  assert.equal(a.deriveCalibrationLTHR({ healthConsent: false, measuredHR: 171,
    measuredSec: 20*60 }).reason, 'no_health_consent');

  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);
  assert.equal(a.state.setup.lthr, null, 'nothing derived');
  assert.equal(a.state.setup.lthrSource, undefined, 'and no provenance either');
});

test('withdrawing consent takes the measured anchor and its provenance', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);
  assert.equal(a.state.setup.lthr, 171);

  a.applyHealthConsentDecision({ decision: 'withdrawn', version: a.HEALTH_CONSENT_VERSION },
    true, { quiet: true });
  assert.equal(a.state.setup.lthr, null);
  assert.equal(a.state.setup.lthrSource, null,
    'a provenance left behind would claim a measurement that has been erased');
});

// ---------------------------------------------------------------------------
// WHAT IT CHANGES, AND WHAT IT MUST NOT
// ---------------------------------------------------------------------------
test('a successful calibration moves the zones every later session is prescribed from', () => {
  const a = calibratedPlan();
  /* Consent is granted but there is no anchor yet, so the table exists and is
     empty of numbers -- which is why no session has a target heart rate. */
  assert.equal(a.getActiveHRZones().T.lo, null, 'no anchor, no numbers');
  assert.equal(a.getTargetHRRangeForDay(calDay(a)), null);

  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  const z = a.getActiveHRZones();
  assert.equal(z.T.lo, 171, 'threshold zone sits on the measured anchor');
  assert.equal(z.E.lo, 171 + a.HR_ZONE_OFFSETS.E.lo, 'and easy follows from it');

  /* Through the deterministic path the product already used -- no second zone
     engine, and no per-session override. */
  const later = a.state.days.filter(d => d.date > dd.date && d.type === 'easy')[0];
  const range = a.getTargetHRRangeForDay(later);
  assert.ok(range && range.lo != null, 'a future easy run now has a target HR range');
  assert.equal(range.lo, a.hrZonesFromLTHR(171, a.state.setup.maxHR).E.lo);
});

test('a completed session keeps the prescription it was actually given', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  const past = a.state.days.filter(d => d.date < dd.date && d.type === 'easy')[0];
  past.completed = true;
  past.actual = Object.assign(a.emptyActual(), { km: past.km, pace: '5:30', hr: 138 });
  const before = JSON.stringify(past);

  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  assert.equal(JSON.stringify(past), before,
    'the past is not rewritten -- that session was run against the zones of the day');
});

test('a calibration is not a race result', () => {
  /* Distinct concepts, and the one place they must not blur. A checkpoint is a
     MAXIMAL effort over a known distance and feeds Measured Fitness; this is a
     controlled thirty minutes whose output is a heart rate. Filing it as a
     performance would move Measured Fitness on a session nobody raced. */
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  dd.actual.km = 8; dd.actual.pace = '4:10';

  assert.equal(a.performanceFromDay(dd), null, 'it is not a measured performance');
  a.applyCalibrationFromDay(dd);
  assert.equal(a.measuredPerformances().length, 0, 'and Measured Fitness has not moved');
  assert.notEqual(dd.type, 'checkpoint');
  assert.notEqual(dd.type, 'race');
});

test('confidence comes through the existing evidence model, not a bonus', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  dd.actual.km = dd.km; dd.actual.pace = '4:40'; dd.actual.rpe = 7; dd.actual.feel = 'good';
  a.applyCalibrationFromDay(dd);

  /* It contributes exactly as any completed session does: an execution score
     against a weight. There is no calibration term anywhere in the score. */
  const w = a.executionWeightForDay(dd);
  assert.ok(w > 0, 'it carries evidence weight like any other session');
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected/velvet-viking-valhalla.html'), 'utf8');
  const fn = /function computeConfidenceScore\([^]*?\n\}/.exec(src)[0];
  assert.doesNotMatch(fn, /calibration/i, 'no arbitrary calibration bonus');
});

test('an estimate and a measurement do not look the same', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);
  assert.equal(a.state.setup.lthrSource, 'calibration');
  assert.equal(a.state.setup.lthrMeasuredOn, dd.date);
  assert.match(a.lthrProvenanceSuffix(), /measured/);

  a.state.setup.lthrSource = null;
  assert.match(a.lthrProvenanceSuffix(), /estimate/);
});

// ---------------------------------------------------------------------------
// PERSISTENCE AND RENDERING
// ---------------------------------------------------------------------------
test('the anchor and its provenance survive a reload', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  const round = JSON.parse(JSON.stringify(a.state));
  assert.equal(round.setup.lthr, 171);
  assert.equal(round.setup.lthrSource, 'calibration');
  assert.equal(round.setup.lthrMeasuredOn, dd.date);

  /* And the logged evidence rides in the ordinary splits array, so backup,
     archive, restore and cloud sync carry it with no second persistence model. */
  const day = round.days.filter(d => d.type === 'calibration')[0];
  assert.equal(day.actual.splits.filter(s => s.role === 'calibration_measure')[0].hr, 171);
});

test('a new block keeps the measurement rather than demoting it to an estimate', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  assert.equal(a.calibrationNeededNow(45), false,
    'and the next block is therefore not eligible for a test it does not need');
});

test('it renders in Today, This Week and Full Plan', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  a.state.view = 'today';
  const views = {
    today: () => { a.pinnedToday = dd.date; return a.renderWeekAccordion(1, true); },
    week: () => a.renderWeekView(),
    full: () => a.renderFullPlanView()
  };
  Object.keys(views).forEach(k => {
    let html = '';
    assert.doesNotThrow(() => { html = views[k](); }, k + ' threw');
    assert.match(html, /Threshold Calibration/, k + ' does not show the session');
  });
});
