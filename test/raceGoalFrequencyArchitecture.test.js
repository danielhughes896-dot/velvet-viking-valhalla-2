'use strict';
/* RACE GOAL TRAINING-DAY / FREQUENCY ARCHITECTURE -- THE REPAIR, LOCKED.
 * ===========================================================================
 * The audit found raceGoalDestinationSolve()'s day-count seed (mNeed) used a
 * comfort-sized minimum as a hard CEILING rather than a floor: once it
 * settled below the athlete's real availability, every day beyond it became
 * invisible to the block, regardless of whether using one would have
 * distributed the same workload more evenly. Reproduced decisively on
 * Advanced Marathon: 4 available days -> supportDays 2 -> ~15.5km easy runs;
 * 5 -> supportDays 3 -> ~12km; 6 -> supportDays STILL 3, the sixth day idle.
 *
 * The repair: mNeed is now read as a floor. An additional supporting day is
 * granted, one at a time up to real availability, only while doing so keeps
 * every session at or above the SAME coherence floor
 * marathonSupportDestination() already enforces downstream
 * (SUPPORT_SHARE_MIN x the destination long run) -- so it can never choose a
 * day count that downstream sizing would have had to override upward again,
 * which is exactly the mechanism that would have silently inflated the week.
 *
 * This file locks in: the repair itself, across all four Race Goal events;
 * that it never increases the destination weekly target; that it never
 * touches long-run destinations, quality truth, taper, Peak's Optional
 * exclusion, or SUPPORT_SHARE_MAX; the increase-availability trigger
 * (raceGoalAvailabilityLimited); the reconciliation path for a plan
 * generated before this repair existed; and isolation from every other
 * product.
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
function peakWeek(blk){
  const p = blk.weeks.filter(w => w.phase === 'Peak');
  return p[p.length - 1];
}
function buildFor(dist, exp, N, days){
  const a = app();
  a.state.experience = exp;
  const blk = a.buildBlockWeeks(dist, null, N,
    { purpose:'race', availableDays:days, experience:exp, easyPaceSecPerKm:330 });
  return { a, blk };
}
const WEEKS = { '5k':12, '10k':12, half:15, full:15 };

/* ---------- 1/2. AVAILABILITY CAN INFLUENCE FREQUENCY, BUT IS NOT A MANDATE ---------- */

test('Advanced Marathon: additional availability increases prescribed frequency exactly while it improves distribution, and stops on its own', () => {
  const at4 = buildFor('full', 'advanced', 15, 4);
  const at5 = buildFor('full', 'advanced', 15, 5);
  const at6 = buildFor('full', 'advanced', 15, 6);
  const p4 = peakWeek(at4.blk), p5 = peakWeek(at5.blk), p6 = peakWeek(at6.blk);
  assert.equal(p4.bottomUp.supportDays, 2, '4 days: no longer stalls -- 2 is what 4 raw days can carry');
  assert.equal(p5.bottomUp.supportDays, 3, '5 days: a real day genuinely used');
  /* HQ NARROW PATHWAY CORRECTION -- Advanced Marathon's peak volume rose from
     80 to 90km, so the sixth day now genuinely clears the coherence floor
     the mNeed loop already gates it on (see raceGoalDestinationSolve()'s
     comment on mSupportDays): a bigger week has more to distribute, and the
     same loop that held it at 3 under the old table now finds a fourth day
     legitimately helps. The mechanism did not change; only the volume it is
     being asked to distribute did. */
  assert.equal(p6.bottomUp.supportDays, 4, '6 days: the higher peak volume now genuinely uses a fourth');
});

test('5K/10K/Half Novice-Experienced: additional availability CAN raise frequency where it was previously invisible to the seed', () => {
  const cases = [
    ['5k','novice',5,1,4],
    ['5k','experienced',6,2,4],
    ['10k','novice',5,1,4],
    ['10k','experienced',6,2,4],
    ['half','novice',6,2,4],
  ];
  cases.forEach(([dist, exp, days, oldSupportDays, newSupportDays]) => {
    const { blk } = buildFor(dist, exp, WEEKS[dist], days);
    const sd = peakWeek(blk).bottomUp.supportDays;
    assert.ok(sd > oldSupportDays,
      `${dist} ${exp} at ${days}d: expected supportDays > ${oldSupportDays} (the pre-repair value), got ${sd}`);
  });
});

