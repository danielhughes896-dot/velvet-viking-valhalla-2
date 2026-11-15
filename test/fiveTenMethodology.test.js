'use strict';
/* THE 5K AND 10K METHODOLOGY, AND THE LONG-RUN STEP FOR EVERY PROGRAMME
 * (founder approval, 15 November 2026).
 *
 *  1  peak week and long-run ranges, aiming for the top of each
 *  2  8 to 16 weeks, the extra weeks in Base; 10K taper 11 days
 *  3  easy runs under 70% of the long run, extra distance to more days
 *  4  the hard-sessions choice: default 2, Developing 1-2, others 2-3,
 *     the third is race pace in the long run on six or more days
 *  5  a taper keeps its race-pace session
 *  6  400m race-pace repeats grow towards 20, inside the session limits
 *  7  every programme: a long run at most 10% (or 1km) over the longest of
 *     the previous four weeks; 15% earned through the weekly review
 *  8  Developing marathon Base: strides, and a hill session earned from week 3
 *  9  a new running day is offered, not imposed
 * 10  a quality session that falls short twice steps back
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

function app(pin){
  const a = loadApp({ pinnedDate: (pin || '2026-11-16') + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  return a;
}
function plan(o){
  const a = app();
  buildPlan(a, Object.assign({ weeks: 12, startDate: '2026-11-16' }, o));
  return a;
}
function direct(dist, vol, weeks, exp, days, choice){
  const a = app();
  a.state.experience = exp;
  if (choice) a.builderQualityChoice = choice;
  const blk = a.buildBlockWeeks(dist, vol, weeks, { purpose: 'race', availableDays: days.length });
  const ds = a.buildDaysFromWeeks(blk, a.addDays('2026-11-16', weeks * 7 - 1),
    { activeDays: days, longRunDay: days[days.length - 1] }, '2026-11-16', true, {});
  return { a, blk, days: ds };
}
const byWeek = ds => ds.reduce((m, d) => { (m[d.week] = m[d.week] || []).push(d); return m; }, {});
const Q = ['interval', 'tempo', 'threshold', 'repetition', 'checkpoint'];
const strong = a => {
  a.weeklyEvidence = () => ({ doneKm: 30, dueKm: 30, done: 4, due: 4, logged: 4, loggedShare: 1, missed: 0,
    overEffort: 0, easyOverEffort: 0, completion: 1, execution: 92, qualityDone: 1, qualityOverEffort: 0,
    qualityShort: 0, pain: 0, niggle: 0, heavyLegs: 0, poorSleep: 0, fatigueStops: 0 });
  a.weeklyInstrumentSignals = () => ({ adaptation: 'ADAPTING', recovery: 'fresh' });
};

/* ------------------------------------------------------------------ 1 */
test('1. the 5K and 10K pathways carry the founder\'s ranges and aim for the top', () => {
  const a = app();
  const want = {
    '5k':  { novice: [[25, 35], [8, 10]], experienced: [[40, 55], [10, 12]], advanced: [[55, 75], [12, 15]] },
    '10k': { novice: [[30, 40], [10, 12]], experienced: [[45, 60], [13, 15]], advanced: [[60, 80], [15, 18]] }
  };
  Object.keys(want).forEach(dk => Object.keys(want[dk]).forEach(exp => {
    const p = a.raceGoalPathway(dk, exp);
    assert.deepEqual([...p.peakRangeKm], want[dk][exp][0], dk + ' ' + exp + ' peak range');
    assert.deepEqual([...p.longRangeKm], want[dk][exp][1], dk + ' ' + exp + ' long range');
    assert.equal(p.buildVolumeKm, want[dk][exp][0][1], 'the block aims for the top of the range');
    assert.equal(p.peakLongKm, want[dk][exp][1][1]);
    assert.equal(a.raceGoalLongCapKm(dk, 'race', exp), want[dk][exp][1][1], 'the range top is the long-run cap');
  }));
  assert.equal(a.RACE_GOAL_LONG_CAP_KM['5k'], 18, 'the absolute backstop, reached only by a long run already run');
  assert.equal(a.RACE_GOAL_LONG_CAP_KM['10k'], 22);
});

