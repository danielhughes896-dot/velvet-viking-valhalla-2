'use strict';
/* HQ PRE-MERGE GATE, QUESTION 1 -- WHAT `buildVolumeKm` MEANS AT EACH TIER.
 * ===========================================================================
 * HQ's canonical evidence-free traces (day count matched to entryDays) landed
 * every one of the six 5K/10K pathways below its approved buildVolumeKm, and
 * asked whether that is a construction defect or the destination's real
 * character. Traced to marathonSupportDestination()'s SUPPORT_SHARE_MAX
 * coherence clamp (out of this correction's mandate -- raising it would make
 * a supporting run bigger than the week's own long run) and the day-count
 * math in raceGoalDestinationSolve() (frequency architecture, also out of
 * mandate): Advanced reaches its destination exactly once given a realistic
 * day count (up to BUILDER_SPEC's own six, not clamped to entryDays); Novice
 * and Experienced do not, at any permitted day count, and readiness reports
 * the shortfall rather than hiding it.
 *
 * This is the locked proof of that finding: it holds today (no code changed
 * for Question 1) and will fail loudly if either half of the split -- the
 * Advanced tier's reachability, or Novice/Experienced's honestly-reported
 * shortfall -- regresses in a later change.
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

/* days: the realistic day count a serious short-runway athlete would select
   (up to BUILDER_SPEC's own six), NOT clamped to the pathway's entryDays --
   the point of this gate is to ask whether the destination is reachable at
   all, not whether it is reachable on the fewest days an entrant happens to
   start on. */
const CASES = [
  { dist:'5k',  exp:'novice',      days:5, destVol:30 },
  { dist:'5k',  exp:'experienced', days:6, destVol:50 },
  { dist:'5k',  exp:'advanced',    days:6, destVol:70 },
  { dist:'10k', exp:'novice',      days:5, destVol:30 },
  { dist:'10k', exp:'experienced', days:6, destVol:60 },
  { dist:'10k', exp:'advanced',    days:6, destVol:75 },
];

CASES.forEach(({ dist, exp, days, destVol }) => {
  test(`${dist} ${exp}: evidence-free 12-week peak volume against its own buildVolumeKm(${destVol}) at ${days} days`, () => {
    const a = app();
    a.state.experience = exp;
    const blk = a.buildBlockWeeks(dist, null, 12,
      { purpose:'race', availableDays:days, experience:exp, easyPaceSecPerKm:330 });
    const preTaper = blk.weeks.filter(w => !w.isRace && !w.isTaper);
    const peakVol = Math.max(...preTaper.map(w => w.volume || 0));
    const rd = a.raceGoalReadiness(dist, exp, blk);
    assert.ok(rd, 'readiness must be computable for a canonical build');
    const workload = rd.dimensions.find(d => d.key === 'workload');
    assert.ok(workload, 'the workload dimension must be present');

    if (exp === 'advanced'){
      /* THE DESTINATION IS REACHED. Both Advanced pathways land on their
         approved buildVolumeKm exactly (within half a printed kilometre)
         once given a realistic day count -- confirming the pathway table's
         figure is a genuine destination here, not a decorative ceiling. */
      assert.ok(Math.abs(peakVol - destVol) <= 0.5,
        `Advanced ${dist} must reach its destination: peak=${peakVol} dest=${destVol}`);
      assert.notEqual(rd.verdict, 'INSUFFICIENT');
    } else {
      /* THE DESTINATION IS NOT REACHED, AND READINESS SAYS SO. Novice and
         Experienced fall genuinely short at any permitted day count -- this
         is the honestly-reported gap, not a hidden one, so the workload
         dimension must be unmet with the exact shortfall attached. */
      assert.ok(peakVol < destVol - 0.5,
        `${exp} ${dist} is expected to still fall short at a realistic day count (this is the documented finding, not a bug)`);
      assert.equal(workload.met, false);
      assert.ok(workload.shortfallKm > 0);
      assert.notEqual(rd.verdict, 'READY');
    }
  });
});