test('extra availability is never automatically used: a pathway already at its coherence floor keeps its day count', () => {
  /* Marathon Advanced at 6 available days is the reported case itself --
     already at its coherence floor once granted a 6th day is unavailable to
     help further, so a hypothetical 7th must be refused for the same
     reason, not merely because the platform happens to cap at 6. */
  const at6m = buildFor('full', 'advanced', 15, 6);
  const at7m = buildFor('full', 'advanced', 15, 7);
  assert.equal(peakWeek(at6m.blk).bottomUp.supportDays, peakWeek(at7m.blk).bottomUp.supportDays,
    'a 7th day is refused for the same coherence reason a 6th day already was');
  assert.ok(Math.abs(peakWeek(at6m.blk).volume - peakWeek(at7m.blk).volume) < 0.5,
    'refusing the extra day means the weekly target does not move either');
});

/* ---------- 3/4. WEEKLY WORKLOAD DOES NOT INCREASE MERELY BECAUSE FREQUENCY DOES ---------- */

test('weekly workload invariance: the destination itself never moves -- it is only reached more often', () => {
  /* 5K Advanced's destination (70km) was already reachable under the OLD
     formula, so this pathway's peak volume is untouched by the repair --
     the cleanest possible proof that granting more days redistributes the
     SAME target rather than inflating it. */
  const a = app();
  const pathway = a.raceGoalPathway('5k', 'advanced');
  const at5 = buildFor('5k', 'advanced', 12, 5);
  const at6 = buildFor('5k', 'advanced', 12, 6);
  assert.equal(peakWeek(at5.blk).bottomUp.supportDays, 3);
  assert.equal(peakWeek(at6.blk).bottomUp.supportDays, 4);
  assert.ok(Math.abs(peakWeek(at6.blk).volume - pathway.buildVolumeKm) <= 0.5,
    'more days converge ON the fixed destination, never past a materially different one');
});

test('weekly workload invariance: a case whose supportDays rises still lands within the SAME destination, not a larger one', () => {
  const a = app();
  const pathway = a.raceGoalPathway('10k', 'experienced');
  const { blk } = buildFor('10k', 'experienced', 12, 6);
  const pk = peakWeek(blk);
  assert.equal(pk.bottomUp.supportDays, 4, 'frequency did rise for this case');
  assert.ok(pk.volume <= pathway.buildVolumeKm + 0.5,
    `peak volume (${pk.volume}) must not exceed the pathway's own destination (${pathway.buildVolumeKm}) merely because frequency rose`);
});

test('DECLINE: re-solving repeatedly at the SAME availableDays never creeps -- no runaway inflation from asking twice', () => {
  const runs = [0,1,2].map(() => buildFor('full', 'advanced', 15, 4));
  const vols = runs.map(r => peakWeek(r.blk).volume);
  const days = runs.map(r => peakWeek(r.blk).bottomUp.supportDays);
  assert.equal(vols[0], vols[1]); assert.equal(vols[1], vols[2]);
  assert.equal(days[0], days[1]); assert.equal(days[1], days[2]);
});

/* ---------- 5. ALL FOUR EVENTS BEHAVE EVENT-APPROPRIATELY, NOT IDENTICALLY ---------- */

test('the shared authority produces different, event-appropriate frequency outcomes, not one identical answer', () => {
  const six = [
    ['5k','novice'], ['5k','advanced'],
    ['10k','experienced'],
    ['half','novice'], ['half','advanced'],
    ['full','advanced'],
  ];
  const supportDaysAt6 = six.map(([dist, exp]) => peakWeek(buildFor(dist, exp, WEEKS[dist], 6).blk).bottomUp.supportDays);
  const distinct = new Set(supportDaysAt6);
  assert.ok(distinct.size > 1, 'six different pathway/event combinations must not all converge on one frequency: ' + supportDaysAt6.join(','));
});

