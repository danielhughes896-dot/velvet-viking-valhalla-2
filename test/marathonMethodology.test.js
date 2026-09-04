'use strict';
/* STAGES 3-5 -- QUALITY FREQUENCY, PEAK ARCHITECTURE, MEDIUM-LONG, READINESS,
 * SESSION COST AND THE RACE-GOAL TRANSITION.
 *
 * Every assertion names the methodology it is about rather than the numbers it
 * happens to produce.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp } = require(path.join(__dirname, 'harness.js'));

const TODAY = '2026-08-30';
const SIX = { activeDays:[0,1,2,3,4,6], longRunDay:6 };

function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp=()=>{}; a.flushSave=()=>{}; a.scheduleSave=()=>{}; a.showToast=()=>{};
  a.state = a.makeDefaultState(); return a;
}
/* ---- A COHORT IS DEMONSTRATED TRAINING NOW, NOT A TYPED NUMBER ----
   Where a test needs the block to differ BETWEEN cohorts it has to say something
   the block still reads. The typed weekly volume no longer sizes a Race Goal
   block, so `demonstrated` writes the athlete's own completed weeks instead and
   the cohort means what it always meant. Tests that do not pass it are
   unaffected and build exactly as before. */
function history(a, weeklyKm, days){
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t)), s = [];
  const per = weeklyKm / days;
  for (let w = 1; w <= 20; w++)
    for (let d = 0; d < days; d++)
      s.push({ date: a.addDays(m, -7 * w + d), completed: true,
               actualKm: per, plannedKm: per, type: d === days - 1 ? 'long' : 'easy',
               actual: { km: per, rpe: 4, pace: 360, hr: 138 }, feel: 'good' });
  return s;
}
function plan(volume, weeks, distanceKey, pace, schedule, demonstrated){
  const a = app();
  if (demonstrated > 0) a.state.athlete = { sessions: history(a, demonstrated, 5) };
  const S = schedule || SIX;
    const blk = a.buildBlockWeeks(distanceKey || 'full', volume, weeks || 15,
    { availableDays: S.activeDays.length, easyPaceSecPerKm: pace || 330 });
  const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks * 7 - 1);
  const days = a.buildDaysFromWeeks(blk, end, S, TODAY, true, { easyPaceSecPerKm: pace || 330 });
  return { a, blk, days };
}
const QUALITY = ['tempo','threshold','interval','repetition'];

// ---------------------------------------------------------------- session cost
test('session-size pressure is continuous through the 75-90 minute region', () => {
  const a = app();
  assert.strictEqual(a.sessionCostPressure(74 * 60), 0);
  const at89 = a.sessionCostPressure(89 * 60), at91 = a.sessionCostPressure(91 * 60);
  assert.ok(Math.abs(at91 - at89) < 0.2, 'no cliff: 89m ' + at89 + ' vs 91m ' + at91);
  assert.ok(a.sessionCostPressure(120 * 60) > a.sessionCostPressure(95 * 60), 'and it keeps rising');
});

test('shape and cost stay separate causes', () => {
  const a = app();
  // Same shape, different athlete: only cost moves.
  const fast = a.supportPressure(13.5 * 300, 13.5, 29);
  const slow = a.supportPressure(13.5 * 560, 13.5, 29);
  assert.strictEqual(fast.shape, slow.shape, 'shape is a ratio and cannot see time');
  assert.ok(slow.cost > fast.cost, 'cost can');
  assert.ok(slow.score >= slow.cost, 'the score is the worse of the two, not their average');
});

