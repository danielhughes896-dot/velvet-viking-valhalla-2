'use strict';
/* HQ -- RACE GOAL TIGHT METHODOLOGY CORRECTION.
 * ===========================================================================
 * Two narrowly-scoped corrections to Half/Marathon Race Goal, layered on top
 * of the already-approved Race Goal Frequency Repair II (merged to main).
 *
 * 1. SELECTED TRAINING DAYS ARE TRAINING DAYS. Every selected day is either
 *    a prescribed run or the reserved Optional Run -- never plain, unlabeled
 *    Rest merely because the week's mileage could be squeezed into fewer
 *    sessions. N selected -> AT LEAST N-1 prescribed, and every selected day
 *    that is not prescribed is Optional (offered), never plain Rest. That
 *    holds from the very first week of the block.
 *
 *    Frequency Repair II's own contract was "at least N-1, capped by the
 *    week's own earned workload" -- this repair removes that cap (on HQ's
 *    own explicit instruction: "do not let the solver reduce the number of
 *    training days merely because it can fit the required mileage into
 *    fewer sessions"), so the floor is reached unconditionally rather than
 *    only when the week's own workload happens to afford it.
 *
 *    WIDEN-ONLY, DELIBERATELY, NOT AN EXACT N-1 CEILING. "Allow ONE selected
 *    training day to be an Optional Run" is read as a permission the
 *    contract guarantees room for, not a mandate that a capable week must
 *    always leave one day unused: an athlete whose own settled, capacity-
 *    earned support days already reach or exceed N-1 keeps that larger
 *    figure, exactly as Frequency Repair II already let them. A first
 *    attempt forced the day count down to precisely N-1 whenever a week's
 *    own earned capacity exceeded it, and it cost the marathon medium-long-
 *    run mechanism its own required "three calendar easy-day slots to give
 *    one up and still be recognisable" gate -- caught by
 *    test/marathonMethodology.test.js and test/marathonPrescribedFrequency
 *    .test.js, neither of which this correction was authorised to touch.
 *    Reverted before commit; widen-only is the version below.
 *
 * 2. RACE GOAL DESTINATIONS ARE MINIMUMS, NOT CEILINGS. The approved
 *    pathway destinations (peak long run, end-of-Build/Peak weekly volume)
 *    must never cap an athlete whose own demonstrated evidence supports
 *    more. This was already substantially implemented (raceGoalPathway's
 *    own numbers, raceGoalVolumeDestinationKm/raceGoalLongDestinationKm's
 *    Math.max(pathway, demonstrated), and a dedicated RACE_GOAL_LONG_CAP_KM
 *    backstop preventing the shared DISTANCE_PROFILES ceiling from
 *    clamping Race Goal back down) -- these tests lock that behaviour in
 *    directly, at HQ's own named numbers, rather than assuming it holds.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const MONDAY = '2026-08-31T09:00:00Z'; // confirmed Monday, so week 1 is a full calendar week
function app(){
  const a = loadApp({ pinnedDate: MONDAY });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  a.state.athlete = { sessions: [], blocks: [] };
  return a;
}
function withHistory(a, weeklyKm, longKm, weeks){
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t)), s = [];
  const easyKm = longKm ? (weeklyKm - longKm) / 3 : weeklyKm / 4;
  for (let w = 1; w <= (weeks || 12); w++){
    [0, 2, 4].forEach(d => s.push({ date: a.addDays(m, -7 * w + d), completed: true,
      actualKm: easyKm, plannedKm: easyKm, type: 'easy',
      actual: { km: easyKm, rpe: 3, pace: 400, hr: 135 }, feel: 'good' }));
    if (longKm) s.push({ date: a.addDays(m, -7 * w + 6), completed: true, actualKm: longKm,
      plannedKm: longKm, type: 'long', actual: { km: longKm, rpe: 5, pace: 420, hr: 140 }, feel: 'good' });
  }
  a.state.athlete = { sessions: s };
}
function buildFor(a, dist, exp, N, availableDays, currentVolume){
  return a.buildBlockWeeks(dist, currentVolume, N, { purpose: 'race', availableDays, experience: exp, easyPaceSecPerKm: 400 });
}
function buildDays(a, blk, N, activeDays, longRunDay){
  const start = a.todayStr();
  const raceDate = a.addDays(start, N * 7 - 1);
  const schedule = { activeDays, longRunDay };
  return { days: a.buildDaysFromWeeks(blk, raceDate, schedule, start, false, { easyPaceSecPerKm: 400 }) };
}
function definiteRestOptional(days, weekNum){
  const wd = days.filter(d => d.week === weekNum);
  const definite = wd.filter(d => d.type !== 'rest').length;
  const optional = wd.filter(d => d.type === 'rest' && d.availableUnused).length;
  const rest = wd.filter(d => d.type === 'rest' && !d.availableUnused).length;
  return { definite, optional, rest, total: wd.length };
}
function activeDaysFor(n){
  if (n === 3) return [0, 2, 6];
  if (n === 4) return [0, 2, 4, 6];
  if (n === 5) return [0, 1, 2, 4, 6];
  return [0, 1, 2, 3, 4, 6];
}
function pickMid(ws){ return ws[Math.floor(ws.length / 2)] || null; }

/* ==========================================================
   REQUIREMENT 1 -- AT LEAST N-1 PRESCRIBED, EVERY SELECTED DAY EITHER
   PRESCRIBED OR OPTIONAL, NEVER PLAIN REST. EVERY SELECTED-DAY COUNT,
   EVERY EXPERIENCE TIER, FROM WEEK ONE.
   ========================================================== */