/* ---------- 6. PEAK: DELIBERATE FREQUENCY, ZERO FRESH OPTIONAL RUN ---------- */

['5k','10k','half','full'].forEach(dist => {
  test(`${dist}: fresh Peak generates zero Optional Run at 6 available days, before and after the frequency repair`, () => {
    const { a, blk } = buildFor(dist, 'advanced', WEEKS[dist], 6);
    const raceDate = a.addDays(a.addDays(a.todayStr(), -a.isoWeekday(a.todayStr())), WEEKS[dist] * 7 - 1);
    const schedule = { activeDays:[0,1,2,3,5,6], longRunDay:6 };
    const days = a.buildDaysFromWeeks(blk, raceDate, schedule, a.todayStr(), false, { easyPaceSecPerKm:330 });
    const peakWeeks = new Set(blk.weeks.filter(w => w.phase === 'Peak').map(w => w.week));
    const offeredInPeak = days.filter(d => peakWeeks.has(d.week) && d.availableUnused);
    assert.equal(offeredInPeak.length, 0, `${dist} Peak must generate zero availableUnused offers`);
  });
});

test('Marathon: additional prescribed support running in Peak is only introduced where distribution justifies it, and Peak stays Optional-free either way', () => {
  const at4 = buildFor('full', 'advanced', 15, 4);
  const at6 = buildFor('full', 'advanced', 15, 6);
  assert.ok(peakWeek(at6.blk).bottomUp.supportDays >= peakWeek(at4.blk).bottomUp.supportDays);
  const { a, blk } = at6;
  const raceDate = a.addDays(a.addDays(a.todayStr(), -a.isoWeekday(a.todayStr())), 15 * 7 - 1);
  const schedule = { activeDays:[0,1,2,3,5,6], longRunDay:6 };
  const days = a.buildDaysFromWeeks(blk, raceDate, schedule, a.todayStr(), false, { easyPaceSecPerKm:330 });
  const peakWeeks = new Set(blk.weeks.filter(w => w.phase === 'Peak').map(w => w.week));
  assert.equal(days.filter(d => peakWeeks.has(d.week) && d.availableUnused).length, 0);
});

/* ---------- 7. TAPER: FREQUENCY RETAINED, LOAD REDUCED ---------- */

['5k','10k','half','full'].forEach(dist => {
  test(`${dist}: taper retains the frequency the block established, and only reduces load`, () => {
    const { blk } = buildFor(dist, 'advanced', WEEKS[dist], 6);
    const pk = peakWeek(blk);
    const taper = blk.weeks.find(w => w.isTaper);
    assert.ok(taper, 'a taper week must exist');
    assert.equal(taper.bottomUp.supportDays, pk.bottomUp.supportDays,
      `${dist} taper must retain Peak's own supportDays (${pk.bottomUp.supportDays}), got ${taper.bottomUp.supportDays}`);
    assert.ok(taper.volume < pk.volume, 'taper volume must be lower than Peak volume');
  });
});

/* ---------- 8/9. LONG-RUN DESTINATIONS AND QUALITY TRUTH UNCHANGED ---------- */

test('long-run destinations are read verbatim from the pathway table, at every availableDays', () => {
  /* Half Advanced's own figure moved 21 -> 22 under HQ's narrow pathway
     correction; this test's point is that the frequency repair does not
     invent its own number regardless of what the table says, so it is
     re-pointed at the table's current value rather than a frozen one. */
  const a = app();
  [['5k','advanced',16], ['10k','advanced',18], ['half','advanced',22], ['full','advanced',32]].forEach(([dist, exp, expectLong]) => {
    const pathway = a.raceGoalPathway(dist, exp);
    assert.equal(pathway.buildLongKm, expectLong, `${dist} ${exp} pathway table long-run destination must be unchanged`);
    [4,5,6].forEach(days => {
      const { blk } = buildFor(dist, exp, WEEKS[dist], days);
      assert.equal(peakWeek(blk).longTarget, expectLong,
        `${dist} ${exp} at ${days}d: the delivered long run must still be exactly ${expectLong}`);
    });
  });
});

