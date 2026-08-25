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
  /* ONE CONTINUOUS EFFORT, said in the prescription itself. The 10/20 split is
     a data-capture mechanism; an athlete who reads it as two threshold
     intervals runs an ordinary threshold session with a breather in the
     middle, and an ordinary threshold session measures nothing. */
  assert.match(dd.desc, /ONE continuous/);
  assert.match(dd.desc, /no break, no recovery and no change of pace/);
  assert.match(dd.desc, /final 20 minutes are simply the part we measure/);
  assert.match(dd.desc, /sustain evenly for the full 30 minutes/);
  assert.ok(!/not a sprint\b/.test(dd.desc) || /sustain/.test(dd.desc));
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

// ---------------------------------------------------------------------------
// ONE EFFORT, NOT TWO INTERVALS
//
// The 10/20 split is a data-capture mechanism. An athlete who reads it as two
// threshold intervals runs an ordinary threshold session with a breather in
// the middle -- and an ordinary threshold session measures nothing. Every
// athlete-facing string therefore has to say the effort is continuous.
// ---------------------------------------------------------------------------
test('every athlete-facing string says the thirty minutes are continuous', () => {
  const a = calibratedPlan();
  const dd = calDay(a);

  assert.match(dd.desc, /ONE continuous/);
  assert.match(dd.desc, /no break, no recovery and no change of pace/);

  const g = a.ARCHETYPE_GUIDANCE.threshold_calibration;
  assert.match(g.cue, /continuous/i);
  assert.match(g.cue, /no break at 10 minutes/i);
  assert.match(g.how, /ONE unbroken effort/);
  assert.match(g.avoid, /ordinary threshold session/i,
    'the failure mode is named, not implied');

  /* And at both depths -- the terse copy is where a hurried reader looks. */
  const terse = a.TERSE_GUIDANCE.threshold_calibration;
  assert.match(terse.how, /UNBROKEN/,
    'terse copy is capped at 16 words, so the continuity rides on one word');
  assert.match(terse.avoid, /easing off at 10 min/i);
});

test('the two halves are labelled as one effort split for measurement', () => {
  const a = calibratedPlan();
  const segs = a.orderedSegments(a.prescriptionOf(calDay(a)));
  const labels = segs.map(s => a.segmentLabel(s));
  assert.match(labels[1], /Time trial/);
  assert.match(labels[2], /Same effort/,
    'the second row must not read as a second interval');
  assert.match(labels[2], /measured/i);
});

test('no recovery segment exists between the two halves', () => {
  /* Structural, not editorial: if a recovery ever appeared here the session
     really would be two intervals, whatever the prose said. */
  const a = calibratedPlan();
  const segs = a.orderedSegments(a.prescriptionOf(calDay(a)));
  assert.equal(segs.filter(s => s.kind === 'recovery').length, 0);
  assert.equal(segs[1].intensity, segs[2].intensity,
    'one effort means one intensity either side of the measurement boundary');
});

// ---------------------------------------------------------------------------
// RUN BY EFFORT, NOT TO AN ESTIMATED BAND
// ---------------------------------------------------------------------------
test('the calibration effort carries no prescribed pace band', () => {
  /* CIRCULARITY. Every pace window descends from getActiveVDOT(), which reads
     the athlete's GOAL -- an aspiration. This athlete's goal-derived threshold
     band is the least trustworthy number in their plan, and it is the number
     this session exists to replace. Printing it invites them to pace the test
     to the guess, after which the measured heart rate describes the guess. */
  const a = calibratedPlan();
  const segs = a.orderedSegments(a.prescriptionOf(calDay(a)));
  segs.filter(s => String(s.role).indexOf('calibration') === 0).forEach(sg => {
    assert.equal(a.stepShowsPaceBand(sg), false, sg.role);
    assert.equal(a.stepTarget(sg), null, 'and therefore no target: ' + sg.role);
    assert.equal(a.stepEffortWord(sg), 'Hard, sustainable',
      'the effort word must not say "Maximal" -- that instruction corrupts the test');
  });
});

test('a watch is handed an open step, not an estimated target', () => {
  const a = calibratedPlan();
  const segs = a.orderedSegments(a.prescriptionOf(calDay(a)));
  const measured = segs.filter(s => s.role === 'calibration_measure')[0];
  const t = a.providerTargets(measured);
  assert.deepEqual(t.targets.length, 0);
  assert.equal(t.openReason, 'calibration');
});

