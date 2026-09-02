'use strict';
/* THE 5K/10K RACE GOAL CORRECTION -- REGRESSION SUITE.
 * ===========================================================================
 * The continuation of the destination-led Race Goal correction already
 * completed for Half Marathon and Marathon: 5K and 10K now have their own
 * locked pathway table, their own eight-to-twelve-week dedicated window, an
 * evidence-first entry state that a typed weekly figure cannot override, a
 * real experience-driven pathway selection, their own event-anchored taper
 * (D-5 / D-7) and their own event-emphasis quality pools -- reusing the exact
 * generic bottom-up authorities already proven for Half/Marathon rather than
 * inventing a second system.
 *
 * What these tests hold, matching the HQ directive's own numbered findings:
 *   1. The pathway table matches HQ's approved volume/LR standards.
 *   2. Experience is a real pathway selector (the RACE_GOAL_PATHWAY gap).
 *   3. Evidence outranks the Experience label in both directions (§17).
 *   4. The runway window is 8-12 weeks, not the half/marathon's 10-15.
 *   5. §7's on-ramp defect (an unenforced ~83%/week jump) cannot recur: a
 *      too-short runway refuses rather than manufacturing an unsafe jump.
 *   6. Twelve weeks shows a genuine Base -> Build -> Peak-holds progression,
 *      not a plateau and not a flat entry-equals-destination table.
 *   7. 10K's New long run is exactly race distance, never below it, and the
 *      full ladder is at least as strong as 5K's at every pathway level.
 *   8. 5K and 10K draw from separate event-emphasis quality pools.
 *   9. The taper is anchored to the event at each distance's own number of
 *      days, not the half's ten and not a flat two-week block.
 *  10. Half, Marathon and the other three products are untouched.
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
/* Real completed sessions, so demonstratedSustainableVolume()/
   demonstratedLongRunKm() read this exactly as they read a live athlete --
   the same pattern test/audit/raceGoalReachability.js already established. */
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

/* ---------- 1. THE PATHWAY TABLE MATCHES HQ'S APPROVED STANDARDS ---------- */

test('5K pathway: start/useful-peak volume and LR ladder match HQ\'s table', () => {
  const a = app();
  const nov = a.raceGoalPathway('5k', 'novice');
  const exp = a.raceGoalPathway('5k', 'experienced');
  const adv = a.raceGoalPathway('5k', 'advanced');
  assert.equal(nov.entryVolumeKm, 15); assert.equal(nov.buildVolumeKm, 30);
  assert.equal(exp.entryVolumeKm, 25); assert.equal(exp.buildVolumeKm, 50);
  assert.equal(adv.entryVolumeKm, 35); assert.equal(adv.buildVolumeKm, 70);
  assert.equal(nov.peakLongKm, 8); assert.equal(exp.peakLongKm, 12); assert.equal(adv.peakLongKm, 16);
});

test('10K pathway: start/useful-peak volume sit above 5K at Experienced/Advanced', () => {
  const a = app();
  const nov = a.raceGoalPathway('10k', 'novice');
  const exp = a.raceGoalPathway('10k', 'experienced');
  const adv = a.raceGoalPathway('10k', 'advanced');
  assert.equal(nov.entryVolumeKm, 15, '10K New opens at the same entry as 5K New');
  assert.equal(exp.entryVolumeKm, 30); assert.equal(exp.buildVolumeKm, 60);
  assert.equal(adv.entryVolumeKm, 45); assert.equal(adv.buildVolumeKm, 75);
});

test('7. 10K New long run is exactly race distance, never below it', () => {
  const a = app();
  const p = a.raceGoalPathway('10k', 'novice');
  assert.equal(p.peakLongKm, 10, 'HQ explicitly rejected an 8km New 10K long run as below race distance');
  assert.ok(p.peakLongKm >= a.DISTANCE_PROFILES['10k'].raceKm);
});