['half', 'full'].forEach(dk => {
  const N = dk === 'half' ? 12 : 16;
  ['novice', 'experienced', 'advanced'].forEach(exp => {
    [3, 4, 5, 6].forEach(days => {
      const entryVol = dk === 'half'
        ? { novice: 15, experienced: 30, advanced: 45 }[exp]
        : { novice: 20, experienced: 40, advanced: 60 }[exp];

      test(`SELECTED DAYS ARE TRAINING DAYS -- ${dk} ${exp} ${days}d, week 1 at locked entry (${entryVol}km)`, () => {
        const a = app();
        const blk = buildFor(a, dk, exp, N, days, entryVol);
        const { days: builtDays } = buildDays(a, blk, N, activeDaysFor(days), 6);
        const c = definiteRestOptional(builtDays, 1);
        assert.ok(c.definite >= days - 1,
          `week 1, ${days} selected: expected at least ${days - 1} prescribed, got ${c.definite}`);
        assert.equal(c.definite + c.optional, days,
          `week 1, ${days} selected: every selected day must be prescribed or Optional (got ${c.definite} + ${c.optional} of ${days})`);
        assert.equal(c.rest, 7 - days,
          'every unselected day is plain Rest, and only unselected days are');
      });

      test(`SELECTED DAYS ARE TRAINING DAYS -- ${dk} ${exp} ${days}d, mid-Build`, () => {
        const a = app();
        const vol = dk === 'half'
          ? { novice: 30, experienced: 45, advanced: 60 }[exp]
          : { novice: 40, experienced: 55, advanced: 70 }[exp];
        const blk = buildFor(a, dk, exp, N, days, vol);
        const { days: builtDays } = buildDays(a, blk, N, activeDaysFor(days), 6);
        const buildWeeks = blk.weeks.filter(w => w.phase === 'Build' && !w.isCutback && !w.isCheckpoint);
        const wk = pickMid(buildWeeks);
        assert.ok(wk, `${dk} ${exp} ${days}d must have a mid-Build week to test`);
        const c = definiteRestOptional(builtDays, wk.week);
        assert.ok(c.definite >= days - 1,
          `mid-Build, ${days} selected: expected at least ${days - 1} prescribed, got ${c.definite}`);
        assert.equal(c.definite + c.optional, days,
          `mid-Build, ${days} selected: every selected day must be prescribed or Optional (got ${c.definite} + ${c.optional} of ${days})`);
      });
    });
  });
});

/* ---------- TAPER: THE SAME FLOOR, NEVER BELOW WHAT BUILD ALREADY EARNED ---------- */
['half', 'full'].forEach(dk => {
  const N = dk === 'half' ? 12 : 16;
  [4, 5, 6].forEach(days => {
    test(`Taper never falls below the N-1 floor, and every selected day is still prescribed or Optional -- ${dk} ${days}d`, () => {
      const a = app();
      const vol = dk === 'half' ? 45 : 55;
      const blk = buildFor(a, dk, 'experienced', N, days, vol);
      const { days: builtDays } = buildDays(a, blk, N, activeDaysFor(days), 6);
      const taperWeeks = blk.weeks.filter(w => w.isTaper && !w.isRace);
      const wk = taperWeeks[taperWeeks.length - 1];
      assert.ok(wk, `${dk} ${days}d must have a taper week to test`);
      const c = definiteRestOptional(builtDays, wk.week);
      assert.ok(c.definite >= days - 1, `taper, ${days} selected: expected at least ${days - 1}, got ${c.definite}`);
      assert.equal(c.definite + c.optional, days,
        `taper, ${days} selected: every selected day must be prescribed or Optional (got ${c.definite} + ${c.optional} of ${days})`);
    });
  });
});