test('1. an athlete who already runs longer keeps that long run, held to the backstop, never grown', () => {
  const a = app();
  const p = a.raceGoalPathway('5k', 'experienced');
  assert.equal(a.raceGoalLongDestinationKm('5k', 'experienced', {}, 'peak'), p.peakLongKm);
  assert.equal(a.raceGoalLongDestinationKm('5k', 'experienced', { demonstratedLongKm: 14 }, 'peak'), 14);
  assert.equal(a.raceGoalLongDestinationKm('5k', 'experienced', { demonstratedLongKm: 25 }, 'peak'), 18);
  assert.equal(a.raceGoalLongDestinationKm('half', 'experienced', { demonstratedLongKm: 24 }, 'peak'), 24,
    'the half keeps its own rule');
});

test('1. no 5K or 10K long run passes the level\'s own range top, in any week', () => {
  [['5k', 'novice', 10], ['5k', 'experienced', 12], ['10k', 'novice', 12], ['10k', 'experienced', 15]].forEach(([dk, exp, top]) => {
    [30, 50].forEach(vol => {
      const { days } = direct(dk, vol, 12, exp, [0, 2, 4, 6]);
      days.filter(d => d.type === 'long').forEach(d =>
        assert.ok(d.km <= top, dk + ' ' + exp + ' ' + vol + 'km week ' + d.week + ': long ' + d.km + ' > ' + top));
    });
  });
});

/* ------------------------------------------------------------------ 2 */
test('2. 5K and 10K admit 8 to 16 weeks, and weeks 13 to 16 are Base', () => {
  const a = app();
  ['5k', '10k'].forEach(dk => {
    const b = a.raceGoalRunwayBounds(dk);
    assert.equal(b.min, 8); assert.equal(b.max, 16);
    assert.equal(a.raceGoalAdmission(dk, 16, null, {}).admitted, true);
    assert.equal(a.raceGoalAdmission(dk, 17, null, {}).decision, 'too_far');
    const twelve = a.raceGoalPhaseAllocation(dk, 12, 'experienced');
    [13, 14, 15, 16].forEach(n => {
      const al = a.raceGoalPhaseAllocation(dk, n, 'experienced');
      assert.equal(al.base, twelve.base + (n - 12), n + ' weeks: the extra weeks are Base');
      assert.equal(al.build, twelve.build); assert.equal(al.peak, twelve.peak);
    });
    assert.equal(a.marathonRunwayPlan(14, 30, dk, {}).reason, 'extended_base');
    assert.equal(a.marathonRunwayPlan(17, 30, dk, {}).raceWeeks, 16, 'beyond sixteen the race block starts sixteen weeks out');
  });
  assert.equal(a.raceGoalTaperAnchorDaysFor('10k'), 11);
  assert.equal(a.raceGoalTaperAnchorDaysFor('5k'), 8);
});

/* ------------------------------------------------------------------ 3 */
test('3. easy runs stay under 70% of the long run, and extra distance goes to more days first', () => {
  const a = app();
  assert.equal(a.shortRaceEasyCeilingKm(12), 8);
  assert.equal(a.shortRaceEasyCeilingKm(6), 5, 'never under the 5km minimum');
  const { blk, days } = direct('5k', 35, 12, 'experienced', [0, 1, 2, 3, 4, 6]);
  const W = byWeek(days);
  Object.keys(W).forEach(w => {
    const list = W[w];
    if (list.some(d => d.type === 'race')) return;
    const L = Math.max(0, ...list.filter(d => d.type === 'long').map(d => d.km));
    const wk = blk.weeks.find(x => x.week === +w);
    if (!L || (wk && wk.easyCeilingHeldForDeclared)) return;
    list.filter(d => d.type === 'easy').forEach(d =>
      assert.ok(d.km <= a.shortRaceEasyCeilingKm(L) + 1e-9, 'week ' + w + ': easy ' + d.km + ' beside a ' + L + 'km long run'));
  });
});

test('3. the declared week is not given up to the ceiling: the easy runs hold it', () => {
  const { blk, days } = direct('5k', 45, 12, 'experienced', [0, 1, 2, 4, 6]);
  const wk1 = days.filter(d => d.week === 1).reduce((t, d) => t + d.km, 0);
  assert.ok(wk1 >= Math.min(45, blk.weeks[0].volume) - 3.5, 'week one ' + wk1 + 'km');
});

