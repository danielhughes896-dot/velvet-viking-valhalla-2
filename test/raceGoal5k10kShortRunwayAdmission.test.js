'use strict';
/* HQ PRE-MERGE GATE, QUESTION 2 -- EVIDENCE-GATED ADMISSION BELOW EIGHT WEEKS.
 * ===========================================================================
 * raceGoalAdmission() used to refuse every 5K/10K Race Goal below eight weeks
 * on the calendar alone, before the athlete's own preparation was ever asked
 * about. Measured against raceGoalPreparationOutlook() -- the same authority
 * admission already reads at eight weeks and above -- an athlete already
 * running at their pathway's own destination projects to an identical
 * verdict at six, seven and eight weeks, because the projection is priced
 * from what they demonstrate rather than manufactured by the runway; a
 * novice with no evidence projects INSUFFICIENT at all three, for the same
 * reason it would at eight.
 *
 * So SHORT_RACE_GOAL_EVIDENCE_FLOOR_WEEKS opens six and seven weeks to the
 * same INSUFFICIENT/MARGINAL boundary admission already applies at eight
 * weeks and above -- read on a confident (priced) projection only, since a
 * six-week window has no room to recover from an unpriced guess the way an
 * eight-to-twelve-week one does. Five weeks and below, and every unconfident
 * or genuinely insufficient case at six-seven, keep the unconditional
 * calendar refusal. Half and Marathon are untouched: this floor is read only
 * where raceGoalRunwayBounds() has already resolved to 5K/10K's own window.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const TODAY = '2026-09-02T09:00:00Z';
function app(){
  const a = loadApp({ pinnedDate: TODAY });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  return a;
}
/* A STRONG athlete already running at (or past) their Advanced pathway's own
   destination volume and long run -- the athlete HQ asked about, "seven
   weeks before a 5K/10K" and already well prepared. */
function withStrongHistory(a, o){
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t)), s = [];
  for (let w = 1; w <= 20; w++){
    o.easyDays.forEach(d => s.push({ date: a.addDays(m, -7 * w + d), completed: true,
      actualKm: o.easyKm, plannedKm: o.easyKm, type: 'easy',
      actual: { km: o.easyKm, rpe: 3, pace: o.paceSec, hr: 135 }, feel: 'good' }));
    s.push({ date: a.addDays(m, -7 * w + 6), completed: true, actualKm: o.longKm,
      plannedKm: o.longKm, type: 'long', actual: { km: o.longKm, rpe: 5, pace: o.paceSec + 20, hr: 140 }, feel: 'good' });
    s.push({ date: a.addDays(m, -7 * w + 3), completed: true, actualKm: o.qKm,
      plannedKm: o.qKm, type: 'tempo', actual: { km: o.qKm, rpe: 7, pace: o.paceSec - 90, hr: 168 }, feel: 'good' });
  }
  a.state.athlete = { sessions: s };
}
const STRONG5K  = { easyKm: 9,  longKm: 16, qKm: 9,  easyDays: [0, 2, 4, 5], paceSec: 300 };
const STRONG10K = { easyKm: 10, longKm: 18, qKm: 10, easyDays: [0, 2, 4, 5], paceSec: 300 };

/* ---------- 1. A STRONG, DEMONSTRATED ATHLETE IS ADMITTED AT SEVEN AND SIX WEEKS ---------- */

