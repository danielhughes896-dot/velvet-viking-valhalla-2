'use strict';
/* THE REACHABILITY GATE, AS A TEST.
 * ===========================================================================
 * A pathway that routinely misses its own destination and leaves readiness to
 * report the miss has failed, however honest the report is. Readiness is for a
 * genuine athlete or runway shortfall; it is not a substitute for a programme
 * architecture that can get there.
 *
 * The instrument is test/audit/raceGoalReachability.js -- the same canonical
 * athletes, the same measurement -- so the report HQ reads and the gate the
 * suite holds cannot drift apart. What is asserted here is the gate itself:
 *
 *   THE DESTINATION IS REACHED    weekly volume and long run both at or above
 *                                 the pathway's own requirement.
 *   BEFORE THE TAPER              a taper deliberately reduces load, so a
 *                                 capability first seen inside one was never
 *                                 established.
 *   MORE THAN ONCE                a long run met once and never approached
 *                                 again is a spike, not a capability. The
 *                                 architecture's own second-exposure fraction
 *                                 is the bar, plus the kilometre a long run
 *                                 rounds to.
 *   WITH NO OPTIONAL RUNS IN PEAK an Optional Run is a week that has not
 *                                 decided what it is asking for, and Peak has.
 *   AND THE MINIMUMS ARE NOT      an athlete who arrives above the pathway
 *   CEILINGS                      trains above it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const R = require(path.join(__dirname, 'audit', 'raceGoalReachability.js'));

const r1 = x => Math.round(x * 10) / 10;

R.CANON.forEach(c => {
  test('REACHABILITY — ' + c.key + ' reaches its own destination before the taper', () => {
    const res = R.build(Object.assign(
      { dist: c.dist, exp: c.exp, days: c.days, weeks: c.weeks }, c.ev));
    const p = R.established(res, null);
    const needKm   = Math.max(c.needBuildKm   || 0, c.needPeakKm   || 0);
    const needLong = Math.max(c.needBuildLong || 0, c.needPeakLong || 0);

    assert.ok(p.peakKm >= needKm - 0.05,
      c.key + ' established ' + r1(p.peakKm) + 'km/week against a requirement of ' + needKm);
    assert.ok(p.peakLong >= needLong - 0.05,
      c.key + ' established a ' + r1(p.peakLong) + 'km long run against a requirement of ' +
      needLong);
    assert.ok(p.secondOk,
      c.key + ' met its long run once, at ' + r1(p.peakLong) + 'km in week ' + p.peakLongWk +
      ', and never came within the second-exposure fraction of it again (best other: ' +
      r1(p.second) + 'km)');
    assert.equal(p.optInPeak, 0,
      c.key + ' carries ' + p.optInPeak + ' Optional Runs in Peak');

    /* AND IT IS ESTABLISHED, NOT ARRIVED AT IN THE LAST WEEK. The week the
       capability first appears has to be a week the athlete then trains
       through, which is what "established" means -- and it is the whole
       difference between a programme that prepared somebody and one that
       reached a number on its way out. */
    const lastDev = res.blk.weeks.filter(w => !w.isRace && !w.isTaper &&
                                              !w.eventTaperApplied).slice(-1)[0];
    assert.ok(p.peakLongWk <= lastDev.week,
      c.key + ' first met its long run in week ' + p.peakLongWk +
      ', after the last developing week (' + lastDev.week + ')');
  });
});

test('REACHABILITY — readiness agrees that the destination was reached', () => {
  /* THE OTHER HALF OF THE GATE. Readiness detecting an architecturally caused
     miss does not convert that miss into a pass -- and readiness reporting
     READY while the pathway misses is worse, because it hides one. For the
     canonical athlete, who is exactly right for their pathway, the two have to
     agree. */
  R.CANON.forEach(c => {
    const res = R.build(Object.assign(
      { dist: c.dist, exp: c.exp, days: c.days, weeks: c.weeks }, c.ev));
    const rd = res.a.raceGoalReadiness(c.dist, c.exp, res.blk);
    assert.equal(rd.verdict, 'READY',
      c.key + ' reaches its destination but readiness says ' + rd.verdict);
  });
});

R.HIGH.forEach(c => {
  test('REACHABILITY — ' + c.key + ': a pathway minimum is not a ceiling', () => {
    const res = R.build(Object.assign(
      { dist: c.dist, exp: c.exp, days: c.days, weeks: c.weeks }, c.ev));
    const p = R.established(res, null);
    assert.ok(p.peakKm > c.floorKm + 0.05,
      c.key + ' was held to ' + r1(p.peakKm) + 'km against a pathway minimum of ' + c.floorKm);
  });
});