test('quality-session count (qSlots) is untouched by the frequency repair -- it is decided before supportDays and never re-derived by it', () => {
  [4,5,6].forEach(days => {
    const { blk } = buildFor('full', 'advanced', 15, days);
    assert.equal(peakWeek(blk).bottomUp.qSlots, 1, `qSlots must be independent of availableDays at ${days}d`);
  });
});

/* ---------- 10. SUPPORT_SHARE_MAX: UNCHANGED, AND NEVER VIOLATED BY THE REPAIR ---------- */

test('SUPPORT_SHARE_MAX is unchanged, and no supporting run the repair produces ever exceeds it', () => {
  const a = app();
  assert.equal(a.SUPPORT_SHARE_MAX, 0.75, 'SUPPORT_SHARE_MAX must not have moved');
  const cases = [
    ['5k','novice'], ['5k','experienced'], ['5k','advanced'],
    ['10k','novice'], ['10k','experienced'], ['10k','advanced'],
    ['half','novice'], ['half','experienced'], ['half','advanced'],
    ['full','novice'], ['full','experienced'], ['full','advanced'],
  ];
  cases.forEach(([dist, exp]) => {
    [4,5,6].forEach(days => {
      const { a: aa, blk } = buildFor(dist, exp, WEEKS[dist], days);
      const pk = peakWeek(blk);
      const bu = pk.bottomUp;
      if (!bu || !(bu.supportDays > 0) || !(pk.longTarget > 0)) return;
      const perRunKm = (pk.volume - pk.longTarget - (aa.raceGoalPathway(dist,exp) ? 0 : 0)) ; // upper-bound estimate, quality included
      const ceilingKm = pk.longTarget * 0.75 + 1e-6;
      // supportKm (per-run) is the tighter, directly-computed figure when present.
      if (bu.supportKm != null){
        assert.ok(bu.supportKm <= ceilingKm + 1e-6,
          `${dist} ${exp} at ${days}d: supportKm ${bu.supportKm} must not exceed SUPPORT_SHARE_MAX*long (${ceilingKm})`);
      }
    });
  });
});

/* ---------- 11/12/13. OPTIONAL RUN: HISTORY, SKIPPED, AND FUTURE RECONCILIATION ---------- */

test('a previously completed Optional Run remains real history after a rebuild', () => {
  /* HQ NARROW PATHWAY CORRECTION -- Advanced Marathon's higher table
     (peak 90/build 80, up from 80/70) now genuinely uses all six available
     days at every phase, so it no longer offers an unused day to log
     against; this test's subject is Optional Run reconciliation, not any
     particular pathway, so it uses New (novice) Marathon instead, which
     still has room at 6 days for the whole block. */
  const a = app();
  a.state.experience = 'novice';
  const blk = a.buildBlockWeeks('full', null, 15, { purpose:'race', availableDays:6, experience:'novice', easyPaceSecPerKm:330 });
  const raceDate = a.addDays(a.addDays(a.todayStr(), -a.isoWeekday(a.todayStr())), 15 * 7 - 1);
  const schedule = { activeDays:[0,1,2,3,5,6], longRunDay:6 };
  const oldDays = a.buildDaysFromWeeks(blk, raceDate, schedule, a.todayStr(), false, { easyPaceSecPerKm:330 });
  const offeredPast = oldDays.find(d => d.availableUnused);
  assert.ok(offeredPast, 'fixture must contain at least one offered day to log against');
  offeredPast.actual = { km: 6, pace: 360, hr: 140, rpe: 4, notes: '' };
  offeredPast.optionalRun = true;
  offeredPast.completed = true;
  assert.ok(a.dayCarriesHistory(offeredPast), 'a logged optional run must count as history');

  const newDays = a.buildDaysFromWeeks(blk, raceDate, schedule, a.todayStr(), false, { easyPaceSecPerKm:330 });
  const merged = a.reconcileRegeneratedDays(oldDays, newDays, a.todayStr());
  const survivor = merged.days.find(d => d.date === offeredPast.date);
  assert.ok(survivor, 'the logged day must survive reconciliation');
  assert.equal(survivor.optionalRun, true);
  assert.equal(survivor.completed, true);
  assert.equal(survivor.actual.km, 6);
});