test('3. the Make Room sheet reads the same ceiling, and offers another day', () => {
  const a = app();
  const fit = a.weekFitCheck({ weekKm: 50, longKm: 12, distKey: '5k', experience: 'experienced', declaredDays: 4, availDays: 6 });
  assert.equal(fit.kind, 'too_long');
  assert.equal(fit.easyMaxKm, 8);
  assert.ok(fit.addDay && fit.addDay.days > 4, 'another available day is offered');
  const c = a.weekFitSheetCopy(fit);
  assert.match(c.say, /For a 5K, easy runs stay at 8km or less/);
  const half = a.weekFitCheck({ weekKm: 50, longKm: 12, distKey: 'half', experience: 'experienced', declaredDays: 4, availDays: 6 });
  assert.equal(half.easyMaxKm, 12, 'the half keeps easy runs up to the long run');
});

/* ------------------------------------------------------------------ 4 */
test('4. the hard-sessions choice: default 2, Developing 1-2, Established and Advanced 2-3', () => {
  const a = app();
  assert.equal(a.SHORT_RACE_QUALITY_DEFAULT, 2);
  a.builderQualityChoice = null;
  assert.equal(a.shortRaceQualityChoice('novice'), 2);
  assert.equal(a.shortRaceQualityChoice('advanced'), 2);
  a.builderQualityChoice = 1;
  assert.equal(a.shortRaceQualityChoice('novice'), 1);
  assert.equal(a.shortRaceQualityChoice('experienced'), 2, 'two is the minimum for Established');
  a.builderQualityChoice = 3;
  assert.equal(a.shortRaceQualityChoice('novice'), 2, 'Developing chooses one or two');
  assert.equal(a.shortRaceQualityChoice('advanced'), 3);
});

test('4. the week has to hold the choice: two need four days, the third is race pace in the long run', () => {
  const a = app();
  a.builderQualityChoice = 3;
  assert.equal(a.shortRaceWeekQualitySlots('advanced', 'Base', 6), 1, 'Base keeps one');
  assert.equal(a.shortRaceWeekQualitySlots('advanced', 'Build', 3), 1);
  assert.equal(a.shortRaceWeekQualitySlots('advanced', 'Build', 4), 2);
  assert.equal(a.shortRaceWeekQualitySlots('advanced', 'Peak', 6), 2, 'never more than two standalone sessions');
  assert.equal(a.shortRaceLongCarriesPace('advanced', 'Peak', 6), true);
  assert.equal(a.shortRaceLongCarriesPace('advanced', 'Peak', 5), false, 'a third only on six or more days');
  const { days } = direct('10k', 60, 12, 'advanced', [0, 1, 2, 3, 4, 6], 3);
  assert.ok(days.some(d => d.type === 'long' && /Goal Pace/.test(d.desc)), 'the long run carries race pace');
  const W = byWeek(days);
  Object.keys(W).forEach(w => assert.ok(W[w].filter(d => Q.includes(d.type)).length <= 2, 'week ' + w));
});

test('4. Build and Peak give the default two sessions on four days or more', () => {
  const { blk, days } = direct('10k', 45, 12, 'experienced', [0, 2, 4, 6]);
  const two = blk.weeks.filter(w => (w.phase === 'Build' || w.phase === 'Peak') && !w.isCutback && !w.isCheckpoint)
    .filter(w => days.filter(d => d.week === w.week && Q.includes(d.type)).length === 2).length;
  assert.ok(two >= 4, 'two-session weeks: ' + two);
});

/* ------------------------------------------------------------------ 5 */
test('5. a 5K taper keeps a race-pace session and its runs', () => {
  const { blk, days } = direct('5k', 45, 12, 'experienced', [0, 1, 2, 4, 6]);
  const tw = blk.weeks.find(w => w.isTaper).week;
  const list = days.filter(d => d.week === tw && d.km > 0);
  assert.ok(list.some(d => Q.includes(d.type) && !/Strides/.test(d.title)), list.map(d => d.title).join(' | '));
});

/* ------------------------------------------------------------------ 6 */
test('6. 400m race-pace repeats grow towards 20, inside the fast-work limit', () => {
  const a = app();
  assert.ok(a.FIVEK_INTERVAL_POOL.Peak.includes(a.structRacePace400s));
  assert.ok(a.TENK_INTERVAL_POOL.Peak.includes(a.structRacePace400s));
  assert.equal(a.structRacePace400s(1).reps, 20);
  assert.equal(a.structRacePace400s(0).reps, 8);
  assert.equal(a.shortRaceFastWorkCap({ reps: 20, m: 400, t: 'goalpace' }, 'interval', 100, '5k', 'race').reps, 20);
  assert.equal(a.shortRaceFastWorkCap({ reps: 20, m: 400, t: 'goalpace' }, 'interval', 50, '5k', 'race').reps, 10);
  assert.equal(a.shortRaceFastWorkCap({ reps: 20, m: 400, t: 'goalpace' }, 'interval', 50, 'half', 'race').reps, 20,
    'other programmes keep their own sizing');
  assert.equal(a.shortRaceFastWorkCap({ type: 'threshold', km: 8 }, 'tempo', 50, '10k', 'race').km, 5);
});

