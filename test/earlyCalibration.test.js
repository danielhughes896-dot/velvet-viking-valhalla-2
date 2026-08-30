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
/* Log the session the way the athlete does: a structured row per work
   segment. Both carry a distance, because threshold PACE comes from the full
   thirty minutes; only the measured window carries the heart rate, because
   threshold HEART RATE comes from the final twenty. */
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
    dd.actual.splits.push({ segId: segIdFor(a, dd, role), role: role,
      label: role, km: km, sec: sec, paceSec: null, hr: rowHr });
  };
  /* 2.3km + 4.6km in 10 + 20 minutes = 6.9km in 30:00 = 4:21/km. */
  push('calibration_settle',
       o.settleKm === undefined ? 2.3 : o.settleKm,
       o.settleSec === undefined ? 10 * 60 : o.settleSec, null);
  push('calibration_measure',
       o.measuredKm === undefined ? 4.6 : o.measuredKm,
       o.measuredSec === undefined ? 20 * 60 : o.measuredSec, hr);
  return dd;
}
// The pace a full-protocol log implies: 6.9km in 30:00.
const DEFAULT_PACE = Math.round(1800 / 6.9);   // 261 s/km = 4:21

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

  /* THE WEEK KEEPS ITS COMPOSITION; TWO DAYS TRADE PLACES.
     The calibration is the FIRST prescribed running session of the programme,
     so where the quality spacing would have put it on day two, the day that
     was there and the day the calibration needs exchange roles. Nothing is
     added and nothing is dropped: the same number of running days, the same
     long run, the same easy distances, the same number of quality slots. The
     earlier form of this test asserted that exactly one day differed, which
     was true only while the calibration stayed where the spacing put it. */
  const wk1 = ds => ds.filter(d => d.week === 1);
  const multiset = ds => wk1(ds).map(d => d.type + '|' + d.km).sort().join('\n');
  const plainSet = multiset(plain).split('\n');
  const calSet = multiset(a.state.days).split('\n');
  assert.equal(calSet.length, plainSet.length, 'the week has the same number of days');
  assert.equal(wk1(a.state.days).filter(d => d.km > 0).length,
               wk1(plain).filter(d => d.km > 0).length,
               'and the same number of running days');
  assert.equal(wk1(a.state.days).filter(d => d.type === 'long').length,
               wk1(plain).filter(d => d.type === 'long').length,
               'and the same long run');

  /* THE CALIBRATION IS THE FIRST RUNNING SESSION. HQ's ruling, asserted
     directly: every session prescribed before it would be prescribed against
     an estimated threshold, which is what the session exists to replace. */
  const firstRun = a.state.days.filter(d => d.km > 0)[0];
  assert.equal(firstRun.date, dd.date,
    'the first prescribed running session is ' + firstRun.type + ', not the calibration');
  assert.equal(a.state.days.filter(d => d.km > 0 && d.date < dd.date).length, 0,
    'no session is prescribed before the threshold it is written against is measured');

  /* AND IT IS STILL THE THRESHOLD SLOT IT ALWAYS WAS -- the tempo family's
     allocation, not an extra session bolted onto the week. */
  assert.equal(wk1(a.state.days).filter(d =>
    QUALITY.indexOf(d.type) !== -1 && d.type !== 'calibration').length,
    qualityIn(plain, 1).length - 1,
    'the calibration is the week\'s quality session, not an addition to it');
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
  const m = a.calibrationResult(dd);
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

/* A SESSION THE ATHLETE HAS ALREADY RUN.
   It is no longer possible for one to precede the calibration inside its own
   block -- the calibration is the first running session of the programme, by
   rule -- so "already run" is asserted the way it is actually defined:
   dd.completed. That is the property every freeze in the product is keyed on,
   and testing it directly is stronger than testing a date ordering that stood
   in for it. */
function completedSessionAfter(a, dd){
  const s = a.state.days.filter(d => d.date > dd.date && d.type === 'easy')[0];
  s.completed = true;
  s.actual = Object.assign(a.emptyActual(), { km: s.km, pace: '5:30', hr: 138 });
  return s;
}