test('5K: a strong demonstrated athlete is admitted at seven weeks, was refused before this fix', () => {
  const a = app();
  withStrongHistory(a, STRONG5K);
  a.state.experience = 'advanced';
  const adm = a.raceGoalAdmission('5k', 7, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  assert.equal(adm.admitted, true);
  assert.equal(adm.decision, 'race_goal_short_runway');
  assert.equal(adm.raceGoalWeeks, 7);
  assert.ok(adm.preparation && adm.preparation.confident);
  assert.notEqual(adm.preparation.verdict, 'INSUFFICIENT');
});

test('5K: the same strong athlete is admitted at six weeks', () => {
  const a = app();
  withStrongHistory(a, STRONG5K);
  a.state.experience = 'advanced';
  const adm = a.raceGoalAdmission('5k', 6, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  assert.equal(adm.admitted, true);
  assert.equal(adm.raceGoalWeeks, 6);
});

test('10K: a strong demonstrated athlete is admitted at seven and six weeks', () => {
  const a = app();
  withStrongHistory(a, STRONG10K);
  a.state.experience = 'advanced';
  const adm7 = a.raceGoalAdmission('10k', 7, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  const adm6 = a.raceGoalAdmission('10k', 6, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  assert.equal(adm7.admitted, true);
  assert.equal(adm6.admitted, true);
});

/* ---------- 2. THE SAME PROJECTION ADMISSION READS AT EIGHT WEEKS ---------- */

test('the short-runway verdict at seven weeks matches what the SAME athlete projects at eight (priced from evidence, not manufactured by the runway)', () => {
  const a = app();
  withStrongHistory(a, STRONG5K);
  a.state.experience = 'advanced';
  const adm7 = a.raceGoalAdmission('5k', 7, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  const adm8 = a.raceGoalAdmission('5k', 8, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  assert.equal(adm7.admitted, true);
  assert.equal(adm8.admitted, true);
  assert.equal(adm7.preparation.verdict, adm8.preparation.verdict);
  assert.equal(adm7.preparation.dimensions[0].reachedKm, adm8.preparation.dimensions[0].reachedKm);
});

/* ---------- 3. A WEAK ATHLETE STAYS REFUSED AT THE SAME RUNWAYS ---------- */

test('5K: a novice with no evidence is admitted and developed toward the floor at seven weeks', () => {
  /* HQ RACE GOAL SAFETY-FLOOR OVERRIDE -- "the floor needs to be the main
     driver." This athlete has no logged evidence, so entry stands at the
     pathway's own designed entry (entrySource stays 'pathway', unchanged);
     what used to refuse them was that a rate-limited projection could not
     close the gap from that entry to the pathway's destination inside
     seven weeks. raceGoalFloorAtStep()/raceGoalPreparationOutlook() now
     read the same Nielsen-rate curve buildBlockWeeks() actually builds: a
     5km entry to an 8km floor over three intervals reaches 7.4km (5 x
     1.14^3), close enough that the durability dimension's own tolerance
     still calls it met, so there is no shortfall left to refuse on -- but
     it is the curve's honest reach, not a value force-raised to the floor. */
  const a = app();
  a.state.experience = 'novice';
  const adm = a.raceGoalAdmission('5k', 7, null, { availableDays: 4, easyPaceSecPerKm: 330 });
  assert.equal(adm.admitted, true, 'decision: ' + adm.decision);
  assert.equal(adm.decision, 'race_goal_short_runway');
  assert.equal(adm.preparation.entrySource, 'pathway');
  assert.ok(adm.preparation && adm.preparation.confident);
  assert.equal(adm.preparation.verdict, 'READY');
  assert.equal(adm.preparation.reachWeekKm, adm.preparation.requiredWeekKm);
  assert.equal(adm.preparation.reachLongKm, 7.4,
    'the Nielsen-rate curve\'s own reach from a 5km entry in three steps');
  assert.ok(adm.preparation.dimensions.find(d => d.key === 'durability').met,
    'within tolerance of the floor even though not force-raised to it exactly');
});

test('5K and 10K: the same novice is admitted at six weeks too, honestly short of the floor', () => {
  /* Same HQ ruling, at the SHORT_RACE_GOAL_EVIDENCE_FLOOR_WEEKS boundary
     itself -- six weeks is where a priced, confident projection is still
     asked to admit at all (below it the ordinary too_short refusal still
     applies unconditionally; see the five-week test below). At six weeks
     there are only two development intervals, and the Nielsen safety rate
     cannot close a 5km/6km entry long run to an 8km/10km floor in two
     steps without a late jump this architecture will not make -- the same
     boundary the marathon reachability tests hold. So the athlete is still
     admitted (workload reaches the floor exactly; only durability is
     short), and MARGINAL is the honest verdict for it rather than a
     promised READY the block could not keep. */
  const a = app();
  a.state.experience = 'novice';
  const adm5k = a.raceGoalAdmission('5k', 6, null, { availableDays: 4, easyPaceSecPerKm: 330 });
  const adm10k = a.raceGoalAdmission('10k', 6, null, { availableDays: 4, easyPaceSecPerKm: 330 });
  assert.equal(adm5k.admitted, true, '5k decision: ' + adm5k.decision);
  assert.equal(adm10k.admitted, true, '10k decision: ' + adm10k.decision);
  assert.equal(adm5k.preparation.verdict, 'MARGINAL');
  assert.equal(adm10k.preparation.verdict, 'MARGINAL');
  assert.equal(adm5k.preparation.shortfall.length, 1);
  assert.equal(adm5k.preparation.shortfall[0], 'durability');
  assert.equal(adm10k.preparation.shortfall.length, 1);
  assert.equal(adm10k.preparation.shortfall[0], 'durability');
});

/* ---------- 4. FIVE WEEKS AND BELOW STAYS AN UNCONDITIONAL REFUSAL, EVEN FOR THE STRONG ATHLETE ---------- */

test('even the strong athlete is refused below the evidence floor, at five weeks', () => {
  const a = app();
  withStrongHistory(a, STRONG5K);
  a.state.experience = 'advanced';
  const adm = a.raceGoalAdmission('5k', 5, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  assert.equal(adm.admitted, false);
  assert.equal(adm.decision, 'too_short');
  assert.equal(adm.reason, 'runway_below_race_goal_minimum');
});

/* ---------- 5. AN UNPRICED PROJECTION DOES NOT ADMIT BELOW THE STRUCTURAL FLOOR ---------- */

test('with no pace benchmark at all, a below-floor runway falls back to the ordinary refusal rather than guessing', () => {
  const a = app();
  a.state.experience = 'advanced';
  const adm = a.raceGoalAdmission('5k', 7, null, { availableDays: 6 });
  assert.equal(adm.admitted, false);
  assert.equal(adm.decision, 'too_short');
});

/* ---------- 6. HALF AND MARATHON ARE COMPLETELY UNTOUCHED ---------- */

test('Half Marathon: the ten-week floor still refuses unconditionally at nine weeks, even for a strong athlete', () => {
  const a = app();
  withStrongHistory(a, { easyKm: 12, longKm: 20, qKm: 8, easyDays: [0, 1, 2, 3, 4], paceSec: 300 });
  a.state.experience = 'advanced';
  const adm = a.raceGoalAdmission('half', 9, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  assert.equal(adm.admitted, false);
  assert.equal(adm.decision, 'too_short');
  assert.equal(adm.reason, 'runway_below_race_goal_minimum');
});

test('Marathon: the ten-week floor still refuses unconditionally at nine weeks, even for a strong athlete', () => {
  const a = app();
  withStrongHistory(a, { easyKm: 12, longKm: 24, qKm: 8, easyDays: [0, 1, 2, 3, 4], paceSec: 300 });
  a.state.experience = 'advanced';
  const adm = a.raceGoalAdmission('full', 9, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  assert.equal(adm.admitted, false);
  assert.equal(adm.decision, 'too_short');
  assert.equal(adm.reason, 'runway_below_race_goal_minimum');
});

/* ---------- 7. THE ADMITTED SHORT RUNWAY BUILDS A COHERENT PROGRAMME, NOT A DEGENERATE ONE ---------- */

test('the admitted seven-week 5K programme holds a real Peak and taper, not a compressed stub', () => {
  const a = app();
  withStrongHistory(a, STRONG5K);
  a.state.experience = 'advanced';
  const adm = a.raceGoalAdmission('5k', 7, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  assert.equal(adm.admitted, true);
  const blk = a.buildBlockWeeks('5k', null, adm.raceGoalWeeks,
    { purpose: 'race', availableDays: 6, experience: 'advanced', easyPaceSecPerKm: 300 });
  const peakWeeks = blk.weeks.filter(w => w.phase === 'Peak');
  const taperWeeks = blk.weeks.filter(w => w.isTaper);
  assert.equal(peakWeeks.length, 2, 'Peak keeps its full two weeks even on the compressed runway');
  assert.ok(taperWeeks.length >= 1, 'a real taper week still precedes the race');
  peakWeeks.forEach(w => {
    assert.ok(w.qKm > 0 || w.tKm > 0, 'every Peak week still carries real quality work');
    assert.ok(w.longTarget > 0, 'every Peak week still carries a real long run');
  });
  const rd = a.raceGoalReadiness('5k', 'advanced', blk);
  assert.ok(rd);
  assert.notEqual(rd.verdict, 'INSUFFICIENT');
});

test('the admitted six-week 5K programme holds a real Peak and taper, not a compressed stub', () => {
  const a = app();
  withStrongHistory(a, STRONG5K);
  a.state.experience = 'advanced';
  const adm = a.raceGoalAdmission('5k', 6, null, { availableDays: 6, easyPaceSecPerKm: 300 });
  assert.equal(adm.admitted, true);
  const blk = a.buildBlockWeeks('5k', null, adm.raceGoalWeeks,
    { purpose: 'race', availableDays: 6, experience: 'advanced', easyPaceSecPerKm: 300 });
  const peakWeeks = blk.weeks.filter(w => w.phase === 'Peak');
  const taperWeeks = blk.weeks.filter(w => w.isTaper);
  assert.equal(peakWeeks.length, 2);
  assert.ok(taperWeeks.length >= 1);
});