/* ------------------------------------------------------------------ 7 */
/* Option A (founder, 15 November 2026): Half and Marathon step at 15% (or
   1.5km) as standard; 5K, 10K and Base at 10% (or 1km), 15% earned. */
test('7. every programme: no long run steps more than its standard step over the previous four weeks', () => {
  const a = app();
  assert.equal(a.longRunStepCapKm(12, false), 13);
  assert.equal(a.longRunStepCapKm(9, false), 10);
  assert.equal(a.longRunStepCapKm(28, false), 30);
  assert.equal(a.longRunStepCapKm(12, true), 14, 'the earned step is a kilometre more');
  [['full', 0, 16, 'novice', [1, 3, 6]], ['full', 40, 16, 'experienced', [0, 1, 3, 4, 6]],
   ['half', 30, 12, 'experienced', [1, 3, 4, 6]], ['10k', 30, 12, 'novice', [1, 3, 6]],
   ['5k', 20, 12, 'novice', [0, 2, 4, 6]]].forEach(([dk, vol, weeks, exp, ad]) => {
    const p = plan({ distanceKey: dk, volume: vol, weeks, experience: exp, schedule: { activeDays: ad, longRunDay: 6 } });
    const L = {};
    p.state.days.forEach(d => { if (d.type === 'long' && d.km > 0) L[d.week] = d.km; });
    /* The marathon's one culminating long run is exempt (founder: "I'm not
       concerned with the 22-28 jump"). */
    const culm = dk === 'full' ? +Object.keys(L).reduce((m, w) => (L[w] > (L[m] || 0) ? w : m), Object.keys(L)[0]) : null;
    Object.keys(L).map(Number).sort((x, y) => x - y).forEach(w => {
      if (w === culm) return;
      const prior = Math.max(0, ...[1, 2, 3, 4].map(k => L[w - k] || 0));
      if (prior > 0) assert.ok(L[w] <= p.longRunStepCapKm(prior, p.longRunStepStandardIsEarned(dk)),
        dk + ' ' + vol + 'km week ' + w + ': ' + L[w] + 'km after ' + prior + 'km');
    });
  });
});

test('7. the weekly review offers the earned step when the athlete is adapting well', () => {
  /* 5K, 10K and Base step at 10% with 15% earned; Half and Marathon already
     step at 15% (Option A). */
  let a = null, lr = null;
  for (const [dk, vol] of [['10k', 30], ['10k', 40], ['5k', 30], ['10k', 20], ['5k', 20]]){
    a = plan({ distanceKey: dk, volume: vol, weeks: 12, experience: 'experienced', schedule: { activeDays: [0, 2, 4, 6], longRunDay: 6 } });
    lr = a.state.days.find(d => d.type === 'long' && d.stepWantKm > d.km && d.week >= 3);
    if (lr) break;
  }
  assert.ok(lr, 'a capped long run exists');
  const W = lr.week;
  a.todayStr = () => a.state.days.filter(d => d.week === W).map(d => d.date).sort()[0];
  strong(a);
  const rv = a.weeklyCoachingReview(W);
  assert.equal(rv.kind, 'progress');
  assert.ok(rv.reasons.includes('long_run_earned'), rv.reasons.join());
  assert.ok(rv.longEarnedKm > lr.km && rv.longEarnedKm <= lr.stepWantKm);
  const c = a.weeklyReviewCopy(rv);
  assert.match(c.why, /your long run can take a bigger step this week/);
  assert.equal(c.yes, 'Accept Progression');
  a.answerWeeklyReview(rv, true);
  assert.equal(a.state.days.find(d => d.id === lr.id).km, rv.longEarnedKm);
});

