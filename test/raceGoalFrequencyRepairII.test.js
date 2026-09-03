'use strict';
/* HQ -- RACE GOAL HALF/MARATHON FREQUENCY REPAIR II.
 * ===========================================================================
 * The first mNeed repair (test/raceGoalFrequencyArchitecture.test.js) fixed
 * mNeed from a ceiling into a floor, but SUPPORT_SHARE_MIN's coherence band
 * -- 40% of a MARATHON-scale long run (26-32km), applied as an EQUAL per-day
 * share -- still capped the day count it could ever justify at roughly 2-3,
 * regardless of real selected availability, because dividing the SAME
 * supporting workload across more days always shrinks the per-day average,
 * and a marathon's long run is numerically large enough that even 4 equal
 * shares rarely clear 40% of it. The live symptom: a 6-day Marathon Build
 * week routinely resolved to 4 definite runs (2 easy + 1 quality + 1 long)
 * + 1 Optional + 2 Rest, with two of the six selected days genuinely unused.
 *
 * THE FIX does not touch SUPPORT_SHARE_MIN, mSupportDays, mSupportDest,
 * longDestKm, quality budgets or weekly volume totals at all -- every one of
 * those governs the week's TOTAL supporting workload and its coherence with
 * the long run, and none of that changes. distributeWeekVolume() (shared,
 * pre-existing) already redivides a week's fixed easy budget safely down to
 * its own floor -- EASY_MIN_KM -- whenever more calendar easy-day slots are
 * offered to it; the day count reaching it (runCap in buildDaysFromWeeks)
 * was simply never allowed past SUPPORT_SHARE_MIN's stricter number.
 * raceGoalDestinationSolve() now also returns scheduledSupportDays: the
 * SAME coherence-derived total, but the day COUNT it may be scheduled across
 * once real selected availability and real supporting workload both exist,
 * per HQ's contract (N selected -> at least N-1 definite, Half/Marathon
 * only). Gated by distKey so 5K/10K keep the original day count exactly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const TODAY = '2026-09-02T09:00:00Z';
function app(){
  const a = loadApp({ pinnedDate: TODAY });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  a.state.athlete = { sessions: [], blocks: [] };
  return a;
}
function buildFor(a, dist, exp, N, availableDays, currentVolume){
  return a.buildBlockWeeks(dist, currentVolume, N,
    { purpose: 'race', availableDays, experience: exp, easyPaceSecPerKm: 400 });
}
function buildDays(a, blk, N, activeDays, longRunDay){
  const start = a.todayStr();
  const startMonday = a.addDays(start, -a.isoWeekday(start));
  const raceDate = a.addDays(startMonday, N * 7 - 1);
  const schedule = { activeDays, longRunDay };
  return { days: a.buildDaysFromWeeks(blk, raceDate, schedule, start, false, { easyPaceSecPerKm: 400 }), raceDate, schedule, start };
}
function buildPhaseWeek(blk, phaseName){
  const ws = blk.weeks.filter(w => w.phase === phaseName && !w.isCutback);
  return ws[Math.floor(ws.length / 2)] || blk.weeks.find(w => w.phase === phaseName);
}
function definiteRestOptional(days, weekNum){
  const wd = days.filter(d => d.week === weekNum);
  const definite = wd.filter(d => d.type !== 'rest').length;
  const optional = wd.filter(d => d.type === 'rest' && d.availableUnused).length;
  const rest = wd.filter(d => d.type === 'rest' && !d.availableUnused).length;
  return { definite, optional, rest, total: wd.length };
}

/* ==========================================================
   HARD ACCEPTANCE RULE -- would have FAILED on pre-repair main.
   ========================================================== */