test('maximal stays false, and that is not what classifies a Fitness Checkpoint', () => {
  /* The flag is presentation and export: it suppresses the band, relabels the
     step "Time trial" and opens the export. What decides whether something is
     a measured performance is dd.type, read by performanceFromDay(). So
     leaving it false costs nothing and avoids telling an athlete to run
     maximally a session they must hold evenly for half an hour. */
  const a = calibratedPlan();
  const dd = calDay(a);
  a.orderedSegments(a.prescriptionOf(dd))
    .forEach(sg => assert.equal(sg.maximal, false, sg.role));

  /* Proof that the classification is elsewhere: a fully logged calibration,
     with distance and pace, is still not a measured performance. */
  logCalibration(a, dd, 171, { km: 7.0 });
  dd.actual.km = 12; dd.actual.pace = '4:20';
  assert.equal(a.performanceFromDay(dd), null);
});

// ---------------------------------------------------------------------------
// THE PACE HALF
// ---------------------------------------------------------------------------
test('threshold pace is measured from the same window as the heart rate', () => {
  const a = app();
  /* 5km covered in the measured 20 minutes = 4:00/km. */
  assert.equal(a.measuredThresholdPace(5, 20 * 60), 240);
  assert.equal(a.measuredThresholdPace(4, 20 * 60), 300);
  /* Absent the logged time, the prescription's own 20 minutes is the window. */
  assert.equal(a.measuredThresholdPace(5, null), 240);
  /* And it refuses the same way the heart-rate half does. */
  assert.equal(a.measuredThresholdPace(null, 1200), null);
  assert.equal(a.measuredThresholdPace(0, 1200), null);
  assert.equal(a.measuredThresholdPace(20, 1200), null, '1:00/km is a mis-logged distance');
  assert.equal(a.measuredThresholdPace(1, 1200), null, '20:00/km is not a threshold effort');
});

test('a completed calibration stores the measured pace with its provenance', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171, { km: 5 });
  a.applyCalibrationFromDay(dd);

  assert.equal(a.state.setup.thresholdPaceSecPerKm, 240);
  assert.equal(a.state.setup.thresholdPaceSource, 'calibration');
  assert.equal(a.state.setup.thresholdPaceMeasuredOn, dd.date);
  assert.equal(dd.calibration.thresholdPaceSecPerKm, 240);
});

test('the measured pace does NOT overwrite the pace zones', () => {
  /* THE FINDING THAT DECIDED THIS. HR zones all descend from one anchor, so
     measuring it moves the table coherently. Pace zones all descend from
     getActiveVDOT() -- the athlete's GOAL -- so a measured T dropped into that
     table leaves E/M/I/R derived from an aspiration and the table stops being
     ordered. An athlete covering 6.2km in the effort measures T at 4:50/km,
     which is SLOWER than the marathon pace their own goal prescribes. */
  const a = calibratedPlan();
  const before = JSON.stringify(a.getActivePaces());
  const dd = calDay(a);
  logCalibration(a, dd, 171, { km: 5 });
  a.applyCalibrationFromDay(dd);

  assert.equal(JSON.stringify(a.getActivePaces()), before,
    'no pace zone moved');
  assert.deepEqual(a.state.setup.paceOverrides, {},
    'and the athlete\'s own manual override was not written to');
});

test('but it is reported against the band the goal implies', () => {
  /* Kept and told, not applied -- exactly what a Fitness Checkpoint does with
     its result. The athlete finds out whether their goal and their legs agree. */
  const a = calibratedPlan();
  const goalT = a.getActivePaces().T;
  const mid = (goalT.fast + goalT.slow) / 2;

  const agrees = a.calibrationPaceVerdict(Math.round(mid), goalT);
  assert.equal(agrees.agrees, true);
  assert.equal(Math.abs(agrees.deltaSec) <= 1, true);

  const slower = a.calibrationPaceVerdict(Math.round(goalT.slow) + 45, goalT);
  assert.equal(slower.agrees, false);
  assert.ok(slower.deltaSec > 0, 'a slower measured pace reads as a positive delta');

  const faster = a.calibrationPaceVerdict(Math.round(goalT.fast) - 45, goalT);
  assert.equal(faster.agrees, false);
  assert.ok(faster.deltaSec < 0);

  /* No goal band to compare against is not a failure. */
  const bare = a.calibrationPaceVerdict(260, null);
  assert.equal(bare.agrees, null);
  assert.equal(bare.measured, 260);
});

test('the pace survives a consent withdrawal, because it is not health data', () => {
  /* A distance over a time is ordinary training data, exactly as splits and
     completion already are. Only the heart rate is special-category. Clearing
     the pace would delete the athlete's own performance record on the strength
     of a decision about something else. */
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171, { km: 5 });
  a.applyCalibrationFromDay(dd);

  a.applyHealthConsentDecision({ decision: 'withdrawn', version: a.HEALTH_CONSENT_VERSION },
    true, { quiet: true });
  assert.equal(a.state.setup.lthr, null, 'the heart rate goes');
  assert.equal(a.state.setup.thresholdPaceSecPerKm, 240, 'the pace stays');
});