test('a completed session keeps the prescription it was actually given', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  const past = completedSessionAfter(a, dd);
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
  logCalibration(a, dd, 171);
  dd.actual.km = 12; dd.actual.pace = '4:20';
  assert.equal(a.performanceFromDay(dd), null);
});

// ---------------------------------------------------------------------------
// THE PACE HALF
// ---------------------------------------------------------------------------
test('the two anchors use different windows, and the physiology is why', () => {
  /* HEART RATE lags the effort and is still climbing through the opening ten,
     so it is averaged over the FINAL TWENTY. PACE does not lag -- the athlete
     is running at the effort from the first stride -- so the anchor is the
     COMPLETE THIRTY, and throwing away a third of the test would discard real
     evidence. */
  const a = app();
  assert.equal(a.measuredThresholdPace(7.5, 30 * 60), 240, '7.5km in 30:00 is 4:00/km');
  assert.equal(a.measuredThresholdPace(6, 30 * 60), 300);
  /* Absent a logged time, the prescription's own thirty minutes is the window. */
  assert.equal(a.measuredThresholdPace(7.5, null), 240);
  /* And it refuses the same way the heart-rate half does. */
  assert.equal(a.measuredThresholdPace(null, 1800), null);
  assert.equal(a.measuredThresholdPace(0, 1800), null);
  assert.equal(a.measuredThresholdPace(30, 1800), null, '1:00/km is a mis-logged distance');
  assert.equal(a.measuredThresholdPace(1.5, 1800), null, '20:00/km is not a threshold effort');
});

test('the pace anchor reads the whole effort, not just the measured window', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);                       // 2.3km + 4.6km = 6.9km
  const r = a.calibrationResult(dd);
  assert.equal(r.totalKm, 6.9);
  assert.equal(r.totalSec, 30 * 60);
  assert.equal(r.measuredSec, 20 * 60, 'while the HR window stays the final twenty');
  assert.equal(a.measuredThresholdPace(r.totalKm, r.totalSec), DEFAULT_PACE);
});

test('half a log is no pace at all, never an estimated one', () => {
  /* The thirty-minute average cannot be recovered from the final twenty alone:
     assuming the opening ten matched is exactly the assumption a settle
     segment exists to avoid, and an athlete who went out too fast would have
     that error hidden rather than measured. */
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171, { settleKm: null });
  const r = a.calibrationResult(dd);
  assert.equal(r.totalKm, null);
  a.applyCalibrationFromDay(dd);
  assert.equal(a.state.setup.thresholdPaceSecPerKm, undefined);
  assert.equal(a.state.setup.lthr, 171, 'but the heart rate half is unaffected');
});

test('a completed calibration stores the measured pace with its provenance', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  assert.equal(a.state.setup.thresholdPaceSecPerKm, DEFAULT_PACE);
  assert.equal(a.state.setup.thresholdPaceSource, 'calibration');
  assert.equal(a.state.setup.thresholdPaceMeasuredOn, dd.date);
  assert.equal(dd.calibration.thresholdPaceSecPerKm, DEFAULT_PACE);
});

test('the measured pace moves ALL five training zones, through one anchor', () => {
  /* THE METHODOLOGY DECISION. Training zones now represent current fitness, so
     a calibration moves them -- but through vdotFromPerformance(), the path any
     performance over a known distance has always taken, producing a complete
     ordered set. Writing a single zone into a table anchored elsewhere is what
     would break the ordering, which is why paceOverrides is still not touched. */
  const a = calibratedPlan();
  const before = a.getActivePaces();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);
  const after = a.getActivePaces();

  ['E','M','T','I','R'].forEach(k => {
    assert.notEqual(after[k].fast, before[k].fast, k + ' did not move');
  });
  assert.equal(a.currentFitnessAnchor().source, 'calibration');
  assert.deepEqual(a.state.setup.paceOverrides, {},
    'and the athlete\'s own manual override was not written to');
});