test('HARD RULE: Marathon, 6 selected days, Novice, Build phase -- at least 3 definite runs, capped at the Developing tier ceiling', () => {
  /* HQ DAY-COUNT/START-VOLUME CORRECTION -- Developing is now tier-capped at
     4 selected days for Half/Marathon (RACE_GOAL_MAX_DAYS), applied to
     mAvail inside raceGoalDestinationSolve() before this contract's own N-1
     floor is read. The 6 selected here are real permission the pathway
     never needs: only 4 of them are ever used, so the floor this proves is
     N-1 of 4 (3), not of the raw 6 -- and the 2 selected days beyond the
     cap are still offered as Optional, never demoted to plain Rest. */
  const a = app();
  const blk = buildFor(a, 'full', 'novice', 16, 6, 40);
  const buildWeek = buildPhaseWeek(blk, 'Build');
  const { days } = buildDays(a, blk, 16, [0, 1, 2, 3, 4, 6], 6);
  const c = definiteRestOptional(days, buildWeek.week);
  assert.ok(c.definite >= 3,
    `week ${buildWeek.week}: expected >=3 definite runs at the Developing tier's 4-day cap, got ${c.definite} definite / ${c.optional} optional / ${c.rest} rest`);
  assert.equal(c.definite + c.optional, 6,
    'every selected day is still prescribed or Optional, never plain Rest, even beyond the tier cap');
});

test('HARD RULE: Marathon, 5 selected days, Novice -- at least 4 definite runs', () => {
  const a = app();
  const blk = buildFor(a, 'full', 'novice', 16, 5, 40);
  const buildWeek = buildPhaseWeek(blk, 'Build');
  const { days } = buildDays(a, blk, 16, [0, 1, 2, 4, 6], 6);
  const c = definiteRestOptional(days, buildWeek.week);
  assert.ok(c.definite >= 4, `expected >=4 definite for 5 selected days, got ${c.definite}`);
});

test('HARD RULE: Marathon, 4 selected days, Novice -- at least 3 definite runs', () => {
  const a = app();
  const blk = buildFor(a, 'full', 'novice', 16, 4, 40);
  const buildWeek = buildPhaseWeek(blk, 'Build');
  const { days } = buildDays(a, blk, 16, [0, 2, 4, 6], 6);
  const c = definiteRestOptional(days, buildWeek.week);
  assert.ok(c.definite >= 3, `expected >=3 definite for 4 selected days, got ${c.definite}`);
});

test('HARD RULE: Half Marathon, 6 selected days, Experienced -- at least 5 definite runs', () => {
  const a = app();
  const blk = buildFor(a, 'half', 'experienced', 12, 6, 30);
  const buildWeek = buildPhaseWeek(blk, 'Build');
  const { days } = buildDays(a, blk, 12, [0, 1, 2, 3, 4, 6], 6);
  const c = definiteRestOptional(days, buildWeek.week);
  assert.ok(c.definite >= 5, `expected >=5 definite for 6 selected Half days, got ${c.definite}`);
});

test('HQ RACE GOAL TIGHT METHODOLOGY CORRECTION closed this gap: Novice Half Marathon, 6 selected days, now reaches at least 3 definite -- capped at the Developing tier ceiling', () => {
  // SUPERSEDES the earlier documented gap in this file's history: Novice
  // Half's own capacity-earned supportDays never cleared the EASY_MIN_KM
  // affordability floor for a 2nd support day, so this exact scenario was
  // byte-identical to unmodified origin/main at 3 definite / 3 optional / 1
  // rest, named as a pre-existing, out-of-scope gap in Frequency Repair
  // II's own HQ report. The Tight Methodology Correction closed it: the
  // day-count floor for Half/Marathon Build/Taper is reached
  // unconditionally, no longer gated on the week's own earned supporting
  // workload.
  //
  // HQ DAY-COUNT/START-VOLUME CORRECTION, LATER -- Developing is now ALSO
  // tier-capped at 4 selected days regardless of the 6 offered here
  // (RACE_GOAL_MAX_DAYS, applied to mAvail before this contract's own N-1
  // floor is read), so the floor this now proves is N-1 of 4 (3), not of
  // the raw 6 -- the closed gap and this later cap are two different
  // corrections that happen to read the same number by coincidence at this
  // exact pathway; they are not the same rule.
  const a = app();
  const blk = buildFor(a, 'half', 'novice', 12, 6, 30);
  const buildWeek = buildPhaseWeek(blk, 'Build');
  const { days } = buildDays(a, blk, 12, [0, 1, 2, 3, 4, 6], 6);
  const c = definiteRestOptional(days, buildWeek.week);
  assert.ok(c.definite >= 3, `expected >=3 definite at the Developing tier's 4-day cap, got ${c.definite}`);
});