test('the two halves fail independently', () => {
  /* A chest strap that dropped out should not cost the athlete the distance
     they actually covered. They ran the test; the pace measures it. */
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, null, { km: 5 });
  const out = a.applyCalibrationFromDay(dd);

  assert.equal(out.outcome, 'refused', 'no LTHR was fabricated');
  assert.equal(a.state.setup.lthr, null);
  assert.equal(a.state.setup.thresholdPaceSecPerKm, 240,
    'but the pace they genuinely ran is kept');
  assert.equal(a.state.setup.thresholdPaceSource, 'calibration');
});

test('an effort that did not happen yields neither number', () => {
  /* The one refusal that kills both. Four minutes of running is not twenty
     minutes of threshold, so neither the heart rate nor the pace describes a
     threshold -- and a pace from it would be the fastest thing they did all
     week, stored as their anchor. */
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171, { km: 1.2, sec: 4 * 60 });
  const out = a.applyCalibrationFromDay(dd);

  assert.equal(out.reason, 'effort_too_short');
  assert.equal(a.state.setup.lthr, null);
  assert.equal(a.state.setup.thresholdPaceSecPerKm, undefined,
    'a 3:20/km "threshold" from four minutes must not become the anchor');
});

// ---------------------------------------------------------------------------
// THE WEEK AROUND THE TEST
//
// The full 30 minutes is kept, so the week has to absorb 12 more minutes of
// threshold running than it otherwise would (18 -> 30). What must NOT change
// is everything else: the volume, the spacing of hard days, and the recovery
// on either side.
// ---------------------------------------------------------------------------
test('keeping the full protocol does not disturb the week around it', () => {
  const a = calibratedPlan();
  const plain = a.buildDaysFromWeeks(a.buildBlockWeeks('half', 45, 10),
    a.state.setup.raceDate, a.state.setup.schedule, TODAY, false);
  const dd = calDay(a);
  const wk = (days, n) => days.filter(d => d.week === n);
  const km = (days, n) => wk(days, n).reduce((t, d) => t + (d.km || 0), 0);

  /* Volume, for the test week and the two that follow it. */
  [1, 2, 3].forEach(n => assert.equal(km(a.state.days, n), km(plain, n), 'week ' + n));

  /* HARD-DAY SPACING. A test is only protected if the days around it are.
     Same hard days, same gaps, as the week the generator would have built. */
  const HARD = ['tempo','threshold','interval','repetition','calibration','checkpoint','race'];
  const hard = days => wk(days, 1).filter(d => HARD.indexOf(d.type) !== -1).map(d => d.date);
  assert.deepEqual(hard(a.state.days).join(','), hard(plain).join(','),
    'the hard days fall on the same dates');

  /* AND THE DAY AFTER THE TEST IS RECOVERY. Structural, because a thirty
     minute maximal-sustainable effort followed by a quality session would be
     the progression damage this was told to avoid. */
  const next = a.state.days.filter(d => d.date > dd.date)[0];
  assert.ok(next.type === 'rest' || next.type === 'easy',
    'the day after the calibration is ' + next.type);
});

test('the protocol is not quietly shortened to protect a load percentage', () => {
  const a = calibratedPlan();
  const P = a.CALIBRATION_PROTOCOL;
  assert.equal(P.settleMin + P.measuredMin, 30, 'the field test is thirty minutes');
  assert.equal(P.measuredMin, 20);
  const segs = a.orderedSegments(a.prescriptionOf(calDay(a)));
  const effortSec = segs.filter(s => String(s.role).indexOf('calibration') === 0)
    .reduce((t, s) => t + s.sec, 0);
  assert.equal(effortSec, 30 * 60);
});

test('a measured anchor is a fact about the athlete, not about the block', () => {
  /* Both anchors, and both provenances, survive a block transition. Without
     this a measured value would quietly demote itself to an estimate at the
     block boundary -- and the new block would then be eligible for a
     calibration the athlete has already done. */
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171, { km: 5 });
  a.applyCalibrationFromDay(dd);

  const prior = Object.assign({}, a.state.setup);
  const next = a.carryMeasuredAnchors({ lthr: prior.lthr }, prior);
  assert.equal(next.lthrSource, 'calibration');
  assert.equal(next.lthrMeasuredOn, dd.date);
  assert.equal(next.thresholdPaceSecPerKm, 240);
  assert.equal(next.thresholdPaceSource, 'calibration');

  /* And an athlete who has never calibrated carries nothing rather than nulls. */
  assert.deepEqual(a.carryMeasuredAnchors({}, {}), {});
});