test('the zone table stays ordered after a calibration', () => {
  /* The property that a single overridden zone would have destroyed. It holds
     by construction because all five descend from one number -- so this is a
     test of the architecture, not of arithmetic. */
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  const z = a.getActivePaces();
  const order = ['E','M','T','I','R'];
  for (let i = 1; i < order.length; i++){
    const slower = z[order[i-1]], faster = z[order[i]];
    assert.ok(faster.fast < slower.fast,
      order[i] + ' must be faster than ' + order[i-1] +
      ' (' + faster.fast + ' vs ' + slower.fast + ')');
    assert.ok(faster.slow <= slower.slow, order[i] + '/' + order[i-1] + ' bands crossed');
  }
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
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  a.applyHealthConsentDecision({ decision: 'withdrawn', version: a.HEALTH_CONSENT_VERSION },
    true, { quiet: true });
  assert.equal(a.state.setup.lthr, null, 'the heart rate goes');
  assert.equal(a.state.setup.thresholdPaceSecPerKm, DEFAULT_PACE, 'the pace stays');
});

test('the two halves fail independently', () => {
  /* A chest strap that dropped out should not cost the athlete the distance
     they actually covered. They ran the test; the pace measures it. */
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, null);
  const out = a.applyCalibrationFromDay(dd);

  assert.equal(out.outcome, 'refused', 'no LTHR was fabricated');
  assert.equal(a.state.setup.lthr, null);
  assert.equal(a.state.setup.thresholdPaceSecPerKm, DEFAULT_PACE,
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
  logCalibration(a, dd, 171, { settleKm: 0.6, settleSec: 2*60, measuredKm: 1.2, measuredSec: 4 * 60 });
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

  /* VOLUME. The calibration must not make the week BIGGER -- that would be the
     session buying load, which it is expressly not allowed to do. It may make
     it very slightly smaller, because the calibration takes the tempo family's
     allocation while a plain single-slot week alternates between the two
     families and may be holding the interval's; that difference belongs to the
     alternation, not to the calibration, and is asserted as a bound rather
     than hidden. Weeks two and three are untouched either way. */
  /* WHAT "DOES NOT DISTURB THE WEEK" HAS TO MEAN, now that the session's cost
     is counted honestly.

     The calibration is a FIXED fifty-two-minute protocol. It does not scale to
     the athlete, and where it costs more than the week budgeted for its slot,
     the week comes out bigger by exactly that difference -- declared as a
     quality-day floor, the same way the checkpoint's time trial has always
     been. The old form of this test asserted the weeks were identical, which
     was only ever true because the day was presented at the tempo budget while
     prescribing a session twice that size.

     THE INVARIANT THAT ACTUALLY MATTERS IS THE ONE ABOUT PERMISSION: the
     calibration must not make the PROGRAMME bigger. The block's own target
     volumes are asserted identical, so nothing about the session changes what
     the athlete is being progressed towards -- and the delivered difference is
     bounded by, and attributed to, the declared floor.

     There is a second, unrelated reason the weeks after it differ: outside the
     taper each family's structure pool advances on that family's own DELIVERED
     occurrences, and the calibration is a tempo occurrence the plain block
     never had. That is the rotation working. */
  const calBlk = a.buildBlockWeeks('half', 45, 10, { calibrate: true });
  const plainBlk = a.buildBlockWeeks('half', 45, 10);
  assert.equal(calBlk.weeks.map(w => w.volume).join(','),
               plainBlk.weeks.map(w => w.volume).join(','),
    'the calibration buys no programme volume: every weekly target is identical');
  assert.equal(calBlk.peakVolume, plainBlk.peakVolume, 'and the block peaks in the same place');

  /* The declared floor is recorded on the week while the DAYS are built, so it
     has to be read from a block that has been through buildDaysFromWeeks(). */
  a.buildDaysFromWeeks(calBlk, a.state.setup.raceDate, a.state.setup.schedule, TODAY, false);
  const floorKm = (calBlk.weeks[0].qualityDayFloorKm || 0);
  assert.ok(floorKm > 0,
    'the fixed protocol costs more than the week budgeted, and the week says so');
  const over = km(a.state.days, 1) - km(plain, 1);
  assert.ok(over <= floorKm + 1e-9,
    'week 1 is ' + over + 'km over the plain week against a declared floor of ' + floorKm);
  [2, 3].forEach(n => {
    assert.ok(km(a.state.days, n) <= km(plain, n) + 1e-9,
      'week ' + n + ': ' + km(a.state.days, n) + 'km against ' + km(plain, n) + 'km');
    assert.ok(km(plain, n) - km(a.state.days, n) <= 1,
      'week ' + n + ' is no more than a kilometre below the plain block');
  });

  /* HARD-DAY COUNT AND SPACING. A test is only protected if the days around it
     are. The calibration moves to the front of the week by rule, so the DATES
     differ by design; what may not differ is how many hard days the week has
     or how close together they sit. */
  const HARD = ['tempo','threshold','interval','repetition','calibration','checkpoint','race'];
  const hard = days => wk(days, 1).filter(d => HARD.indexOf(d.type) !== -1).map(d => d.date);
  assert.equal(hard(a.state.days).length, hard(plain).length,
    'the week has the same number of hard days');
  const minGap = ds => { const h = hard(ds); let m = 99;
    for (let i = 1; i < h.length; i++)
      m = Math.min(m, Math.round((Date.parse(h[i]) - Date.parse(h[i-1])) / 86400000));
    return h.length > 1 ? m : 99; };
  assert.ok(minGap(a.state.days) >= minGap(plain),
    'and no two of them are closer together than they would have been');

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
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  const prior = Object.assign({}, a.state.setup);
  const next = a.carryMeasuredAnchors({ lthr: prior.lthr }, prior);
  assert.equal(next.lthrSource, 'calibration');
  assert.equal(next.lthrMeasuredOn, dd.date);
  assert.equal(next.thresholdPaceSecPerKm, DEFAULT_PACE);
  assert.equal(next.thresholdPaceSource, 'calibration');

  /* And an athlete who has never calibrated carries nothing rather than nulls. */
  assert.deepEqual(a.carryMeasuredAnchors({}, {}), {});
});

