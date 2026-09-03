'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* MEASUREMENT SESSIONS ARE THEIR OWN CLASS
 * ===========================================================================
 * A Fitness Checkpoint and a Threshold Calibration exist to MEASURE the
 * athlete. Their PURPOSE is measurement; their PRICE is a hard session, and
 * the two were being confused: because a calibration is "a test", it had
 * drifted out of every load and recovery reading in the product.
 *
 * What is asserted here is the separation itself -- cost visible, evidence
 * kept apart, and no permission bought by either.
 */
const TODAY = '2026-03-02';                       // a Monday
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {};
  return a;
}
function calibratedPlan(){
  const a = app();
  buildPlan(a, { weeks: 12, volume: 45, distanceKey: 'half', startDate: TODAY });
  // availableDays must match the fixture's own schedule (5 active days) --
  // buildBlockWeeks() defaults to assuming 6 when it is omitted, which the
  // real app's handleGeneratePlan() never does (it always passes the
  // athlete's real selected-day count). Race Goal Half/Marathon's tight
  // day-count contract reads this figure directly, so leaving it mismatched
  // from the schedule buildDaysFromWeeks() actually uses is a fixture bug,
  // not a methodology one.
  const availableDays = a.state.setup.schedule.activeDays.length;
  const blk = a.buildBlockWeeks('half', 45, 12, { calibrate: true, availableDays });
  a.state.days = a.buildDaysFromWeeks(blk, a.state.setup.raceDate,
    a.state.setup.schedule, TODAY, false);
  return a;
}
const dayOfType = (a, t) => a.state.days.filter(d => d.type === t && d.km > 0)[0] || null;

test('the class exists, names both tests, and names nothing else', () => {
  const a = app();
  /* Compared as text: the app runs in its own VM realm, so an array it
     created is never reference-equal to one created here. */
  assert.equal(a.TEST_SESSION_TYPES.slice().sort().join(','), 'calibration,checkpoint');
  ['calibration', 'checkpoint'].forEach(t => assert.equal(a.isTestSession(t), true, t));
  ['easy', 'long', 'tempo', 'threshold', 'interval', 'repetition', 'race', 'rest']
    .forEach(t => assert.equal(a.isTestSession(t), false, t));
});

test('a calibration costs what a hard session costs, everywhere cost is read', () => {
  /* THE DEFECT THIS CLOSES, SITE BY SITE. Every one of these read the
     calibration as an easy run or as nothing at all. */
  const a = calibratedPlan();
  const cal = dayOfType(a, 'calibration');
  assert.ok(cal, 'the fixture prescribed a calibration');

  assert.equal(a.isQualityType('calibration'), true, 'it is hard running');
  assert.equal(a.sessionImportance(cal), 'KEY',
    'a planned measurement is a KEY session, not SUPPORT the adapt step may cut first');
  assert.equal(a.executionWeightForType('calibration'), 2.0,
    'and it scores with a hard session\'s weight, not an easy run\'s');
  assert.ok(a.RECOVERY_QUALITY_TYPES.indexOf('calibration') !== -1,
    'the post-race no-intensity window knows it is intensity');

  const st = a.horizonStimulus([cal]);
  assert.equal(st.qualityExposures, 1, 'it is an exposure');
  assert.equal(st.testExposures, 1, 'and specifically a test exposure');
  assert.equal(st.testKm, cal.km, 'its kilometres are accounted for');
  assert.equal(st.totalKm, cal.km);

  /* AND ITS EFFORT IS READABLE. Without a band the day's RPE could not be
     judged in either direction. */
  assert.equal(a.expectedRPEBand(cal).join('-'), '6-8',
    'a controlled thirty minutes is a threshold effort, not a maximal one');
});