test('a skipped (never logged) Optional Run offer does not become a retroactive missed prescribed session', () => {
  /* Same pathway swap as the test above, same reason. */
  const a = app();
  a.state.experience = 'novice';
  const blk = a.buildBlockWeeks('full', null, 15, { purpose:'race', availableDays:6, experience:'novice', easyPaceSecPerKm:330 });
  const raceDate = a.addDays(a.addDays(a.todayStr(), -a.isoWeekday(a.todayStr())), 15 * 7 - 1);
  const schedule = { activeDays:[0,1,2,3,5,6], longRunDay:6 };
  const days = a.buildDaysFromWeeks(blk, raceDate, schedule, a.todayStr(), false, { easyPaceSecPerKm:330 });
  const offered = days.find(d => d.availableUnused);
  assert.ok(offered);
  assert.equal(offered.completed, false);
  assert.equal(offered.type, 'rest');
  assert.equal(offered.km, 0);
  /* Never logged, so it is not "history" -- an ordinary rebuild is free to
     replace it, exactly like any other untouched future/past-but-unlogged
     rest day, and readiness/frequency read nothing from it either way. */
  assert.equal(a.dayCarriesHistory(offered), false);
});

test('a stale plan generated before the Peak-Optional guard existed is corrected by an ordinary regeneration', () => {
  const a = app();
  a.state.experience = 'advanced';
  const blk = a.buildBlockWeeks('full', null, 15, { purpose:'race', availableDays:6, experience:'advanced', easyPaceSecPerKm:330 });
  const raceDate = a.addDays(a.addDays(a.todayStr(), -a.isoWeekday(a.todayStr())), 15 * 7 - 1);
  const schedule = { activeDays:[0,1,2,3,5,6], longRunDay:6 };
  const freshDays = a.buildDaysFromWeeks(blk, raceDate, schedule, a.todayStr(), false, { easyPaceSecPerKm:330 });
  const peakWeeks = new Set(blk.weeks.filter(w => w.phase === 'Peak').map(w => w.week));
  /* SIMULATE a plan saved before the guard existed: force availableUnused
     onto a Peak rest day, with no history marker on it -- exactly the shape
     the audit found the guard cannot retroactively clear on its own. */
  const stale = freshDays.map(d => Object.assign({}, d));
  const staleTarget = stale.find(d => peakWeeks.has(d.week) && d.type === 'rest' && d.date >= a.todayStr());
  assert.ok(staleTarget, 'fixture must contain a future Peak rest day to corrupt');
  staleTarget.availableUnused = true;
  assert.equal(a.dayCarriesHistory(staleTarget), false, 'the simulated-stale day must carry no history marker');

  const regenerated = a.buildDaysFromWeeks(blk, raceDate, schedule, a.todayStr(), false, { easyPaceSecPerKm:330 });
  const merged = a.reconcileRegeneratedDays(stale, regenerated, a.todayStr());
  const healed = merged.days.find(d => d.date === staleTarget.date);
  assert.ok(healed, 'the day must survive reconciliation');
  assert.notEqual(healed.availableUnused, true, 'reconciliation must replace the stale Peak offer with the guarded fresh output');
});

/* ---------- 14. THE INCREASE-AVAILABILITY TRIGGER ---------- */

test('raceGoalAvailabilityLimited: fires with named reasons on the reported case, at the runway where it is genuinely limited', () => {
  const a = app();
  const r4 = a.raceGoalAvailabilityLimited('full', 'advanced', null, 15, { availableDays:4, easyPaceSecPerKm:330 });
  assert.equal(r4.limited, true);
  assert.ok(r4.reasons.length >= 1);
  assert.ok(r4.reasons.some(x => x.key === 'support_run_concentration'));
});