// ---------------------------------------------------------------------------
// THE SEPARATION: CURRENT FITNESS vs THE ACTIVE GOAL
//
// The methodology decision in one sentence: ordinary training zones represent
// what the athlete can currently do; the Active Goal represents what they are
// trying to do. Before this, both were the goal -- so raising an ambition made
// every easy run faster without the athlete getting fitter.
// ---------------------------------------------------------------------------
function setGoal(a, sec){
  a.state.setup.goals = Object.assign({}, a.state.setup.goals, { A: { timeSec: sec } });
  a.state.setup.activeGoal = 'A';
}

test('once fitness is measured, moving the goal does not move training zones', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  const zones = JSON.stringify(a.getActivePaces());
  const anchor = a.currentFitnessAnchor().vdot;

  /* A wildly more ambitious goal, and then a wildly less ambitious one. */
  setGoal(a, 80 * 60);
  assert.equal(JSON.stringify(a.getActivePaces()), zones, 'ambition is not fitness');
  setGoal(a, 130 * 60);
  assert.equal(JSON.stringify(a.getActivePaces()), zones, 'nor is pessimism');
  assert.equal(a.currentFitnessAnchor().vdot, anchor);
});

test('but goal pace still follows the Active Goal exactly as it always did', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  const before = a.getGoalPaceSecPerKm();
  setGoal(a, 80 * 60);
  const after = a.getGoalPaceSecPerKm();
  assert.notEqual(after, before, 'goal pace must track the goal');
  assert.ok(after < before, 'a faster goal is a faster goal pace');

  /* And the goal-pace SEGMENT of a session follows it too. */
  const gp = a.state.days.filter(d => {
    const p = a.prescriptionOf(d);
    return p && (a.orderedSegments(p) || []).some(s => s.intensity === 'goal_pace');
  })[0];
  if (gp){
    const band = a.getDayTargets(gp);
    assert.ok(band.goalPace || band.pace, 'a goal-pace session still resolves a target');
  }
});

test('a calibration does not touch Goal A, B or C', () => {
  const a = calibratedPlan();
  const goalsBefore = JSON.stringify(a.state.setup.goals);
  const activeBefore = a.state.setup.activeGoal;
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  assert.equal(JSON.stringify(a.state.setup.goals), goalsBefore,
    'the athlete chose those times; a field test does not get to rewrite them');
  assert.equal(a.state.setup.activeGoal, activeBefore);
});