test('7. the 10K ladder is at least as strong as 5K\'s at every pathway level', () => {
  const a = app();
  ['novice', 'experienced', 'advanced'].forEach(exp => {
    const fivek = a.raceGoalPathway('5k', exp), tenk = a.raceGoalPathway('10k', exp);
    assert.ok(tenk.peakLongKm >= fivek.peakLongKm,
      exp + ': 10K long run (' + tenk.peakLongKm + ') must be at least 5K\'s (' + fivek.peakLongKm + ')');
    assert.ok(tenk.buildVolumeKm >= fivek.buildVolumeKm);
  });
});

/* ---------- 2. EXPERIENCE IS A REAL PATHWAY SELECTOR ---------- */

test('2. experience actually selects a different 5K/10K pathway', () => {
  const a = app();
  ['5k', '10k'].forEach(dk => {
    const nov = a.raceGoalPathway(dk, 'novice');
    const exp = a.raceGoalPathway(dk, 'experienced');
    const adv = a.raceGoalPathway(dk, 'advanced');
    assert.notEqual(nov.buildVolumeKm, exp.buildVolumeKm);
    assert.notEqual(exp.buildVolumeKm, adv.buildVolumeKm);
    assert.notEqual(nov.peakLongKm, adv.peakLongKm);
  });
});

/* ---------- 3. EVIDENCE OUTRANKS THE EXPERIENCE LABEL (§17) ---------- */

test('3. strong evidence for a New-labelled athlete is not evidence-blind refused', () => {
  const a = app();
  withHistory(a, 55, 14, 16);
  a.state.experience = 'novice';
  const pre = a.raceGoalPreparationOutlook('10k', 'novice', 8, {});
  assert.notEqual(pre.verdict, 'INSUFFICIENT',
    'a New label must not throw away a demonstrated 55km/14km-long-run week');
  assert.equal(pre.entrySource, 'demonstrated');
});

test('3. weak evidence for an Advanced-labelled athlete is not evidence-blind admitted', () => {
  const a = app();
  withHistory(a, 10, 4, 10);
  a.state.experience = 'advanced';
  const pre = a.raceGoalPreparationOutlook('10k', 'advanced', 8, {});
  assert.equal(pre.entrySource, 'demonstrated',
    'demonstrated evidence must still govern even under an Advanced label');
  assert.ok(pre.entryKm < a.raceGoalPathway('10k', 'advanced').entryVolumeKm,
    'the low demonstrated entry must not be silently replaced by the Advanced pathway\'s own');
});

/* ---------- 4. THE RUNWAY WINDOW IS 8-12 WEEKS ---------- */

test('4. 5K/10K admission window is eight to twelve weeks, not ten to fifteen', () => {
  const a = app();
  ['5k', '10k'].forEach(dk => {
    const b = a.raceGoalRunwayBounds(dk);
    assert.equal(b.min, 8); assert.equal(b.max, 12);
    assert.equal(a.raceGoalAdmission(dk, 7, null, {}).admitted, false);
    assert.equal(a.raceGoalAdmission(dk, 7, null, {}).decision, 'too_short');
    assert.equal(a.raceGoalAdmission(dk, 8, null, {}).admitted, true);
    assert.equal(a.raceGoalAdmission(dk, 13, null, {}).admitted, false);
    assert.equal(a.raceGoalAdmission(dk, 13, null, {}).decision, 'too_far');
  });
});

test('4. half/marathon admission window is unchanged at ten to fifteen', () => {
  const a = app();
  const h = a.raceGoalRunwayBounds('half'), f = a.raceGoalRunwayBounds('full');
  assert.equal(h.min, 10); assert.equal(h.max, 15);
  assert.equal(f.min, 10); assert.equal(f.max, 15);
});

/* ---------- 5. §7's ON-RAMP DEFECT CANNOT RECUR ---------- */

test('5. a runway too short for 5K Race Goal refuses rather than building an unsafe on-ramp', () => {
  const a = app();
  const v = a.raceProgrammeViability('5k', 16, 2, {});
  assert.equal(v.viable, false);
  assert.equal(v.classification, 'runway_too_short');
  assert.equal(v.authority, 'race_goal_admission');
  const route = a.athletePathway('5k', 16, 2, {});
  assert.notEqual(route.route, 'foundation_then_on_ramp_then_race',
    'the too-short runway must not fall through to on-ramp construction at all');
});