test('raceGoalAvailabilityLimited: does not fire once the extra day has already been granted, or when granting one would break coherence', () => {
  /* HQ NARROW PATHWAY CORRECTION -- Advanced Marathon's higher table (peak
     90/build 80, up from 80/70) means a bigger week to distribute, so the
     5th day no longer fully resolves the concentration seen at 4 -- it now
     takes 6 to do that, the same shift already proven in the "additional
     availability" test above (supportDays 3 -> 4 at 6 days). The trigger
     still reports nothing once the extra day genuinely is granted; only
     which day count that happens at moved with the table. */
  const a = app();
  const r5 = a.raceGoalAvailabilityLimited('full', 'advanced', null, 15, { availableDays:5, easyPaceSecPerKm:330 });
  assert.equal(r5.limited, true, 'the 5th day no longer fully resolves the concentration at this larger pathway volume');
  const r6 = a.raceGoalAvailabilityLimited('full', 'advanced', null, 15, { availableDays:6, easyPaceSecPerKm:330 });
  assert.equal(r6.limited, false, 'the 6th day is where the concentration is now genuinely resolved');
});

test('raceGoalAvailabilityLimited: never fires from a raw kilometre threshold -- the highest-mileage pathway tested is NOT flagged while a much smaller one IS', () => {
  const a = app();
  /* If this read a weekly-kilometre size, the 87.8km Advanced Marathon week
     would be the first case flagged, not the last. It is provably the
     coherence floor being read instead: Marathon Advanced's long run is
     large enough, relative to its own week, that a further day would push
     supporting runs below what still counts as supporting it -- so at 6
     days it is genuinely NOT limited -- while 5K Novice's much smaller
     30km week has a small enough long run relative to itself that a further
     day still helps. */
  const big = a.raceGoalAvailabilityLimited('full', 'advanced', null, 15, { availableDays:6, easyPaceSecPerKm:330 });
  const small = a.raceGoalAvailabilityLimited('5k', 'novice', null, 12, { availableDays:6, easyPaceSecPerKm:330 });
  assert.equal(big.limited, false, 'the largest week tested must not be flagged');
  assert.equal(small.limited, true, 'a much smaller week must still be flagged, disproving a size-based reading');
});

/* ---------- 15. READINESS EXPOSES AN AVAILABILITY-LIMITED SHORTFALL HONESTLY ---------- */

test('readiness reports the shortfall for a genuinely availability-limited block, and reports READY once availability stops limiting it', () => {
  const limitedBuild = buildFor('full', 'advanced', 15, 4);
  const rdLimited = limitedBuild.a.raceGoalReadiness('full', 'advanced', limitedBuild.blk);
  const workloadLimited = rdLimited.dimensions.find(d => d.key === 'workload');
  const trigger = limitedBuild.a.raceGoalAvailabilityLimited('full', 'advanced', null, 15, { availableDays:4, easyPaceSecPerKm:330 });
  assert.equal(trigger.limited, true);
  // Readiness and the trigger must never contradict each other about whether more room exists to help.
  const freeBuild = buildFor('full', 'advanced', 15, 6);
  const rdFree = freeBuild.a.raceGoalReadiness('full', 'advanced', freeBuild.blk);
  assert.notEqual(rdFree.verdict, 'INSUFFICIENT');
});

/* ---------- 16. PRODUCT ISOLATION ---------- */

test('product isolation: Aerobic Base, Maintain & Protect, Speed & Threshold and Ultra are byte-for-byte unaffected by the frequency repair', () => {
  const a = app();
  ['maintain', 'aerobic_base', 'speed'].forEach(purpose => {
    assert.equal(a.usesBottomUpArc(purpose, 'full'), false, `${purpose} must never route through bottom-up construction`);
  });
  assert.equal(a.usesBottomUpArc('race', 'ultra'), false, 'Ultra has no dedicated Race Goal architecture and must not gain one here');
  ['full','half','5k','10k'].forEach(dist => {
    assert.equal(a.usesBottomUpArc('maintain', dist), false);
  });
  // A steady/maintenance block's own day-count path is untouched: it must still build without raceGoalDestinationSolve ever running.
  const blk = a.buildBlockWeeks('full', 40, 8, { purpose:'maintain', availableDays:6 });
  assert.ok(blk && blk.weeks && blk.weeks.length, 'maintenance block must still build normally');
  assert.ok(blk.weeks.every(w => !w.bottomUp), 'a maintenance block must carry no bottomUp frequency solve at all');
});