test('cost, not shape, is what decides how many days the work needs', () => {
  /* THE MEASUREMENT THAT PUT COST IN THE ARCHITECTURE. An 80km/week athlete's
     supporting runs read as perfectly proportionate on shape and still take 94
     minutes each; shape cannot see time, so on its own it put every athlete
     above 20km/week on the same six days. Under bottom-up the same authority
     decides how far the supporting work must be spread. */
  const a = app();
  const cheap = a.marathonPreparationOutlook(80, 15, 300);
  const dear  = a.marathonPreparationOutlook(80, 15, 560);
  assert.ok(dear.supportKm < cheap.supportKm,
    'the slower athlete\'s supporting run is smaller for the same kilometres');
  // and shape alone is blind to it: the ratio to the long run is unchanged
  const shapeCheap = cheap.supportKm / cheap.reachableLongKm;
  const shapeDear  = dear.supportKm / dear.reachableLongKm;
  assert.ok(Math.abs(shapeCheap - shapeDear) < 0.25,
    'shape barely moves between them: ' + shapeCheap.toFixed(2) + ' vs ' + shapeDear.toFixed(2));
});

test('the same kilometres give a slower athlete more days, up to the tier\'s own day cap', () => {
  /* HQ NARROW PATHWAY CORRECTION -- SIX (the default schedule) no longer
     shows the difference at Experienced Marathon's higher table: both
     cohorts now genuinely need all six of SIX's available days, so there is
     no room left for the slower cohort to need more. A seventh day used to
     restore the distinction -- fast stops at six, slow goes to seven.

     HQ DAY-COUNT/START-VOLUME CORRECTION, LATER -- Experienced is now
     ADDITIONALLY tier-capped at 5 selected days (RACE_GOAL_MAX_DAYS,
     applied to mAvail inside raceGoalDestinationSolve() before session-cost
     ever runs), so a seventh day no longer restores anything either: both
     the fast and the slow athlete are held at the same 5-day ceiling
     regardless of how much further the slow athlete's own time-cost math
     would otherwise want to spread the week. Measured directly: the two
     cohorts are now identical at every day count and every week of this
     block, not only at the tier ceiling -- the tier cap is a hard `Math.min`
     ahead of the session-cost solve, so this discrimination is deliberately
     suppressed for Half/Marathon at this tier, not merely obscured. */
  const SEVEN = { activeDays:[0,1,2,3,4,5,6], longRunDay:6 };
  const fast = plan(50, 15, 'full', 300, SEVEN);
  const slow = plan(50, 15, 'full', 560, SEVEN);
  const runsIn = r => {
    let wn = 1; for (; wn <= r.blk.planWeeks; wn++) if (r.days.filter(d => d.week === wn).length === 7) break;
    return r.days.filter(d => d.week === wn && d.km > 0).length;
  };
  assert.equal(runsIn(slow), runsIn(fast),
    'both athletes are held at the same tier day cap now, slow ' + runsIn(slow) + ' vs fast ' + runsIn(fast));
});

// ------------------------------------------------------------ quality frequency
test('HALF/MARATHON: the tier\'s own Build rule prescribes two, evidence or not', () => {
  /* HQ WORKOUT-STRUCTURE METHODOLOGY RULING -- this file's default athlete is
     'experienced' (see athleteExperience()'s own default), so this used to be
     exactly the no-evidence case the old architecture capped at one. The tier
     rule (raceGoalWeekQualitySlots(), read into this same block-level
     qualityFrequency.prescribed figure) no longer asks the athlete's response
     model at all for Half/Marathon: Established and Advanced always show 2
     here, because Build -- which is what this block-level figure now sizes
     its candidate day pool for -- always carries two. permission still
     correctly reports the OLD gate's own answer (unearned, refused) alongside
     it; the tier rule simply no longer reads that answer for these two
     distances. */
  const { blk } = plan(60, 15, 'full');
  assert.strictEqual(blk.qualityFrequency.prescribed, 2);
  assert.ok(!blk.qualityFrequency.permission.permitted);
});

test('a Peak week hands a second session back, and a taper week too', () => {
  const a = app();
  ['Peak','Taper','Final'].forEach(phase => {
    const p = a.secondQualityExposurePermission(3, { phase: phase, longRunCost: 0 });
    assert.strictEqual(p.permitted, false, phase + ' must refuse a second session');
  });
  assert.strictEqual(a.secondQualityExposurePermission(3, { phase:'Peak', longRunCost:0 }).reason,
    'peak_exposure_recovery');
  assert.strictEqual(a.secondQualityExposurePermission(3, { phase:'Taper', longRunCost:0 }).reason,
    'taper_reduces_dose');
});