/* ---------- 6. TWELVE WEEKS DOES NOT PLATEAU ---------- */

test('6. a 12-week 5K/10K block shows genuine Base -> Build -> Peak-holds long-run development', () => {
  const a = app();
  ['5k', '10k'].forEach(dk => {
    const blk = a.buildBlockWeeks(dk, null, 12,
      { purpose: 'race', experience: 'experienced', availableDays: 4, easyPaceSecPerKm: 330 });
    const byPhase = {};
    blk.weeks.forEach(w => { (byPhase[w.phase] = byPhase[w.phase] || []).push(w.longTarget); });
    const base1 = byPhase.Base[0], peak = byPhase.Peak;
    assert.ok(peak[0] > base1, dk + ': the long run must develop from Base to Peak, not enter flat');
    const dest = a.raceGoalPathway(dk, 'experienced').peakLongKm;
    assert.equal(peak[peak.length - 1], dest, dk + ': Peak must hold at the pathway\'s own destination');
    assert.equal(peak[0], peak[peak.length - 1], dk + ': Peak must hold flat, not keep climbing');
  });
});

test('6. the phase geometry for an 8-12 week 5K/10K runway matches the locked table', () => {
  const a = app();
  const cases = { 8: { base: 1, build: 3, peak: 2 }, 12: { base: 2, build: 6, peak: 2 } };
  Object.keys(cases).forEach(n => {
    const alloc = a.raceGoalPhaseAllocation('5k', Number(n), 'novice');
    assert.equal(alloc.base, cases[n].base, n + 'w base');
    assert.equal(alloc.build, cases[n].build, n + 'w build');
    assert.equal(alloc.peak, cases[n].peak, n + 'w peak');
  });
});

/* ---------- 8. SEPARATE 5K/10K EVENT-EMPHASIS AUTHORITY ---------- */

test('8. 5K and 10K draw from separate interval/tempo pools, and half is unaffected', () => {
  const a = app();
  assert.notEqual(a.intervalPoolFor('race', '5k'), a.intervalPoolFor('race', '10k'));
  assert.notEqual(a.tempoPoolFor('race', '5k'), a.tempoPoolFor('race', '10k'));
  assert.equal(a.intervalPoolFor('race', 'half'), a.HALF_INTERVAL_POOL);
  /* 10K's principal quality thread is sustained threshold; 5K's is not. */
  assert.ok(a.tempoPoolFor('race', '10k').Build.includes(a.structThresholdContinuous));
  assert.ok(!a.tempoPoolFor('race', '5k').Build.includes(a.structThresholdContinuous));
});

test('8. non-race purposes at 5K/10K keep the shared pools, unchanged', () => {
  const a = app();
  ['maintain', 'base', 'speed'].forEach(p => {
    assert.equal(a.intervalPoolFor(p, '5k'), a.INTERVAL_STRUCTURE_POOL);
    assert.equal(a.tempoPoolFor(p, '10k'), a.TEMPO_STRUCTURE_POOL);
  });
});

/* ---------- 9. EVENT-ANCHORED TAPER, NOT A FLAT TWO WEEKS ---------- */

test('9. 5K tapers at D-8 and 10K at D-9, distinct from the half\'s D-10', () => {
  const a = app();
  /* Not the audit's literal five/seven-day hypothesis: race week is a fixed
     seven days for every distance (§16, untouched) and scaled by its own
     separate mechanism, so an anchor at or below seven touches no day
     applyEventTaper() can see and is inert -- measured directly below. Eight
     and nine are the anchors that actually clear race week and produce a
     genuine pre-race-week split, ordered the same way the hypothesis was:
     10K longer than 5K, both shorter than the half's ten. */
  assert.equal(a.raceGoalTaperAnchorDaysFor('5k'), 8);
  assert.equal(a.raceGoalTaperAnchorDaysFor('10k'), 9);
  assert.ok(a.raceGoalTaperAnchorDaysFor('5k') > 7, 'the anchor must clear race week\'s fixed seven days');
  assert.ok(a.raceGoalTaperAnchorDaysFor('10k') > 7);
  assert.equal(a.raceGoalTaperAnchorDaysFor('half'), a.HALF_TAPER_ANCHOR_DAYS);
  assert.equal(a.blockArcFor('race', 12, '5k', 'novice').taperAnchorDays, 8);
  assert.equal(a.blockArcFor('race', 12, '10k', 'novice').taperAnchorDays, 9);
});