/* ---------- PEAK: HQ'S PRE-EXISTING NO-OPTIONAL RULING, PRESERVED ---------- */
['half', 'full'].forEach(dk => {
  const N = dk === 'half' ? 12 : 16;
  [4, 5, 6].forEach(days => {
    test(`Peak keeps HQ's pre-existing no-Optional ruling -- at least N-1, never left idle -- ${dk} ${days}d`, () => {
      const a = app();
      const vol = dk === 'half' ? 45 : 55;
      const blk = buildFor(a, dk, 'experienced', N, days, vol);
      const { days: builtDays } = buildDays(a, blk, N, activeDaysFor(days), 6);
      const peakWeeks = blk.weeks.filter(w => w.phase === 'Peak' && !w.isCutback);
      const wk = pickMid(peakWeeks);
      assert.ok(wk, `${dk} ${days}d must have a Peak week to test`);
      const c = definiteRestOptional(builtDays, wk.week);
      assert.ok(c.definite >= days - 1, `Peak, ${days} selected: expected >=${days - 1}, got ${c.definite}`);
      assert.equal(c.optional, 0, 'Peak never reserves a genuinely Optional day -- HQ\'s own standing ruling');
    });
  });
});

/* ---------- THE SOLVER MUST NOT SHRINK DAYS TO FIT MILEAGE ---------- */
test('the generic volume-feasibility bound (expressibleRunningDays) is bypassed for Half/Marathon bottom-up weeks', () => {
  // The exact defect this closes: a Developing Half athlete's locked-entry
  // volume (15km) could express only 4 calendar running days at
  // EASY_MIN_KM, silently overriding scheduledSupportDays' own correct,
  // wider figure before buildDaysFromWeeks' bottom-up branch ever got to
  // state it. Reproduced directly against the exact scenario.
  const a = app();
  const blk = buildFor(a, 'half', 'novice', 12, 6, 15);
  const { days } = buildDays(a, blk, 12, activeDaysFor(6), 6);
  const c = definiteRestOptional(days, 1);
  assert.ok(c.definite >= 5, 'the feasibility bound must not silently override the day-count floor');
});

test('5K/10K keep the generic feasibility bound -- this bypass is Half/Marathon only', () => {
  const a = app();
  const blk = buildFor(a, '10k', 'novice', 10, 6, 15);
  const { days } = buildDays(a, blk, 10, activeDaysFor(6), 6);
  const c = definiteRestOptional(days, 1);
  // Unlike Half/Marathon, 5K/10K's day count is still bound by the generic
  // feasibility check -- this repair does not touch it there.
  assert.ok(c.definite <= 4, '5K/10K must remain untouched by the Half/Marathon-only bypass');
});

test('the day count never narrows -- widening is the only direction this correction moves it', () => {
  const a = app();
  ['half', 'full'].forEach(dk => {
    const N = dk === 'half' ? 12 : 16;
    ['novice', 'experienced', 'advanced'].forEach(exp => {
      [4, 5, 6].forEach(days => {
        const res = a.raceGoalDestinationSolve(dk, exp, dk === 'half' ? 45 : 55, N,
          { availableDays: days, easyPaceSecPerKm: 400 });
        assert.ok(res.scheduledSupportDays >= res.supportDays,
          `${dk} ${exp} ${days}d: scheduledSupportDays ${res.scheduledSupportDays} < supportDays ${res.supportDays}`);
      });
    });
  });
});

/* ==========================================================
   REQUIREMENT 2 -- DESTINATIONS ARE MINIMUMS, NOT CEILINGS.
   ========================================================== */
const PATHWAY_FLOORS = {
  half: {
    novice:      { peakLongKm: 16, peakVolumeKm: 38, buildVolumeKm: 30 },
    experienced: { peakLongKm: 19, peakVolumeKm: 70, buildVolumeKm: 40 },
    advanced:    { peakLongKm: 21, peakVolumeKm: 80, buildVolumeKm: 60 },
  },
  full: {
    novice:      { peakLongKm: 26, buildVolumeKm: 40 },
    experienced: { peakLongKm: 29, buildVolumeKm: 55 },
    advanced:    { peakLongKm: 32, buildVolumeKm: 70 },
  },
};

test('HQ\'s locked pathway floors are exactly what raceGoalPathway() states', () => {
  const a = app();
  Object.keys(PATHWAY_FLOORS).forEach(dk => {
    Object.keys(PATHWAY_FLOORS[dk]).forEach(exp => {
      const p = a.raceGoalPathway(dk, exp);
      const want = PATHWAY_FLOORS[dk][exp];
      assert.equal(p.peakLongKm, want.peakLongKm, `${dk} ${exp} peakLongKm`);
      assert.equal(p.buildVolumeKm, want.buildVolumeKm, `${dk} ${exp} buildVolumeKm`);
      if (want.peakVolumeKm != null) assert.equal(p.peakVolumeKm, want.peakVolumeKm, `${dk} ${exp} peakVolumeKm`);
    });
  });
});