/* ==========================================================
   THE SCHEDULED-DAYS FIELD ITSELF
   ========================================================== */
test('scheduledSupportDays only ever widens supportDays, never narrows it', () => {
  const a = app();
  ['full', 'half'].forEach(dist => {
    ['novice', 'experienced', 'advanced'].forEach(exp => {
      [4, 5, 6].forEach(days => {
        const res = a.raceGoalDestinationSolve(dist, exp, dist === 'full' ? 40 : 30, 16,
          { availableDays: days, easyPaceSecPerKm: 400 });
        assert.ok(res.scheduledSupportDays >= res.supportDays,
          `${dist} ${exp} ${days}d: scheduledSupportDays ${res.scheduledSupportDays} < supportDays ${res.supportDays}`);
        assert.ok(res.scheduledSupportDays <= days,
          `${dist} ${exp} ${days}d: scheduledSupportDays ${res.scheduledSupportDays} exceeds real availability`);
      });
    });
  });
});

test('5K/10K are byte-identical: scheduledSupportDays equals supportDays in every case', () => {
  const a = app();
  ['5k', '10k'].forEach(dist => {
    ['novice', 'experienced', 'advanced'].forEach(exp => {
      [4, 5, 6].forEach(days => {
        const res = a.raceGoalDestinationSolve(dist, exp, 20, 10, { availableDays: days, easyPaceSecPerKm: 350 });
        assert.equal(res.scheduledSupportDays, res.supportDays,
          `${dist} ${exp} ${days}d must be untouched by the Half/Marathon-only repair`);
      });
    });
  });
});

/* ==========================================================
   NOTHING ELSE MOVES: weekly destination, long run, quality, taper
   ========================================================== */
test('weekly destination volume is unchanged by the wider day count', () => {
  // 5 vs 6 selected days, both well above the block's expressibility floor
  // (unlike 3, which can independently produce a smaller week for reasons
  // that predate this repair -- the expressibility floor in
  // expressibleRunningDays(), not anything scheduledSupportDays touches).
  const a = app();
  const wide = buildFor(a, 'full', 'novice', 16, 6, 40);
  const narrow = buildFor(a, 'full', 'novice', 16, 5, 40);
  const fullPeaks = wide.weeks.filter(w => w.phase === 'Peak' && !w.isCutback);
  const narrowPeaks = narrow.weeks.filter(w => w.phase === 'Peak' && !w.isCutback);
  assert.ok(Math.abs(fullPeaks[0].volume - narrowPeaks[0].volume) < 0.5,
    `destination must not move with day count: 6-day Peak ${fullPeaks[0].volume} vs 5-day Peak ${narrowPeaks[0].volume}`);
});

test('long run and quality-session sizes are unchanged by the wider day count', () => {
  const a = app();
  const wide = buildFor(a, 'full', 'novice', 16, 6, 40);
  const narrow = buildFor(a, 'full', 'novice', 16, 3, 40);
  const wPeak = wide.weeks.filter(w => w.phase === 'Peak' && !w.isCutback)[0];
  const nPeak = narrow.weeks.filter(w => w.phase === 'Peak' && !w.isCutback)[0];
  assert.equal(wPeak.longTarget, nPeak.longTarget, 'the long run is a property of the pathway, not the day count');
  assert.equal(wPeak.soloSpec ? wPeak.soloSpec.type : null, nPeak.soloSpec ? nPeak.soloSpec.type : null,
    'quality family must not change because more days are available');
});