test('REACHABILITY — every pathway states an entry its own destination can reach', () => {
  /* THE ARITHMETIC THE PATHWAY TABLE HAS TO SATISFY, asserted directly rather
     than discovered by a canonical athlete missing. A block hands out a fixed
     number of development steps and a session may grow by at most the ordinary
     rate at each of them, so entry x rate^steps is the furthest any long run on
     that pathway can travel. A destination beyond it is unreachable BY
     CONSTRUCTION -- which is how the novice marathon came to ask for 26km from
     an entry of 8. */
  const a = R.build({ dist: 'half', exp: 'novice', days: 5, weeks: 15,
                      easyKm: 5, longKm: 8, easyDays: [0, 2], tt5kMin: 28 }).a;
  ['half', 'full'].forEach(dist => {
    ['novice', 'experienced', 'advanced'].forEach(exp => {
      const p = a.RACE_GOAL_PATHWAY[dist][exp];
      const steps = a.raceGoalStepCount(dist, 15, exp);
      const reach = p.entryLongKm * Math.pow(a.sessionProgressionRate(), steps);
      assert.ok(reach >= p.peakLongKm - 1e-9,
        dist + '/' + exp + ': ' + p.entryLongKm + 'km reaches ' +
        Math.round(reach * 10) / 10 + ' in ' + steps + ' steps, against a ' +
        p.peakLongKm + 'km destination');
      /* AND THE ENTRY WEEK HAS TO BE ABLE TO CONTAIN THE ENTRY LONG RUN, at
         the pathway's own coherence rule: the long run, one quality slot and at
         least one supporting run, none of the latter below SUPPORT_SHARE_MIN of
         the long run. Below that the block opens with supporting runs too small
         to support what they are under, and they cannot reach the size the
         destination needs -- which is how a 22km novice marathon week with a
         13km long run made its own 26km destination unreachable.

         THE DAY COUNT IS NOT ASSERTED HERE, and the difference is worth
         stating: entryDays says how often this athlete runs, and where their
         entry week cannot write that many runs at coherent sizes the block
         opens on fewer and develops the rest back as capacity earns them. The
         experienced marathon pathway is the one that does this -- 45km with an
         18km long run writes four days rather than five -- and that is the
         frequency development doing its job, not an incoherent pathway. */
      const minWeek = p.entryLongKm * (1 + 2 * a.SUPPORT_SHARE_MIN);
      assert.ok(p.entryVolumeKm >= minWeek - 1e-9,
        dist + '/' + exp + ': an entry week of ' + p.entryVolumeKm +
        'km cannot coherently contain a ' + p.entryLongKm + 'km long run (needs ' +
        Math.round(minWeek * 10) / 10 + ')');
    });
  });
});

test('LONG RUNWAY — a half hands its surplus off rather than growing a Base', () => {
  /* THE HALF HAD THE MARATHON'S RUNWAY PROBLEM AND NOT ITS ANSWER. Its
     dedicated window is fifteen weeks and its destination stops moving there,
     so an athlete twenty-four weeks out was given a twenty-four week half block
     -- which the half's own allocation shapes as a TWELVE WEEK BASE followed by
     six of Build and four of Peak. A twelve-week Base inside a race block is a
     development block wearing a race block's name.

     One to three surplus weeks still go to Base, because a development block
     shorter than four weeks cannot express its own arc; beyond that the surplus
     becomes a real block with its own methodology. */
  const path = require('path');
  const { loadApp } = require(path.join(__dirname, 'harness.js'));
  const a = loadApp({ pinnedDate: '2026-03-02T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {}; a.state = a.makeDefaultState();

  assert.equal(a.marathonRunwayPlan(15, 40, 'half').reason, 'exact_window');
  [16, 17, 18].forEach(W => assert.equal(
    a.marathonRunwayPlan(W, 40, 'half').reason, 'surplus_absorbed_into_base',
    W + ' surplus weeks should go to Base'));
  [20, 24, 30].forEach(W => {
    const rp = a.marathonRunwayPlan(W, 40, 'half');
    assert.equal(rp.raceWeeks, a.HALF_DEDICATED_WEEKS,
      W + ' weeks out still built a ' + rp.raceWeeks + '-week half block');
    assert.ok(rp.preparatory && rp.preparatory.weeks >= 4,
      W + ' weeks out did not hand its surplus to a real development block');
  });
  /* AND THE BLOCK IT WOULD OTHERWISE HAVE BUILT IS THE EVIDENCE. */
  const wide = a.raceGoalPhaseAllocation('half', 24, 'experienced');
  assert.ok(wide.base >= 4 * wide.build / 6,
    'the 24-week allocation no longer inflates Base, so this test protects nothing');

  /* THE MARATHON IS UNCHANGED, byte for byte, at its own default. */
  assert.equal(JSON.stringify(a.marathonRunwayPlan(24, 40)),
               JSON.stringify(a.marathonRunwayPlan(24, 40, 'full')));
});