['half', 'full'].forEach(dk => {
  Object.keys(PATHWAY_FLOORS[dk]).forEach(exp => {
    test(`a stronger-than-pathway athlete is never capped down to the floor -- ${dk} ${exp}`, () => {
      const floor = PATHWAY_FLOORS[dk][exp];
      const demLong = Math.round(floor.peakLongKm * 1.2 * 10) / 10;
      const demVol = Math.round((floor.peakVolumeKm || floor.buildVolumeKm) * 1.2 * 10) / 10;
      const a = app();
      withHistory(a, demVol, demLong, 12);
      const N = dk === 'half' ? 12 : 16;
      const blk = a.buildBlockWeeks(dk, demVol, N,
        { purpose: 'race', availableDays: 6, experience: exp, easyPaceSecPerKm: 380 });
      const maxLong = Math.max(...blk.weeks.map(w => w.longTarget || 0));
      const maxVol = Math.max(...blk.weeks.filter(w => !w.isTaper).map(w => w.volume || 0));
      assert.ok(maxLong >= floor.peakLongKm,
        `${dk} ${exp}: long run ${maxLong}km must not fall below the pathway floor ${floor.peakLongKm}km`);
      assert.ok(maxLong > floor.peakLongKm + 0.5,
        `${dk} ${exp}: a demonstrably stronger athlete (${demLong}km long run logged) must be developed above the floor, got ${maxLong}km`);
    });
  });
});

test('a dedicated Race Goal long-run backstop protects the pathway ceiling from the shared DISTANCE_PROFILES cap', () => {
  // The exact mechanism: raceGoalLongCapKm(distKey, 'race') must sit at or
  // above every pathway's own culminating long run, even though the shared
  // DISTANCE_PROFILES[distKey].longCapKm (used by Base/Speed/Maintain) is
  // lower for Half and numerically equal for Marathon -- either of which
  // would silently detrain a strong athlete back to the Advanced minimum.
  const a = app();
  assert.ok(a.raceGoalLongCapKm('half', 'race') >= 21, 'half race cap must clear the Advanced pathway floor (21km)');
  assert.ok(a.raceGoalLongCapKm('full', 'race') > 32, 'full race cap must sit strictly above the Advanced pathway floor (32km), not equal it');
  assert.ok(a.raceGoalLongCapKm('half', 'base') <= a.DISTANCE_PROFILES.half.longCapKm,
    'the backstop is Race Goal-only -- Base/Speed/Maintain still read the unraised shared profile cap');
});

/* ==========================================================
   ISOLATION -- 5K/10K, BASE, SPEED, MAINTAIN, AND THE UNRELATED SUPPORT-
   SIZE/COST MECHANISMS THIS CORRECTION DOES NOT TOUCH.
   ========================================================== */
test('isolation: 5K/10K destination and day-count behaviour is unaffected by either correction', () => {
  const a = app();
  const blk1 = a.buildBlockWeeks('10k', 30, 10, { purpose: 'race', availableDays: 6, experience: 'advanced', easyPaceSecPerKm: 350 });
  // 5K/10K never read scheduledSupportDays as anything but supportDays --
  // Frequency Repair II's own invariant, unmodified by this correction.
  blk1.weeks.forEach(w => {
    if (w.bottomUp) assert.equal(w.bottomUp.scheduledSupportDays, w.bottomUp.supportDays,
      '10K week ' + w.week + ': scheduledSupportDays must still equal supportDays exactly');
  });
});

test('isolation: Aerobic Base, Maintain & Protect and Speed & Threshold read the unedited generic frequency/destination path', () => {
  const a = app();
  ['base', 'maintain', 'speed'].forEach(purpose => {
    const blk = a.buildBlockWeeks('half', 40, 10, { purpose, availableDays: 6, easyPaceSecPerKm: 400 });
    blk.weeks.forEach(w => assert.equal(w.bottomUp, null,
      purpose + ' week ' + w.week + ': must never reach raceGoalDestinationSolve() -- bottomUp must be null'));
  });
});

test('isolation: session cost/pace still governs supporting-run SIZE, only day COUNT is now selected-days-led', () => {
  // marathonPreparationOutlook()'s own cost-vs-shape distinction is
  // untouched: a slower athlete's individual supporting run is still
  // smaller for the same weekly kilometres. What this correction changes
  // is only that day COUNT no longer shrinks for a slower athlete when
  // real availability could hold more -- see marathonPrescribedFrequency
  // .test.js and marathonMethodology.test.js, both passing unmodified.
  const a = app();
  const cheap = a.marathonPreparationOutlook(80, 15, 300);
  const dear = a.marathonPreparationOutlook(80, 15, 560);
  assert.ok(dear.supportKm < cheap.supportKm,
    'a slower athlete\'s individual supporting run must still be smaller for the same kilometres');
});