test('taper retains the block\'s own scheduledSupportDays, exactly as it already retained supportDays', () => {
  const a = app();
  const blk = buildFor(a, 'full', 'novice', 16, 6, 40);
  const pk = blk.weeks.filter(w => w.phase === 'Peak' && !w.isCutback)[0];
  const taper = blk.weeks.find(w => w.isTaper);
  assert.ok(taper, 'a taper week must exist');
  assert.equal(taper.bottomUp.scheduledSupportDays, pk.bottomUp.scheduledSupportDays,
    'taper must retain the same scheduled day count Peak used, only load drops');
  assert.ok(taper.volume < pk.volume, 'taper volume must still be lower than Peak volume');
});

test('Peak stays genuinely Optional-free at 6 selected days -- unaffected by the wider schedule', () => {
  const a = app();
  ['full', 'half'].forEach(dist => {
    const blk = buildFor(a, dist, 'advanced', dist === 'full' ? 16 : 12, 6, dist === 'full' ? 55 : 40);
    const { days } = buildDays(a, blk, dist === 'full' ? 16 : 12, [0, 1, 2, 3, 4, 6], 6);
    const peakWeeks = new Set(blk.weeks.filter(w => w.phase === 'Peak').map(w => w.week));
    const offered = days.filter(d => peakWeeks.has(d.week) && d.availableUnused);
    assert.equal(offered.length, 0, `${dist} Peak must generate zero availableUnused offers`);
  });
});

/* ==========================================================
   PRODUCT ISOLATION -- Aerobic Base, Maintain & Protect, Speed & Threshold
   ========================================================== */
test('isolation: Aerobic Base, Maintain & Protect and Speed & Threshold are byte-for-byte unaffected', () => {
  const a1 = app(), a2 = app();
  ['base', 'maintain', 'speed'].forEach(purpose => {
    const opts = { purpose, steady: purpose === 'maintain', availableDays: 6, experience: 'novice' };
    const b1 = a1.buildBlockWeeks('half', 40, 10, opts);
    const b2 = a2.buildBlockWeeks('half', 40, 10, opts);
    assert.deepEqual(JSON.stringify(b1.weeks.map(w => w.volume)), JSON.stringify(b2.weeks.map(w => w.volume)));
  });
  // And explicitly: these purposes never even reach raceGoalDestinationSolve,
  // so scheduledSupportDays cannot exist on their weeks at all.
  const base = a1.buildBlockWeeks('half', 40, 10, { purpose: 'base', availableDays: 6, experience: 'novice' });
  base.weeks.forEach(w => assert.equal(w.bottomUp, null));
});

/* ==========================================================
   STALE-PLAN RECONCILIATION
   ========================================================== */