// ---------------------------------------------------------------------------
// THE HIERARCHY
// ---------------------------------------------------------------------------
test('the anchor picks the best evidence available, in order', () => {
  const a = calibratedPlan();

  /* 3. BENCHMARK -- what a fresh athlete with a setup time has. */
  assert.equal(a.currentFitnessAnchor().source, 'benchmark');

  /* 2. CALIBRATION outranks it. */
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);
  assert.equal(a.currentFitnessAnchor().source, 'calibration');

  /* 1. A QUALIFIED MEASURED PERFORMANCE outranks that. */
  a.athlete().performances.push({ date: a.addDays(TODAY, -3), source: 'race',
                                  vdot: 52.0, qualified: true });
  assert.equal(a.currentFitnessAnchor().source, 'performance');
  assert.equal(a.currentFitnessAnchor().vdot, 52.0);
});

test('the goal is the anchor only when nothing better exists', () => {
  /* Which is the state every athlete starts in -- so this is a fallback, not
     an error, and it is the behaviour the product had for everyone before. */
  const a = app();
  buildPlan(a, { weeks: 10, startDate: TODAY, distanceKey: 'half', volume: 45,
                 schedule: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 } });
  a.state.setup.benchmark = null;
  assert.equal(a.currentFitnessAnchor().source, 'goal');
  assert.equal(a.currentFitnessAnchor().vdot, a.getActiveVDOT());
});

test('invalidating the measured evidence falls back down the hierarchy', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);
  a.athlete().performances.push({ date: a.addDays(TODAY, -3), source: 'race',
                                  vdot: 52.0, qualified: true });
  assert.equal(a.currentFitnessAnchor().source, 'performance');

  /* An athlete who jogged their race says so: it stops being a measurement. */
  a.athlete().performances[0].qualified = false;
  assert.equal(a.currentFitnessAnchor().source, 'calibration',
    'and the calibration underneath it takes over');

  /* Remove the calibration and the benchmark is next. */
  a.state.setup.thresholdPaceSource = null;
  assert.equal(a.currentFitnessAnchor().source, 'benchmark');
});

// ---------------------------------------------------------------------------
// SANITY, AND WHAT A BAD TEST CANNOT DO
// ---------------------------------------------------------------------------
test('a clearly bad test cannot rewrite the training zones', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  const zones = JSON.stringify(a.getActivePaces());

  /* A misplaced decimal point: 69km in half an hour. */
  logCalibration(a, dd, 171, { settleKm: 23, measuredKm: 46 });
  a.applyCalibrationFromDay(dd);

  assert.equal(a.state.setup.thresholdPaceSecPerKm, undefined, 'refused');
  assert.equal(JSON.stringify(a.getActivePaces()), zones, 'and nothing moved');
  assert.equal(a.currentFitnessAnchor().source, 'benchmark',
    'the previous trustworthy evidence stands');
});