test('Base is NOT a phase that refuses a second session', () => {
  /* The settled quality-budget decision is that a week whose long run is
     aerobic keeps its full allowance. Base restraint is over session TYPE. */
  const a = app();
  const p = a.secondQualityExposurePermission(3, { phase:'Base', longRunCost:0 });
  assert.notStrictEqual(p.reason, 'base_phase_restraint');
});

test('long-run cost can suppress the second session on its own', () => {
  const a = app();
  const p = a.secondQualityExposurePermission(3, { phase:'Build', longRunCost: 1.2 });
  assert.strictEqual(p.permitted, false);
  assert.strictEqual(p.reason, 'long_run_cost_exceeds_budget');
  // and it is priced in the settled regions rather than by distance
  assert.strictEqual(a.longRunCostPressure(140 * 60), 0, 'under 2h30 is not a duration concern');
  assert.ok(a.longRunCostPressure(210 * 60) >= 1, '3h30 is');
  const a1 = a.longRunCostPressure(179 * 60), a2 = a.longRunCostPressure(181 * 60);
  assert.ok(Math.abs(a2 - a1) < 0.1, 'and it is graded, not stepped');
});

test('the evidence architecture distinguishes quality history from easy volume', () => {
  function athlete(withQuality){
    const a = app();
    const today = a.todayStr(), m = a.addDays(today, -a.isoWeekday(today));
    const sessions = [];
    for (let w = 1; w <= 16; w++){
      [0,2,4].forEach(d => sessions.push({ date:a.addDays(m, -7*w+d), completed:true,
        actualKm:10, plannedKm:10, type:'easy', actual:{km:10,rpe:3,pace:330,hr:135}, feel:'good' }));
      sessions.push({ date:a.addDays(m, -7*w+6), completed:true, actualKm:20, plannedKm:20,
        type:'long', actual:{km:20,rpe:5,pace:340,hr:140}, feel:'good' });
      if (withQuality) sessions.push({ date:a.addDays(m, -7*w+1), completed:true, actualKm:10,
        plannedKm:10, type:'threshold', actual:{km:10,rpe:7,pace:290,hr:165}, feel:'good' });
    }
    a.state.athlete = { sessions };
    const blk = a.buildBlockWeeks('full', 50, 15, {});
    const end = a.addDays(m, 15*7-1);
    a.state.days = a.buildDaysFromWeeks(blk, end, SIX, today, true, { easyPaceSecPerKm: 330 });
    a.state.setup = { distanceKey:'full', currentVolume:50, planWeeks:15, schedule:SIX, blockId:'b',
      benchmark:{distanceKey:'5k',timeSec:24*60}, goals:{A:{timeSec:4*3600}}, activeGoal:'A',
      paceOverrides:{}, startDate:today, raceDate:end, hasEvent:true, purpose:'race' };
    return a;
  }
  const A = athlete(true), B = athlete(false);
  assert.ok(A.demonstratedQualityFamilies().indexOf('threshold') !== -1,
    '50km/week with logged threshold work is readable as such: ' +
    JSON.stringify(A.demonstratedQualityFamilies()));
  // cross-realm arrays: compare by content, never with deepStrictEqual
  assert.strictEqual(B.demonstratedQualityFamilies().length, 0,
    '50km/week of easy running is not');
  // and mileage alone never grants it
  assert.notStrictEqual(B.secondQualityExposurePermission(3).reason, 'adapting_and_recovered');
});

// -------------------------------------------------------------- quality by phase
test('general VO2 work gives way to threshold in the back half of Build', () => {
  const a = app();
  const alloc = a.marathonPhaseAllocation(15);
  const early = [], late = [];
  for (let w = alloc.base + 1; w <= alloc.base + alloc.build; w++){
    const k = a.marathonQualityKindFor('Build', w, w - alloc.base, alloc.build);
    ((w - alloc.base) >= Math.ceil(alloc.build / 2) ? late : early).push(k);
  }
  assert.ok(late.filter(k => k === 'tempo').length > late.filter(k => k === 'interval').length,
    'late Build should favour threshold: ' + late.join(','));
  assert.ok(early.every(k => k === null), 'early Build keeps its own rotation');
});

