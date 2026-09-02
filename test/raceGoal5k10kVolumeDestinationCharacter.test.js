'use strict';
/* HQ PRE-MERGE GATE, QUESTION 1 -- WHAT `buildVolumeKm` MEANS AT EACH TIER.
 * ===========================================================================
 * SUPERSEDED BY THE FREQUENCY-ARCHITECTURE CORRECTION, RECORDED HERE RATHER
 * THAN SILENTLY REWRITTEN. HQ's original pre-merge traces (day count matched
 * to entryDays) landed every one of the six 5K/10K pathways below its
 * approved buildVolumeKm. The first pass through this question found Advanced
 * reachable at a realistic day count and Novice/Experienced genuinely not --
 * traced to marathonSupportDestination()'s SUPPORT_SHARE_MAX clamp for
 * Advanced's own headroom, and to raceGoalDestinationSolve()'s day-count seed
 * (mNeed) refusing to grant Novice/Experienced more support days than a fixed
 * comfort divisor computed, regardless of how many days were actually on
 * offer, for the rest.
 *
 * THE SECOND HALF OF THAT DIAGNOSIS WAS THE FREQUENCY DEFECT ITSELF, and HQ's
 * later Race Goal Frequency Architecture workstream repaired it: mNeed is now
 * a floor rather than a cap, and an additional support day is granted, up to
 * real availability, whenever doing so keeps each session at or above the
 * SAME coherence floor (SUPPORT_SHARE_MIN x longDestKm) the architecture
 * already used downstream. That repair was scoped to frequency, not to this
 * question's own methodology, but it changes this question's own answer as a
 * direct, provable consequence: at a realistic day count, all six pathways
 * now reach their own approved destination. SUPPORT_SHARE_MAX was not
 * touched, and does not need to be -- for the pathways it used to bind
 * (Novice/Experienced), more, smaller support days simply keep every session
 * comfortably under its ceiling instead.
 *
 * This is the locked proof of the CORRECTED finding: it holds today and will
 * fail loudly if the frequency repair regresses and reopens the shortfall
 * this file used to document.
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
  test(`${dist} ${exp}: evidence-free 12-week peak volume reaches its own buildVolumeKm(${destVol}) at ${days} days, post frequency repair`, () => {
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

    /* THE DESTINATION IS NOW REACHED AT EVERY TIER, at a realistic day
       count -- the frequency repair's effect on this question, proven
       directly rather than asserted. A day count matched to entryDays alone
       still will not reach it (nothing about entryDays changed here); this
       is deliberately tested at the day count BUILDER_SPEC actually permits,
       which is the same standard the original pre-merge gate used to prove
       Advanced's own reachability. */
    assert.ok(peakVol + 0.5 >= destVol,
      `${exp} ${dist} is expected to reach its destination post-repair: peak=${peakVol} dest=${destVol}`);
    assert.equal(workload.met, true);
    assert.equal(workload.shortfallKm, 0);
    assert.equal(rd.verdict, 'READY');
  });
});