test('a result too far from existing trustworthy evidence is refused', () => {
  /* Fitness does not move ten VDOT points in one session. A result that says
     it did is evidence about the measurement, not about the athlete. */
  const a = app();
  buildPlan(a, { weeks: 10, startDate: TODAY, distanceKey: 'half', volume: 45,
                 benchSec: 45 * 60, schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  const bench = a.currentFitnessAnchor();
  assert.equal(bench.source, 'benchmark');

  const wild = a.calibrationPaceAcceptable(200);      // ~3:20/km for 30 minutes
  assert.equal(wild.ok, false);
  assert.match(wild.reason, /implausible_shift_vs_benchmark/);

  /* A believable improvement is accepted. */
  const fine = a.calibrationPaceAcceptable(265);
  assert.equal(fine.ok, true);
});

test('an aspiration cannot veto a measurement', () => {
  /* The shift guard compares against trustworthy evidence only. If the goal is
     all the athlete has, it is not evidence and must not block the first real
     measurement they produce. */
  const a = app();
  buildPlan(a, { weeks: 10, startDate: TODAY, distanceKey: 'half', volume: 45,
                 schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  a.state.setup.benchmark = null;
  assert.equal(a.currentFitnessAnchor().source, 'goal');
  assert.equal(a.calibrationPaceAcceptable(300).ok, true,
    'a slow-but-plausible first measurement is accepted against a fast goal');
});

// ---------------------------------------------------------------------------
// THE PAST STAYS PUT, THE FUTURE MOVES
// ---------------------------------------------------------------------------
test('completed prescriptions are frozen; future ones follow the new anchor', () => {
  const a = calibratedPlan();
  const dd = calDay(a);

  const past = completedSessionAfter(a, dd);
  const pastFrozen = JSON.stringify(past);

  const future = a.state.days.filter(d => d.date > past.date && d.type === 'easy' &&
                                          !d.completed)[0];
  const futureBefore = a.getDayTargets(future).pace;

  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  assert.equal(JSON.stringify(past), pastFrozen,
    'that session was run against the zones of the day and keeps them');
  assert.notEqual(a.getDayTargets(future).pace, futureBefore,
    'a session still to come is prescribed from what the athlete can now do');
});

test('the athlete is told, and it is not called Measured Fitness', () => {
  /* That term is reserved for races and Fitness Checkpoints. This is a field
     test, and calling it the same thing would blur two kinds of evidence the
     product deliberately keeps apart. */
  const a = calibratedPlan();
  const said = [];
  a.showToast = m => said.push(m);
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);

  assert.equal(said.length, 1);
  assert.match(said[0], /Training zones calibrated/);
  assert.match(said[0], /LTHR 171 BPM/);
  assert.match(said[0], /threshold 4:21/);
  assert.ok(!/Measured Fitness/i.test(said[0]));
});

// ---------------------------------------------------------------------------
// THE FEEDBACK LOOP THAT MOVING TRAINING PACES ONTO MEASURED EVIDENCE CREATES
//
// Found by running it, not by reading it. Training paces now descend from the
// anchor, so anything admitted to the anchor lowers the targets -- and sessions
// run at that same diminished level then score close to perfect against them.
// Left alone, poor execution becomes the definition of good execution and the
// athlete is congratulated all the way down.
// ---------------------------------------------------------------------------
test('an abandoned race is not a measurement of a ceiling', () => {
  /* The athlete pulled up, or jogged it in. The session stays in the log as
     training; it simply stops being evidence of what they can do. */
  const a = calibratedPlan();
  const race = a.state.days.filter(d => d.type === 'long')[0];
  race.type = 'race';
  race.km = 21.1;
  race.completed = true;

  race.actual = Object.assign(a.emptyActual(), { km: 21.0, pace: '4:30', paceUnit: 'km' });
  assert.ok(a.performanceFromDay(race), 'a race actually run IS a measurement');

  race.actual.km = 12;      // 57% of the distance
  assert.equal(a.performanceFromDay(race), null,
    'an effort that stopped is not a maximal effort over a known distance');
  assert.equal(race.completed, true, 'and it is still training that happened');
});

test('one bad result does not drag the training zones down to meet it', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);
  const anchored = a.currentFitnessAnchor().vdot;
  const zones = JSON.stringify(a.getActivePaces());

  /* A single race far below everything else they have done. */
  a.athlete().performances.push({ date: a.addDays(TODAY, -4), source: 'race',
                                  vdot: anchored - 14, qualified: true });

  const after = a.currentFitnessAnchor();
  assert.equal(after.source, 'calibration', 'the evidence underneath it stands');
  assert.equal(after.disregarded.why, 'isolated_outlier', 'and it says what it set aside');
  assert.equal(JSON.stringify(a.getActivePaces()), zones, 'no target moved');
});

test('but a real decline is believed once it is corroborated', () => {
  /* A second result at the same level inside the window is a trend, not a bad
     morning. The athlete really is slower and their training should say so. */
  const a = calibratedPlan();
  const dd = calDay(a);
  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);
  const anchored = a.currentFitnessAnchor().vdot;

  a.athlete().performances.push({ date: a.addDays(TODAY, -20), source: 'race',
                                  vdot: anchored - 14, qualified: true });
  a.athlete().performances.push({ date: a.addDays(TODAY, -4), source: 'checkpoint',
                                  vdot: anchored - 13, qualified: true });

  const after = a.currentFitnessAnchor();
  assert.equal(after.source, 'performance');
  assert.ok(after.vdot < anchored, 'the anchor follows them down');
});