/* ------------------------------------------------------------------ 8 */
test('8. Developing marathon Base: strides, and a hill session earned from week three', () => {
  const a = plan({ distanceKey: 'full', volume: 0, weeks: 16, experience: 'novice', schedule: { activeDays: [1, 3, 6], longRunDay: 6 } });
  [1, 2, 3].forEach(w => assert.ok(a.state.days.some(d => d.week === w && d.baseStrides && /strides/.test(d.desc)), 'week ' + w));
  assert.ok(!a.state.days.some(d => d.week < 3 && d.baseHillCandidate), 'no hills before week three');
  a.todayStr = () => a.state.days.filter(d => d.week === 3).map(d => d.date).sort()[0];
  strong(a);
  const rv = a.weeklyCoachingReview(3);
  assert.ok(rv.reasons.includes('base_hills'), rv.kind + ' ' + rv.reasons.join());
  assert.match(a.weeklyReviewCopy(rv).why, /becomes a short hill session/);
  a.answerWeeklyReview(rv, true);
  assert.ok(a.state.days.some(d => d.week === 3 && d.baseHills && d.type === 'interval'));
});

test('8. an athlete who logs nothing stays on strides', () => {
  const a = plan({ distanceKey: 'full', volume: 0, weeks: 16, experience: 'novice', schedule: { activeDays: [1, 3, 6], longRunDay: 6 } });
  a.todayStr = () => a.state.days.filter(d => d.week === 3).map(d => d.date).sort()[0];
  const rv = a.weeklyCoachingReview(3);
  assert.notEqual(rv.kind, 'progress');
  assert.ok(!(rv.reasons || []).includes('base_hills'));
});

/* ------------------------------------------------------------------ 9 */
test('9. a fourth run is offered, and keeping three leaves the long run as planned', () => {
  const a = plan({ distanceKey: '5k', volume: 18, weeks: 12, experience: 'novice', schedule: { activeDays: [0, 2, 4, 6], longRunDay: 6 } });
  const count = w => a.state.days.filter(d => d.week === w && d.km > 0).length;
  const W = [2, 3, 4, 5, 6].find(w => count(w) > Math.max(...[...Array(w - 1).keys()].map(k => count(k + 1))));
  assert.ok(W, 'a week adds a run');
  a.todayStr = () => a.state.days.filter(d => d.week === W).map(d => d.date).sort()[0];
  strong(a);
  const rv = a.weeklyCoachingReview(W);
  assert.equal(rv.kind, 'new_run');
  const c = a.weeklyReviewCopy(rv);
  assert.equal(c.yes, 'Add the Fourth Run');
  assert.equal(c.no, 'Keep Three Runs');
  const longBefore = a.state.days.find(d => d.week === W && d.type === 'long').km;
  a.answerWeeklyReview(rv, false);
  assert.equal(count(W), 3);
  assert.equal(a.state.days.find(d => d.week === W && d.type === 'long').km, longBefore);
});

/* ----------------------------------------------------------------- 10 */
test('10. a quality session that falls short two weeks running steps back', () => {
  const a = plan({ distanceKey: '10k', volume: 40, weeks: 12, experience: 'experienced', schedule: { activeDays: [0, 2, 4, 6], longRunDay: 6 } });
  const W = 6;
  a.todayStr = () => a.state.days.filter(d => d.week === W).map(d => d.date).sort()[0];
  a.weeklyEvidence = () => ({ doneKm: 40, dueKm: 40, done: 4, due: 4, logged: 4, loggedShare: 1, missed: 0,
    overEffort: 1, easyOverEffort: 0, completion: 1, execution: 70, qualityDone: 1, qualityOverEffort: 1,
    qualityExecution: 60, qualityShort: 1, pain: 0, niggle: 0, heavyLegs: 0, poorSleep: 0, fatigueStops: 0 });
  a.weeklyInstrumentSignals = () => ({ adaptation: 'STABLE', recovery: 'fresh' });
  a.weeklyReviewStore()[a.weeklyReviewKey(W - 1)] = { kind: 'quality', week: W - 1, decision: 'accepted' };
  const rv = a.weeklyCoachingReview(W);
  assert.equal(rv.kind, 'quality_back');
  const c = a.weeklyReviewCopy(rv);
  assert.equal(c.yes, 'Step the Session Back');
  const before = a.state.days.filter(d => d.week === W && Q.includes(d.type)).reduce((t, d) => t + d.km, 0);
  a.answerWeeklyReview(rv, true);
  const after = a.state.days.filter(d => d.week === W && Q.includes(d.type)).reduce((t, d) => t + d.km, 0);
  assert.ok(after < before, before + ' -> ' + after);
});