test('reconciliation: a plan generated before the repair adopts the wider frequency for FUTURE weeks only', () => {
  const a = app();
  const start = a.todayStr();
  const startMonday = a.addDays(start, -a.isoWeekday(start));
  const raceDate = a.addDays(startMonday, 16 * 7 - 1);
  const schedule6 = { activeDays: [0, 1, 2, 3, 4, 6], longRunDay: 6 };

  // Simulate a plan generated under the OLD architecture by building with a
  // narrower availableDays than the athlete's real (persisted) schedule --
  // this is exactly what the old code produced for a 6-selected-day athlete.
  const oldBlk = a.buildBlockWeeks('full', 40, 16, { purpose: 'race', experience: 'novice', availableDays: 3, easyPaceSecPerKm: 400 });
  const oldDays = a.buildDaysFromWeeks(oldBlk, raceDate, { activeDays: [0, 2, 6], longRunDay: 6 }, start, false, { easyPaceSecPerKm: 400 });

  // Mark today and the two days before it as completed history that must survive.
  const histDates = [a.addDays(start, -2), a.addDays(start, -1), start];
  oldDays.forEach(d => { if (histDates.indexOf(d.date) !== -1) { d.completed = true; d.actual = { km: d.km, pace: 400, hr: 140, rpe: 4, notes: '' }; } });
  const historySnapshot = JSON.stringify(oldDays.filter(d => histDates.indexOf(d.date) !== -1));

  a.state.days = oldDays;
  a.state.setup = { distanceKey: 'full', currentVolume: 40, raceDate, hasEvent: false, startDate: start, planWeeks: 16,
    schedule: schedule6, blockId: 'b1', purpose: 'race', experience: 'novice' };
  a.state.blocks = [{ id: 'b1', purpose: 'race', distanceKey: 'full', goalDate: raceDate, startVolume: 40, peakVolume: 60, anchorVolume: 40, outcome: null }];
  a.state.athlete.blocks = a.state.blocks;

  const before = a.state.days.slice();
  const ok = a.ensureRaceGoalFrequencyReconciled();
  assert.equal(ok, true, 'reconciliation must run the first time for an eligible race-goal plan');
  assert.equal(a.state.setup.freqRepairIIReconciled, true);

  // History is untouched.
  const historyAfter = JSON.stringify(a.state.days.filter(d => histDates.indexOf(d.date) !== -1));
  assert.equal(historyAfter, historySnapshot, 'completed/logged history must survive reconciliation verbatim');

  // A future week now reflects the wider, 6-day schedule rather than the
  // narrower one the plan happened to be generated with.
  const futureWeek = a.currentWeekNum ? null : null; // (accessor not needed; use week 6, well into the future)
  const wd = a.state.days.filter(d => d.week === 6);
  assert.ok(wd.length > 0, 'week 6 must exist after reconciliation');
  const definite = wd.filter(d => d.type !== 'rest').length;
  assert.ok(definite >= 4, `reconciled future week should show the wider frequency, got ${definite} definite days`);

  // Idempotent: calling again does nothing further.
  const daysAfterFirst = JSON.stringify(a.state.days);
  const ok2 = a.ensureRaceGoalFrequencyReconciled();
  assert.equal(ok2, false, 'a second call must be a no-op once reconciled');
  assert.equal(JSON.stringify(a.state.days), daysAfterFirst, 'state must not change on the no-op call');
});

test('reconciliation: does nothing for 5K/10K, Base, Maintain or Speed plans', () => {
  ['5k', '10k'].forEach(distanceKey => {
    const a = app();
    a.state.setup = { distanceKey, purpose: 'race', currentVolume: 20, planWeeks: 10,
      raceDate: a.addDays(a.todayStr(), 70), startDate: a.todayStr(),
      schedule: { activeDays: [0, 1, 2, 4, 6], longRunDay: 6 }, hasEvent: false, experience: 'novice', blockId: 'b1' };
    a.state.days = [{ id: a.todayStr(), date: a.todayStr(), week: 1, type: 'rest', title: 'Rest Day', km: 0 }];
    const ok = a.ensureRaceGoalFrequencyReconciled();
    assert.equal(ok, false, `${distanceKey} must never be reconciled by the Half/Marathon-only repair`);
  });
  ['base', 'maintain', 'speed'].forEach(purpose => {
    const a = app();
    a.state.setup = { distanceKey: 'half', purpose, currentVolume: 30, planWeeks: 10,
      startDate: a.todayStr(), schedule: { activeDays: [0, 1, 2, 4, 6], longRunDay: 6 }, experience: 'novice', blockId: 'b1' };
    a.state.days = [{ id: a.todayStr(), date: a.todayStr(), week: 1, type: 'rest', title: 'Rest Day', km: 0 }];
    const ok = a.ensureRaceGoalFrequencyReconciled();
    assert.equal(ok, false, `${purpose} must never be reconciled by the Race-Goal-only repair`);
  });
});