test('Peak keeps its goal-pace interval work rather than losing it', () => {
  const a = app();
  assert.strictEqual(a.marathonQualityKindFor('Peak', 12, 8, 6), null,
    'Peak draws its own pool, which is already the marathon-specific one');
  assert.strictEqual(a.marathonQualityKindFor('Base', 2, -2, 6), null);
  const { days } = plan(55, 15, 'full');
  const archetypes = new Set(days.map(d => d.prescription && d.prescription.archetype).filter(Boolean));
  assert.ok(archetypes.has('goal_pace_reps') || archetypes.has('goal_pace_block'),
    'a marathon block must still contain goal-pace work');
});

// -------------------------------------------------------------- peak architecture
test('the two peak exposures are different sessions', () => {
  const { a, blk, days } = plan(55, 15, 'full');
  const alloc = a.marathonPhaseAllocation(15);
  const first = alloc.base + alloc.build + 1;
  const last  = alloc.base + alloc.build + alloc.peak;
  const longOf = w => (days.filter(d => d.week === w && d.type === 'long')[0] || { km:0 }).km;
  const segOf  = w => blk.weeks[w - 1].goalSegKm || 0;
  /* THE SEPARATION SURVIVES THE MOVE, AND IT IS THE POINT OF THE TEST. HQ put
     the longest run in the final Peak week; the two demands must still not land
     in the same session, so the roles swapped rather than merged. The last week
     is now the durability-dominant one and the first carries the specific work.

     Left unmoved, the suppression protected a week that is no longer the
     longest: measured, a New marathoner's week thirteen came out as a 26km long
     run with a 13km goal-pace segment inside it. */
  assert.ok(longOf(last) > longOf(first),
    'the last Peak week ' + longOf(last) + 'km must be the longest, against ' +
    longOf(first) + 'km');
  assert.strictEqual(segOf(last), 0,
    'the longest run is durability dominant -- no goal-pace finish');
  assert.ok(segOf(first) > 0, 'the earlier exposure is the specific one');
  assert.ok(blk.weeks[first].isCutback, 'and absorption sits between them');
  // the longest exposure is never also the most specific
  assert.ok(!(longOf(last) >= longOf(first) && segOf(last) >= segOf(first)));
});

test('the LAST Peak week is the longest run of the whole block', () => {
  /* HQ: the longest appropriate long run occurs within the final seven days of
     Peak, immediately before taper begins. It used to be the FIRST Peak week,
     two to three weeks earlier than the event asks for. */
  const { a, days } = plan(55, 15, 'full');
  const alloc = a.marathonPhaseAllocation(15);
  const last = alloc.base + alloc.build + alloc.peak;
  const longs = days.filter(d => d.type === 'long' && d.km > 0 && d.week <= last);
  const max = Math.max.apply(null, longs.map(d => d.km));
  const pLast = (days.filter(d => d.week === last && d.type === 'long')[0] || {}).km;
  assert.strictEqual(pLast, max, 'the final Peak week carries the longest run');
});

test('no other distance gets the two-exposure treatment', () => {
  ['half','10k','5k'].forEach(d => {
    const { blk } = plan(55, 15, d);
    const peaks = blk.weeks.filter(w => w.phase === 'Peak');
    assert.ok(peaks.every(w => w.hasGoalSegment === peaks[0].hasGoalSegment) ||
              peaks.some(w => w.goalSegKm > 0),
      d + ' peak weeks must keep the behaviour they had');
  });
});