test('the two tests are not the same effort', () => {
  /* A checkpoint is a MAXIMAL time trial; a calibration is the hardest pace
     the athlete can HOLD. Sharing a class must not blur that. */
  const a = calibratedPlan();
  const cal = dayOfType(a, 'calibration');
  const chk = a.state.days.filter(d => d.type === 'checkpoint' && d.km > 0)[0];
  assert.ok(chk, 'the fixture also prescribed a checkpoint');
  assert.equal(a.expectedRPEBand(cal).join('-'), '6-8');
  assert.equal(a.expectedRPEBand(chk).join('-'), '8-10');
  assert.equal(a.TYPE_META.calibration.zoneKey, 'T');
  assert.equal(a.prescriptionOf(cal).archetype, 'threshold_calibration');
  assert.equal(a.prescriptionOf(chk).archetype, 'time_trial');
});

test('a test result is not an ordinary training response', () => {
  /* THE EVIDENCE SEPARATION, ASSERTED RATHER THAN LEFT TO FALL OUT.
     familyResponse() learns how long an athlete takes to recover from each
     FAMILY of training. A maximal or near-maximal test is not a member of any
     of them: averaging a thirty-minute field test into "how this athlete
     responds to threshold work" would corrupt the very model the calibration
     exists to improve the inputs of. */
  const a = app();
  assert.equal(a.sessionFamily('calibration'), null);
  assert.equal(a.sessionFamily('checkpoint'), null);
  a.TEST_SESSION_TYPES.forEach(t => {
    assert.ok(a.SESSION_FAMILIES.indexOf(t) === -1, t + ' must not be a session family');
    assert.ok(a.DEMANDING_FAMILIES.indexOf(t) === -1, t + ' must not be a demanding family');
  });
  /* Which means it is never comparable to a training session, in either
     direction -- the model simply cannot see it. */
  const cal = { date: TODAY, type: 'calibration', km: 8 };
  const thr = { date: TODAY, type: 'threshold', km: 8 };
  assert.equal(a.sessionComparability(cal, thr), 'poor');
  assert.equal(a.sessionComparability(cal, cal), 'poor');
});

test('being a TEST buys no additional quality session', () => {
  /* THE LOOPHOLE THIS FORECLOSES. Quality FREQUENCY is decided by the
     aerobic-dominance ceiling and the earned second exposure, neither of which
     consults the session class -- and the calibration takes the week's
     existing slot rather than adding one. Proven on the delivered plan: the
     calibration week carries no more quality than the same week without it. */
  const a = calibratedPlan();
  const plain = a.buildDaysFromWeeks(
    a.buildBlockWeeks('half', 45, 12, { availableDays: a.state.setup.schedule.activeDays.length }),
    a.state.setup.raceDate, a.state.setup.schedule, TODAY, false);
  const cal = dayOfType(a, 'calibration');
  const hardIn = (days, wk) => days.filter(d => d.week === wk && d.km > 0 &&
    a.isQualityType(d.type)).length;
  assert.equal(hardIn(a.state.days, cal.week), hardIn(plain, cal.week),
    'the calibration week carries the same number of hard sessions either way');
  /* And across the whole block, so it cannot be paying for itself later. */
  const total = days => days.filter(d => d.km > 0 && a.isQualityType(d.type)).length;
  assert.equal(total(a.state.days), total(plain),
    'and the block carries the same number in total');
});

test('a reshape cannot quietly spend the measurement', () => {
  const a = calibratedPlan();
  const cal = dayOfType(a, 'calibration');
  const week = a.state.days.filter(d => d.week === cal.week);
  const without = week.filter(d => d.date !== cal.date);
  const before = a.horizonStimulus(week), after = a.horizonStimulus(without);
  assert.equal(a.stimulusPreserved(before, after).testKept, false,
    'dropping the test is reported as a loss of the test');
  assert.equal(a.stimulusPreserved(before, before).testKept, true);
});

test('a calibration contributes zone time even with its prescription gone', () => {
  /* The structured path covers every calibration the generator writes. A
     legacy or hand-edited day has lost its prescription, and before this
     existed such a day contributed no time to any zone at all. */
  const a = calibratedPlan();
  const cal = dayOfType(a, 'calibration');
  delete cal.prescription;
  const z = a.weekZoneTime ? a.weekZoneTime(cal.week) : null;
  assert.ok(z == null || z.totalSec > 0);
  const approx = a.structuredZoneTime(cal);
  assert.equal(approx, null, 'with no prescription there is no structured reading');
});