test('the anchor takes the best recent result, not the latest', () => {
  /* A race can be spoiled by weather, a stitch or a bad morning, and none of
     those is a drop in fitness. Real decline still shows: the window is six
     weeks, so a genuinely slower athlete runs out of good results. */
  const a = calibratedPlan();
  a.athlete().performances.push({ date: a.addDays(TODAY, -30), source: 'race',
                                  vdot: 50, qualified: true });
  a.athlete().performances.push({ date: a.addDays(TODAY, -2), source: 'race',
                                  vdot: 47, qualified: true });
  assert.equal(a.currentFitnessAnchor().vdot, 50, 'the better of the two, not the newer');

  /* Out of the window, it stops counting. */
  a.athlete().performances[0].date = a.addDays(TODAY, -200);
  assert.equal(a.currentFitnessAnchor().vdot, 47);
});

// ---------------------------------------------------------------------------
// RECONCILED WITH EDIT SESSION COHERENCE
//
// Edit Session stops a stale coaching identity surviving an edit that changed
// what a session IS. A physiological anchor is the last thing that should
// outlive such an edit: a threshold taken from an unknown effort is a false
// threshold, which is the outcome this whole design refuses.
// ---------------------------------------------------------------------------
test('a session whose instructions were rewritten yields no threshold', () => {
  const a = calibratedPlan();
  const dd = calDay(a);
  dd.manualEdit = { fields: ['desc'] };          // the instructions, not the type
  assert.equal(a.sessionIdentityTrusted(dd), false);

  logCalibration(a, dd, 171);
  const out = a.applyCalibrationFromDay(dd);

  assert.equal(out.outcome, 'refused');
  assert.equal(out.reason, 'session_edited');
  assert.equal(a.state.setup.lthr, null, 'no threshold from an unknown effort');
  assert.equal(a.state.setup.thresholdPaceSecPerKm, undefined);
  assert.equal(a.currentFitnessAnchor().source, 'benchmark', 'and the anchor is untouched');
  assert.equal(dd.completed, true, 'the day still counts as training');
});

test('but an ordinary correction does not throw the measurement away', () => {
  /* sessionIdentityTrusted() is deliberately narrow: it is the INSTRUCTIONS
     that make a card an untrustworthy statement of what was asked for. An
     athlete who fixed a title or a distance still ran the protocol. */
  const a = calibratedPlan();
  const dd = calDay(a);
  dd.manualEdit = { fields: ['title', 'km'] };
  assert.equal(a.sessionIdentityTrusted(dd), true);

  logCalibration(a, dd, 171);
  a.applyCalibrationFromDay(dd);
  assert.equal(a.state.setup.lthr, 171);
  assert.equal(a.currentFitnessAnchor().source, 'calibration');

  /* And re-picking the type restores trust even after an instruction edit --
     the athlete has said what the session now is. */
  const b = calibratedPlan();
  const bd = calDay(b);
  bd.manualEdit = { fields: ['desc', 'type'] };
  assert.equal(b.sessionIdentityTrusted(bd), true);
});

test('the completion threshold is one named rule, not a scattered number', () => {
  const a = calibratedPlan();
  assert.equal(a.MEASURED_EFFORT_COMPLETION_MIN, 0.85);

  /* The rule itself, at its edges. */
  assert.equal(a.effortWasCompleted(8.5, 10), true, '85% is completed');
  assert.equal(a.effortWasCompleted(8.4, 10), false);
  assert.equal(a.effortWasCompleted(10.4, 10), true, 'running long is not falling short');
  assert.equal(a.effortWasCompleted(5, 0), true, 'nothing prescribed, nothing to fall short of');

  /* AND THE ADMISSION RULE GOES THROUGH IT. performanceFromDay() decides what
     may become Measured Fitness, and it must ask the named rule rather than
     carry a ratio of its own -- which is what it did when the threshold was
     introduced. Asserted on the function, not on the file: two unrelated 0.85s
     live elsewhere in the runtime (a partial-session scoring ratio and a
     workout-variety weight) and folding independent rules together because
     they share a number would be worse than the duplication it removed. */
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected/velvet-viking-valhalla.html'), 'utf8');
  const fn = /function performanceFromDay\([^]*?\n\}/.exec(src)[0];
  assert.match(fn, /effortWasCompleted\(/, 'the admission rule bypasses the named threshold');
  assert.ok(!/0\.\d\d/.test(fn.replace(/\/\*[^]*?\*\//g, ' ')),
    'performanceFromDay carries a ratio literal of its own');
});