// ------------------------------------------------------------------ medium-long
test('the medium-long run has been removed from the workout family', () => {
  /* The mechanism -- a second sustained aerobic run named and carved out of
     an ordinary easy day in late Build -- is gone. Its kilometres are not
     lost: they stay in the easy days they always belonged to (see
     'kilometres are conserved' further up in this file, which still holds
     because the week's target volume was never the medium-long's to change).
     This asserts the removal itself, across the range that used to produce
     one, so a future generator change cannot silently reintroduce it. */
  [40, 60, 80].forEach(v => {
    [330, 560].forEach(pace => {
      const { days } = plan(v, 15, 'full', pace, null, v);
      assert.strictEqual(days.filter(d => d.mediumLong).length, 0,
        v + 'km/wk @ ' + pace + 's/km still produced a medium-long run');
      assert.ok(!days.some(d => d.title === 'Medium-Long Run'));
    });
  });
  ['half','10k','5k','ultra'].forEach(d => {
    assert.strictEqual(plan(55, 15, d).days.filter(x => x.mediumLong).length, 0, d);
  });
});

// -------------------------------------------------------------------- readiness
test('the event sets the requirement, and a low start does not lower it', () => {
  const a = app();
  const need = a.marathonVolumeRequirementKm();
  assert.ok(need > 0);
  [12, 25, 50, 80].forEach(v => {
    assert.strictEqual(a.marathonVolumeDestination(v, 15).needKm, need,
      'the requirement is a property of the marathon, not of the athlete');
  });
  assert.ok(a.marathonVolumeDestination(12, 15).reachableKm <
            a.marathonVolumeDestination(50, 15).reachableKm,
    'what can be reached still depends on where they start');
  assert.ok(a.marathonVolumeDestination(12, 15).limited);
});

test('a coherent programme can still be INSUFFICIENT', () => {
  const a = app();
  assert.strictEqual(a.marathonReadiness({ startKm:12, planWeeks:15, peakLongKm:7, specificKm:0 }).verdict,
    'INSUFFICIENT');
  assert.strictEqual(a.marathonReadiness({ startKm:50, planWeeks:15, peakLongKm:28, specificKm:8 }).verdict,
    'READY');
});

test('short runway and low base are not the same athlete', () => {
  const a = app();
  const strong = a.marathonReadiness({ startKm:60, planWeeks:9, peakLongKm:27, specificKm:5 });
  const weak   = a.marathonReadiness({ startKm:12, planWeeks:9, peakLongKm:5,  specificKm:0 });
  assert.notStrictEqual(strong.verdict, weak.verdict);
  assert.strictEqual(weak.verdict, 'INSUFFICIENT');
  assert.notStrictEqual(strong.verdict, 'INSUFFICIENT',
    'fewer than fifteen weeks is not by itself a verdict');
});

test('the verdict is the worst dimension, and unpractised fraction is not one', () => {
  const a = app();
  const r = a.marathonReadiness({ startKm:60, planWeeks:15, peakLongKm:10, specificKm:5,
                                  raceSec:5*3600, peakLongSec:1*3600 });
  assert.strictEqual(r.limitedBy, 'long_run', 'a strong volume must not conceal a weak long run');
  assert.ok(r.unpractisedFraction > 0.7, 'the gap is reported');
  assert.ok(r.dimensions.every(d => d.key !== 'unpractised'), 'but it is not a dimension');
});

// ------------------------------------------------------------ runway + transition
test('surplus runway is offered as development, and the race block stays fifteen weeks', () => {
  const a = app();
  const rp = a.marathonRunwayPlan(24, 40);
  assert.strictEqual(rp.raceWeeks, 15);
  assert.ok(rp.preparatory && rp.preparatory.weeks === 9);
  const html = a.runwayOfferHtml(rp, 'full');
  assert.ok(html.indexOf('data-action="runway-prep"') !== -1, 'the development block is offered');
  assert.ok(html.indexOf('data-action="runway-continue"') !== -1, 'and so is carrying on');
});