test('9. the day-level taper genuinely reaches into the week before race week', () => {
  const a = app();
  const N = 12;
  ['5k', '10k'].forEach(dk => {
    const blk = a.buildBlockWeeks(dk, null, N,
      { purpose: 'race', experience: 'experienced', availableDays: 4, easyPaceSecPerKm: 330 });
    const raceDate = a.addDays(a.addDays(TODAY.slice(0, 10), -a.isoWeekday(TODAY.slice(0, 10))), N * 7 - 1);
    a.buildDaysFromWeeks(blk, raceDate, { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 },
      TODAY.slice(0, 10), true, { easyPaceSecPerKm: 330 });
    const taperWeek = blk.weeks.find(w => w.phase === 'Taper');
    assert.ok(taperWeek.eventTaperApplied,
      dk + ': the week before race week must actually be touched by the event taper');
    const raceWeek = blk.weeks.find(w => w.isRace);
    assert.ok(!raceWeek.eventTaperApplied, dk + ': race week keeps its own separate architecture');
  });
});

/* ---------- FOUND DURING VERIFICATION: raceGoalReadiness()'s specificity
   dimension only counts long-run-embedded goal segments (hasGoalSegment),
   which is threshold/endurance machinery by construction and structurally
   zero for 5K/10K's speed emphasis -- their race-specific work lives in the
   quality session instead (§13). Left unguarded this capped every 5K/10K
   programme's readiness at INSUFFICIENT regardless of how well it was
   built. ---------- */

test('raceGoalReadiness excludes the long-run specificity dimension for 5K/10K, keeps it for half', () => {
  const a = app();
  const blk = a.buildBlockWeeks('5k', null, 12,
    { purpose: 'race', experience: 'novice', availableDays: 3, easyPaceSecPerKm: 330 });
  const r = a.raceGoalReadiness('5k', 'novice', blk);
  assert.ok(!r.dimensions.some(d => d.key === 'specificity'),
    '5K readiness must not carry a dimension it structurally cannot satisfy');
  const blkH = a.buildBlockWeeks('half', null, 15,
    { purpose: 'race', experience: 'novice', availableDays: 4, easyPaceSecPerKm: 330 });
  const rH = a.raceGoalReadiness('half', 'novice', blkH);
  assert.ok(rH.dimensions.some(d => d.key === 'specificity'),
    'the half must keep its specificity dimension, unchanged');
});

/* ---------- 10. HALF, MARATHON AND THE OTHER PRODUCTS ARE UNTOUCHED ---------- */

test('10. half marathon\'s own pathway table and admission window are unchanged', () => {
  const a = app();
  const p = a.raceGoalPathway('half', 'novice');
  assert.equal(p.entryVolumeKm, 15); assert.equal(p.buildVolumeKm, 30);
  assert.equal(p.peakLongKm, 16);
  assert.equal(a.dedicatedWeeksFor('half'), 15);
  assert.equal(a.dedicatedWeeksFor('full'), 15);
});

test('10. non-race purposes never consult the 5K/10K pathway table', () => {
  const a = app();
  ['maintain', 'base', 'speed'].forEach(p => {
    assert.equal(a.usesBottomUpArc(p, '5k'), false);
    assert.equal(a.usesBottomUpArc(p, '10k'), false);
    assert.equal(a.raceGoalPathwayEntryKm(p, '5k', 'novice'), null);
  });
  assert.equal(a.usesBottomUpArc('race', 'ultra'), false, 'ultra keeps the legacy top-down arc');
});

test('10. the top-level runway/admission gate now covers 5K and 10K alongside half/marathon', () => {
  const a = app();
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /distanceKey === '5k' \|\|\s*\n?\s*distanceKey === '10k'/,
    'the widened gate must actually appear in the generation call site');
});