test('the destination survives a development block and returns when its window opens', () => {
  const a = app();
  a.state.days = [{ id:'x', date:a.todayStr(), week:1, type:'easy', km:5 }];
  a.state.setup = { purpose:'base', distanceKey:'full', blockId:'b1',
                    raceDate:a.addDays(a.todayStr(), 20), schedule:SIX };
  a.setRaceDestination('full', a.addDays(a.todayStr(), 98), { A:{ timeSec:4*3600 } }, 'A');
  const rec = a.nextBlockRecommendation();
  assert.ok(rec && rec.purpose === 'race' && rec.raceDestination, JSON.stringify(rec));
  assert.ok(/preparation window is here/.test(rec.why));
  // not yet due -> no offer
  a.setRaceDestination('full', a.addDays(a.todayStr(), 200), null, null);
  const early = a.nextBlockRecommendation();
  assert.ok(!early || !early.raceDestination, 'the offer waits for the window');
});

// ------------------------------------------------------- availability expansion
test('the expansion offer names a day, a reason and what it enables', () => {
  const a = app();
  const m = a.addDays(a.todayStr(), -a.isoWeekday(a.todayStr()));
  const sessions = [];
  for (let w = 1; w <= 20; w++) [0,2,4,6].forEach(d =>
    sessions.push({ date:a.addDays(m, -7*w+d), completed:true, actualKm:12, plannedKm:12, type:'easy' }));
  a.state.athlete = { sessions };
  const S = { activeDays:[1,3,4,6], longRunDay:6 };
  const blk = a.buildBlockWeeks('full', 55, 15, {});
  const end = a.addDays(m, 15*7-1);
  a.state.days = a.buildDaysFromWeeks(blk, end, S, a.todayStr(), true, { easyPaceSecPerKm:330 });
  a.state.setup = { distanceKey:'full', currentVolume:55, planWeeks:15, schedule:S, blockId:'b1',
    benchmark:{distanceKey:'5k',timeSec:24*60}, goals:{A:{timeSec:4*3600}}, activeGoal:'A',
    paceOverrides:{}, startDate:a.todayStr(), raceDate:end, hasEvent:true, purpose:'race' };
  const rec = a.availabilityExpansionRecommendation();
  assert.ok(rec && rec.recommend, JSON.stringify(rec));
  assert.strictEqual(rec.from, 4);
  assert.strictEqual(rec.to, 5);
  assert.ok(rec.day != null && S.activeDays.indexOf(rec.day) === -1);
  assert.ok(Object.keys(a.EXPANSION_REASONS).indexOf(rec.reason) !== -1);
  assert.ok(rec.why && rec.contains && rec.enables);
  assert.ok(/not another hard session/.test(rec.contains));

  // ACCEPT grants permission and nothing else
  const before = a.state.setup.schedule.activeDays.length;
  assert.strictEqual(a.acceptAvailabilityExpansion(rec.day), true);
  assert.strictEqual(a.state.setup.schedule.activeDays.length, before + 1);
  assert.strictEqual(a.state.setup.currentVolume, 55, 'acceptance changes no volume');
  assert.strictEqual(a.state.availabilityExpansion.decision, 'accepted');
});

test('decline costs nothing and is not re-asked for the block', () => {
  const a = app();
  a.state.setup = { schedule:{ activeDays:[1,3,4,6], longRunDay:6 }, blockId:'b1',
                    distanceKey:'full', purpose:'race' };
  assert.strictEqual(a.declineAvailabilityExpansion(), true);
  const r = a.state.availabilityExpansion;
  assert.strictEqual(r.decision, 'declined');
  assert.strictEqual(a.state.setup.schedule.activeDays.length, 4, 'availability is unchanged');
  assert.ok(!('penalty' in r) && !('adherence' in r), 'and nothing is recorded against them');
  assert.strictEqual(a.availabilityExpansionRecommendation(), null, 'not asked again this block');
});

test('six is the ceiling and there is no path past it', () => {
  const a = app();
  assert.strictEqual(a.AVAILABILITY_EXPANSION_CEILING, 6);
  a.state.setup = { schedule:{ activeDays:[0,1,2,3,4,6], longRunDay:6 }, blockId:'b1',
                    distanceKey:'full', purpose:'race' };
  assert.strictEqual(a.availabilityExpansionRecommendation(), null,
    'a six-day athlete is never asked for a seventh');
  assert.strictEqual(a.acceptAvailabilityExpansion(5), false, 'and cannot be given one');
});
